# claude-cache-timer

A Claude Code mod that draws a band above the prompt showing how long ago the
last reply finished and how much time is left before the 1-hour prompt cache
expires:

```
Last reply 12m 3s ago · cache 47m 57s left
```

The text is dim while more than 10 minutes remain, turns to a warning color
under 10 minutes, and to an error color with `cache expired` after one hour.
It refreshes every 15 seconds and counts from the end of the last turn.
It works in the open chat only; it does not change the session list.

The 1-hour TTL is a constant (`TTL_MS`) in `hooks/register.tsx`. Set it to
5 minutes if your session uses the short cache.

## Keep warm button

The band has a **Keep warm 3h** button. While it is on, the mod checks every
30 seconds; when the cache is 50 minutes old and no turn is running, it sends
one tool-less fork over the session transcript (`$.model.fork`), which reads
the cached prefix and so restarts the 1-hour lifetime. The band then shows
`keeping warm until HH:MM (N pings)` and the button becomes **Stop warming**.

Pings spend tokens: each one re-reads the whole context from the cache, so a
3-hour window means about three pings. The mod stops by itself when the window
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
