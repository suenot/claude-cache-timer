declare module 'claude-code' {
  interface PluginState {
    'cache-timer': {
      lastAt: number | null
      warmUntil: number | null
      pings: number
      note: string | null
    }
  }
}
