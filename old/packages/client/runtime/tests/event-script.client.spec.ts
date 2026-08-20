import { describe, expect, it } from 'vitest'
import { ev } from './event-script.client.ts'

describe('event script Code Mode ids', () => {
  it('pairs one execution and isolates repeated parent ids across executions', () => {
    const firstStart = ev.codeDispatchStart(1, 'root', 1, 'read', {}, 'exec-a')
    const firstSettle = ev.codeDispatch(2, 'root', 1, 'read', {}, 'ok', false, 'exec-a')
    const secondStart = ev.codeDispatchStart(3, 'root', 1, 'read', {}, 'exec-b')

    expect(firstStart).toMatchObject({
      data: { subCallId: 'root:code:exec-a:1' },
    })
    expect(firstSettle).toMatchObject({
      data: { subCallId: 'root:code:exec-a:1' },
    })
    expect(secondStart).toMatchObject({
      data: { subCallId: 'root:code:exec-b:1' },
    })
  })
})
