import { describe, expect, it } from 'vitest'
import {
  CallId,
  type ContentBlock,
  createAssistantMessage,
  createMessage,
  createToolResultMessage,
  createUserMessage,
  freezeMessage,
  MessageId,
} from '@deepseek-ai/dsh-llm'

describe('message construction', () => {
  it('assigns identity immediately and returns a detached deep-frozen message', () => {
    const input = {
      content: [{ type: 'text' as const, text: 'original' }],
      source: { kind: 'plugin' as const, plugin: 'test' },
    }

    const message = createUserMessage(input)

    expect(message.id).toEqual(expect.any(String))
    expect(message.role).toBe('user')
    expect(message.id).not.toHaveLength(0)
    expect(message).not.toBe(input)
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
    expect(Object.isFrozen(message.source)).toBe(true)

    input.content[0]!.text = 'caller mutation'
    expect(message.content).toEqual([{ type: 'text', text: 'original' }])
    expect(() => {
      (message.content[0] as { text: string }).text = 'observer mutation'
    }).toThrow()
  })

  it('freezes an existing identity without minting a replacement', () => {
    const id = MessageId('existing')
    const input = {
      id,
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'answer' }],
      source: { kind: 'model' as const, provider: 'test', model: 'test' },
    }

    const message = freezeMessage(input)

    expect(message).not.toBe(input)
    expect(message.id).toBe(id)
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
  })

  it('fixes the assistant role and model source kind at creation', () => {
    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'answer' }],
      source: {
        provider: 'test-provider',
        model: 'test-model',
        replayState: { request: 1 },
      },
    })

    expect(message).toMatchObject({
      role: 'assistant',
      source: {
        kind: 'model',
        provider: 'test-provider',
        model: 'test-model',
        replayState: { request: 1 },
      },
    })
    expect(message.id).not.toHaveLength(0)
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.source)).toBe(true)
  })

  it('couples tool-result content and its cited call seq to one call identity', () => {
    const callId = CallId('call-1')
    const message = createToolResultMessage({
      callId,
      content: [{ type: 'text', text: 'result' }],
      isError: false,
    })

    expect(message).toMatchObject({
      role: 'user',
      source: { kind: 'tool', callId },
      content: [{
        type: 'tool-result',
        toolCallId: callId,
        content: [{ type: 'text', text: 'result' }],
        isError: false,
      }],
    })
    expect(message.id).not.toHaveLength(0)
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
  })

  it('detaches and freezes 12,000 nested tool results without call-stack growth', () => {
    const leaf = { type: 'text' as const, text: 'deep leaf' }
    let nested: ContentBlock = leaf
    for (let depth = 0; depth < 12_000; depth++) {
      nested = {
        type: 'tool-result',
        toolCallId: CallId(`nested-${depth}`),
        content: [nested],
      }
    }
    const message = createToolResultMessage({
      callId: CallId('outer'),
      content: [nested],
      isError: false,
    })
    let cursor: ContentBlock = message.content[0].content[0]!
    if (cursor === nested) throw new Error('message retained the nested input graph')
    expect(Object.isFrozen(message)).toBe(true)
    expect(Object.isFrozen(message.content)).toBe(true)
    expect(Object.isFrozen(message.content[0])).toBe(true)
    for (let depth = 11_999; depth >= 0; depth--) {
      if (cursor.type !== 'tool-result') throw new Error(`expected tool result at depth ${depth}`)
      if (cursor.toolCallId !== CallId(`nested-${depth}`)) throw new Error(`call identity changed at depth ${depth}`)
      if (!Object.isFrozen(cursor)) throw new Error(`block is mutable at depth ${depth}`)
      if (!Object.isFrozen(cursor.content)) throw new Error(`content is mutable at depth ${depth}`)
      cursor = cursor.content[0]!
    }
    expect(cursor).toEqual({ type: 'text', text: 'deep leaf' })
    expect(cursor).not.toBe(leaf)
    expect(Object.isFrozen(cursor)).toBe(true)
  })

  it('preserves shared references and cycles while detaching them', () => {
    const shared = { value: 'shared' }
    const replayState: Record<string, unknown> = { left: shared, right: shared }
    replayState.self = replayState

    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'answer' }],
      source: { provider: 'test', model: 'test', replayState },
    })
    const snapshot = message.source.replayState as Record<string, unknown>

    expect(snapshot).not.toBe(replayState)
    expect(snapshot.left).toBe(snapshot.right)
    expect(snapshot.left).not.toBe(shared)
    expect(snapshot.self).toBe(snapshot)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.left)).toBe(true)
  })

  it('normalizes null prototypes and preserves merge-extensible fields and literal __proto__ data', () => {
    const extension = Object.create(null) as Record<string, unknown>
    extension.pluginField = { enabled: true }
    const ordinary = Object.defineProperty({}, '__proto__', {
      value: { safe: true },
      enumerable: true,
      configurable: true,
      writable: true,
    })
    extension.ordinary = ordinary

    const message = createMessage({
      role: 'system',
      content: [{ type: 'text', text: 'context' }],
      source: Object.assign({ kind: 'plugin' as const, plugin: 'test' }, { extension }),
    })
    const snapshot = message.source.extension

    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype)
    expect(snapshot.pluginField).toEqual({ enabled: true })
    const ordinarySnapshot = snapshot.ordinary as Record<string, unknown>
    expect(Object.hasOwn(ordinarySnapshot, '__proto__')).toBe(true)
    expect(ordinarySnapshot.__proto__).toEqual({ safe: true })
    expect(Object.getPrototypeOf(ordinarySnapshot)).toBe(Object.prototype)
  })

  it('copies representative assistant replay state and reads a nested getter once', () => {
    let reads = 0
    const response = Object.defineProperty({ id: 'response-1' }, 'blocks', {
      enumerable: true,
      get: () => {
        reads += 1
        return [{ type: 'text', index: 0 }]
      },
    })

    const message = createAssistantMessage({
      content: [{ type: 'text', text: 'answer' }],
      source: {
        provider: 'openai',
        model: 'gpt-test',
        replayState: { response, outputIndices: [0] },
      },
    })

    expect(reads).toBe(1)
    expect(message.source.replayState).toEqual({
      response: { id: 'response-1', blocks: [{ type: 'text', index: 0 }] },
      outputIndices: [0],
    })
  })

  it('propagates getter failures', () => {
    const failure = new Error('getter failed')
    const replayState = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => { throw failure },
    })

    expect(() => createAssistantMessage({
      content: [{ type: 'text', text: 'answer' }],
      source: { provider: 'test', model: 'test', replayState },
    })).toThrow(failure)
  })

  it('preserves structured-clone behavior outside the iterative plain-data path', () => {
    class Exotic {
      readonly value = 1
    }
    const sparse = new Array(1)
    const decorated = [1]
    Object.defineProperty(decorated, 'extra', { value: true, enumerable: true })
    const symbolKey = { [Symbol('private')]: true }
    const hidden = Object.defineProperty({}, 'hidden', { value: true })
    const supported = [
      undefined,
      1n,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0,
      sparse,
      decorated,
      symbolKey,
      hidden,
      new Date(),
      new Map(),
      new Set(),
      new Uint8Array(),
      new Exotic(),
      { special: new Date(0), absent: undefined },
    ]

    for (const replayState of supported) {
      const message = createAssistantMessage({
        content: [{ type: 'text', text: 'answer' }],
        source: { provider: 'test', model: 'test', replayState },
      })
      expect(message.source.replayState).toEqual(structuredClone(replayState))
    }
    for (const replayState of [() => 1, Symbol('value')]) {
      expect(() => createAssistantMessage({
        content: [{ type: 'text', text: 'answer' }],
        source: { provider: 'test', model: 'test', replayState },
      })).toThrow()
    }
  })
})
