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
