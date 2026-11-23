import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register } from 'claude-code'

const TTL_MS = 60 * 60 * 1000 // prompt cache lifetime (1h)
const WARN_MS = 10 * 60 * 1000 // band turns yellow below this
const PING_AFTER_MS = 50 * 60 * 1000 // ping when the cache is this old
const WARM_WINDOW_MS = 3 * 60 * 60 * 1000 // one button press keeps warm this long
const MAX_FAILS = 3
const COMPACT_AFTER_MS = 55 * 60 * 1000 // compact while the cache is still warm
const MIN_COMPACT_TOKENS = 30000 // smaller contexts are not worth a summary

const lastAt = atom({ plugin: 'cache-timer', key: 'lastAt' } as const, null)
const warmUntil = atom({ plugin: 'cache-timer', key: 'warmUntil' } as const, null)
const pings = atom({ plugin: 'cache-timer', key: 'pings' } as const, 0)
const note = atom({ plugin: 'cache-timer', key: 'note' } as const, null)
// lastAt of the idle period already compacted (or judged too small), so one
// idle period compacts once.
const compactedAt = atom({ plugin: 'cache-timer', key: 'compactedAt' } as const, null)
// The person pressed "Skip auto-compact" for this idle period.
const compactSkipped = atom({ plugin: 'cache-timer', key: 'compactSkipped' } as const, false)

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s % 60}s`
}

const clock = (ms: number): string => new Date(ms).toTimeString().slice(0, 5)

let busy = false
let inFlight = false
let fails = 0
let timer: { cancel: () => void } | null = null

// One timer: while keeping warm, the moment the cache is PING_AFTER_MS old;
// otherwise the moment it is COMPACT_AFTER_MS old, to compact before it expires.
async function arm($: Engine, delayMs?: number): Promise<void> {
  timer?.cancel()
  timer = null
  let until = await read($, warmUntil)
  const at = await read($, lastAt)
  const now = await $.clock.now()
  if (at === null || busy) return
  if (until !== null && now >= until) {
    await update($, warmUntil, () => null)
    await update($, note, () => 'Keep warm ended')
    until = null
  }
  if (until !== null) {
    const wait = delayMs ?? Math.max(0, at + PING_AFTER_MS - now)
    timer = $.clock.after(wait, () => ping($))
    return
  }
  if ((await read($, compactedAt)) === at) return
  if (now - at >= TTL_MS) return // already cold: compacting now saves nothing
  timer = $.clock.after(Math.max(0, at + COMPACT_AFTER_MS - now), () => compact($))
}

// Compacts an idle conversation just before its cache expires, so the next
// prompt pays for a short summary instead of rewriting the whole context.
async function compact($: Engine): Promise<void> {
  timer = null
  const at = await read($, lastAt)
  const now = await $.clock.now()
  if (at === null || busy || inFlight || (await read($, warmUntil)) !== null) return
  if ((await read($, compactedAt)) === at || now - at >= TTL_MS) return
  if (now - at < COMPACT_AFTER_MS) return arm($)

  const { context } = await $.session.usage()
  if ((context.tokens ?? 0) < MIN_COMPACT_TOKENS) {
    await update($, compactedAt, () => at)
    return
  }
  inFlight = true
  try {
    const r = await $.session.compact()
    if (r.skip !== undefined) {
      await update($, compactedAt, () => at)
      await update($, note, () => `Auto-compact skipped: ${r.skip}`)
      return
    }
    const t = await $.clock.now()
    const k = (n?: number) => (n === undefined ? '?' : `${Math.round(n / 1000)}k`)
    await update($, lastAt, () => t) // the summary request read the cache
    await update($, compactedAt, () => t)
    await update($, note, () => `Auto-compacted at ${clock(t)} (${k(r.tokensBefore)} to ${k(r.tokensAfter)} tokens)`)
  } catch (err) {
    // Rejects while a turn runs; turn.complete re-arms for the next idle period.
    await update($, note, () => `Auto-compact failed: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    inFlight = false
    $.ui.invalidate('ui.render')
  }
}

