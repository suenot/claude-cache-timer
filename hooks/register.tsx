import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const TTL_MS = 60 * 60 * 1000
const WARN_MS = 10 * 60 * 1000

const lastAt = atom({ plugin: 'cache-timer', key: 'lastAt' } as const, null)

const fmt = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s % 60}s`
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    $.clock.every(15000, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, lastAt, () => Date.now())
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const at = await read($, lastAt)
    if (e.props.hasSurvey || at === null) return next(e)

    const age = (await $.clock.now()) - at
    const left = TTL_MS - age
    const { Box, Text } = $.ui.resolve(e)
    const color = left <= 0 ? 'error' : left < WARN_MS ? 'warning' : undefined

    return (
      <Box>
        <Text dimColor={color === undefined} color={color}>
          Last reply {fmt(age)} ago · {left <= 0 ? 'cache expired' : `cache ${fmt(left)} left`}
        </Text>
      </Box>
    )
  })
}
