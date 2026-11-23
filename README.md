# claude-cache-timer

A Claude Code mod that draws a band above the prompt showing how long ago the
last reply finished and how much time is left before the 1-hour prompt cache
expires:

```
Last reply 12m 3s ago · cache 47m 57s left
```

The text is dim while more than 10 minutes remain, turns to a warning color
under 10 minutes, and to an error color with `cache expired` after one hour.
It refreshes every 15 seconds and counts from the last model response, so it
resets on every reply of a running turn, not only when the turn ends.
It works in the open chat only; it does not change the session list.

The 1-hour TTL is a constant (`TTL_MS`) in `hooks/register.tsx`. Set it to
5 minutes if your session uses the short cache.

## Auto-compact (always on)

When the conversation sits idle and the cache reaches 55 minutes, the mod runs
`/compact` by itself (`$.session.compact`), while the cache is still warm. The
summary request reads the cached prefix cheaply, and the next prompt pays for a
short summary instead of rewriting the whole context at full price after the
cache expires. The band shows `auto-compact in Nm` until then and
`Auto-compacted at HH:MM (Nk to Mk tokens)` afterwards.

It runs once per idle period: after it, nothing more happens until you write
again, so an abandoned session is compacted at most once and never hourly. It
is skipped while a turn runs, while Keep warm is on (warming wins; compaction
resumes after the window ends), when the cache has already expired, and when
the context is under 30k tokens. It is on by default; when a task is finished
and the session will not be used again, press **Skip auto-compact** on the
band to spend nothing on it. The skip lasts until your next message, and
pressing **Auto-compact** undoes it. The thresholds are `COMPACT_AFTER_MS` and
`MIN_COMPACT_TOKENS` in `hooks/register.tsx`.

## Keep warm button

The band has **Keep warm 3h**, **6h** and **12h** buttons. While it is on, the mod sets a single timer for the
moment the cache is 50 minutes old (no polling; the timer is reset after every
turn). If no turn is running then, it sends one tool-less fork over the session transcript (`$.model.fork`), which reads
the cached prefix and so restarts the 1-hour lifetime. The band then shows
`keeping warm until HH:MM (N pings)` and the button becomes **Stop warming**.

Pings spend tokens: each one re-reads the whole context from the cache, so a
3-hour window means about three pings, 6 hours about six, 12 hours about twelve. The mod stops by itself when the window
ends, when a ping finds the cache already cold (read is zero, or the write is
10% or more of the read), after 3 failed pings in a row, or after `/clear`.
Windows are per session and are forgotten when Claude Code restarts. Pressing
the button again stops warming.

The ping logic was written against the API types and checked by
`claude plugin validate`; it has not been run for a full 50-minute cycle yet.

## Install

At the prompt of a terminal session:

```
/plugin install cache-timer --marketplace suenot/claude-cache-timer
```

From a shell:

```
claude plugin install cache-timer --marketplace suenot/claude-cache-timer
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, Add marketplace with `suenot/claude-cache-timer`, then Add
plugin.

## License

MIT