async function ping($: Engine): Promise<void> {
  timer = null
  const until = await read($, warmUntil)
  const at = await read($, lastAt)
  const now = await $.clock.now()
  if (until === null || at === null || busy || inFlight) return
  if (now >= until) return arm($)
  if (now - at < PING_AFTER_MS) return arm($)

  inFlight = true
  await update($, lastAt, () => now) // claim: no second ping meanwhile
  try {
    const r = await $.model.fork({ prompt: 'Reply with the single word: ok' })
    if (!r.isAnswered) {
      await update($, lastAt, () => at)
      if (r.reason === 'nothing-to-fork') return
      fails += 1
      if (fails >= MAX_FAILS) {
        await update($, warmUntil, () => null)
        await update($, note, () => `Keep warm stopped: ${r.reason}`)
      } else {
        await arm($, 60000) // retry in a minute, still inside the 1h window
      }
      return
    }
    fails = 0
    await update($, pings, n => n + 1)
    const { cache_read_input_tokens: read_, cache_creation_input_tokens: wrote } = r.usage
    if (read_ === 0 || wrote * 10 >= read_) {
      await update($, warmUntil, () => null)
      await update($, note, () => 'Keep warm stopped: cache was cold, ping rewrote it')
      $.ui.toast('Keep warm stopped: cache was already cold')
    } else {
      await arm($)
    }
  } finally {
    inFlight = false
    $.ui.invalidate('ui.render')
  }
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    $.clock.every(15000, () => $.ui.invalidate('ui.render')) // redraw only, no API
    await arm($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    busy = true
    timer?.cancel()
    timer = null
    return next(e)
  })

  // Every model request of the main loop reads the cached prefix and so
  // restarts its lifetime, not only the last one of a turn. Without this the
  // band keeps counting from the previous turn while a long turn is running.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || inFlight) return yield* next(e)
    const r = yield* next(e)
    await update($, lastAt, () => Date.now())
    $.ui.invalidate('ui.render')
    return r
  })

  on('turn.complete', async ($, e, next) => {
    busy = false
    if (inFlight) return next(e) // our own ping or compaction, not the person
    await update($, compactSkipped, () => false)
    await update($, lastAt, () => Date.now())
    await arm($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const at = await read($, lastAt)
    if (e.props.hasSurvey || at === null) return next(e)

    const now = await $.clock.now()
    const age = now - at
    const left = TTL_MS - age
    const until = await read($, warmUntil)
    const isWarm = until !== null && until > now
    const count = await read($, pings)
    const msg = await read($, note)
    const done = await read($, compactedAt)
    const compactIn = at + COMPACT_AFTER_MS - now
    const willCompact = !isWarm && done !== at && left > 0
    const skipped = await read($, compactSkipped)
    const { Box, Text, Button } = $.ui.resolve(e)
    const color = left <= 0 ? 'error' : left < WARN_MS ? 'warning' : undefined

    return (
      <Box>
        <Text dimColor={color === undefined} color={color}>
          Last reply {fmt(age)} ago · {left <= 0 ? 'cache expired' : `cache ${fmt(left)} left`}
          {isWarm ? ` · keeping warm until ${clock(until)} (${count} pings)` : ''}
          {willCompact ? ` · ${compactIn > 0 ? `auto-compact in ${fmt(compactIn)}` : 'auto-compacting'}` : ''}
          {!isWarm && msg ? ` · ${msg}` : ''}{' '}
        </Text>
        <Button
          key="warm"
          label={isWarm ? 'Stop warming' : 'Keep warm 3h'}
          onPress={async () => {
            const t = await $.clock.now()
            fails = 0
            await update($, note, () => null)
            await update($, pings, () => 0)
            await update($, warmUntil, () => (isWarm ? null : t + WARM_WINDOW_MS))
            await arm($)
          }}
        />
        {willCompact || (skipped && left > 0) ? (
          <Button
            key="compact"
            label={skipped ? 'Auto-compact' : 'Skip auto-compact'}
            onPress={async () => {
              await update($, compactSkipped, () => !skipped)
              await update($, compactedAt, () => (skipped ? null : at))
              await update($, note, () => (skipped ? null : 'auto-compact skipped'))
              await arm($)
            }}
          />
        ) : null}
      </Box>
    )
  })
}
