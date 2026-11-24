import { expect, test } from 'claude-code/testing'

test('a model step of the main loop restarts the lastAt clock', async ($, on) => {
  const writes: string[] = []
  on('state.get', () => ({ value: { value: null, version: 0 } }))
  on('state.set', (_, e) => {
    writes.push(e.key)
    return { value: { isSet: true, version: 1 } }
  })
  on('ui.invalidate', () => ({ value: undefined }))
  on('turn.step', async function* () {
    return { turnId: 't', index: 0, answer: 'hi', toolUses: [], stopReason: 'end_turn' as const, usage: null }
  })

  // turn.step streams: the hook only runs once the stream is read.
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })
  for await (const _chunk of stream) void _chunk

  expect(writes).toContain('lastAt')
})
