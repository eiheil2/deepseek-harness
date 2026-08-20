import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmError  } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, LlmResolvedModelInfo, ResolvedRetryPolicy } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from './mock-adapter.ts'

async function harness(adapter: MockAdapter, providers: string[] = ['mock']): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(providers, adapter)
  return ctx
}

class MutableDefaultAdapter extends MockAdapter {
  mutableDefaultMaxTokens = 111
  resolutions = 0

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    this.resolutions += 1
    return Promise.resolve({ provider, id: model, name: model, defaultMaxTokens: this.mutableDefaultMaxTokens })
  }
}

function fail(message: string, code: string): () => never {
  return () => {
    throw new LlmError(message, code)
  }
}

describe('agent/request-error', () => {
  it('does not offer middleware failures to request recovery', async () => {
    const adapter = new MockAdapter([textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-narrow'), { provider: 'mock', model: 'mock' })
    let recoveries = 0
    ctx.on('agent/request', () => {
      throw new LlmError('middleware failed', 'MIDDLEWARE')
    })
    ctx.on('agent/request-error', async () => {
      recoveries += 1
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(recoveries).toBe(0)
    expect(adapter.requests).toHaveLength(0)
  })

  it('lets each failed request return a retry action before its turn closes', async () => {
    const adapter = new MockAdapter([
      fail('busy', 'RATE_LIMIT'),
      fail('unavailable', 'SERVICE_UNAVAILABLE'),
      textResponse('ok'),
    ])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-retry'), { provider: 'mock', model: 'mock' })
    const seen: {
      turn: number
      step: number
      failure: LlmFailure
      retryPolicy: ResolvedRetryPolicy | undefined
    }[] = []
    const statuses: string[] = []
    ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent) statuses.push(status)
    })
    ctx.on('agent/request-error', async ({ agent: subject, turn, step, failure, retryPolicy }) => {
      expect(subject).toBe(agent)
      seen.push({ turn, step, failure, retryPolicy })
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(seen.map(item => ({
      turn: item.turn,
      step: item.step,
      code: item.failure.code,
    }))).toEqual([
      {
        turn: 1,
        step: 1,
        code: 'RATE_LIMIT',
      },
      {
        turn: 1,
        step: 1,
        code: 'SERVICE_UNAVAILABLE',
      },
    ])
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(seen.map(item => item.retryPolicy)).toEqual([
      expect.objectContaining({ mode: 'normal' }),
      expect.objectContaining({ mode: 'normal' }),
    ])
    expect(statuses).toEqual(['running', 'idle'])
  })

  it('freezes the request route and explicit controls across a delayed retry', async () => {
    const adapter = new MutableDefaultAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter, ['mock', 'other'])
    const agent = ctx.agentLoop.create(SessionId('request-error-frozen-route'), {
      provider: 'mock',
      model: 'initial',
    })
    const backoffStarted = Promise.withResolvers<undefined>()
    const releaseRetry = Promise.withResolvers<undefined>()
    let requestWaterfalls = 0
    let route = { provider: 'mock', model: 'first', maxTokens: 123 }
    ctx.on('agent/request', async (_payload, next) => {
      requestWaterfalls += 1
      return { ...await next(), ...route }
    })
    ctx.on('agent/request-error', async () => {
      backoffStarted.resolve(undefined)
      await releaseRetry.promise
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await backoffStarted.promise
    route = { provider: 'other', model: 'second', maxTokens: 456 }
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'durable recovery context' }],
      source: { kind: 'plugin', plugin: 'test-retry-mutation' },
    }), { surfaceOp: 'append' })
    releaseRetry.resolve(undefined)
    await agent.whenIdle()

    expect(requestWaterfalls).toBe(1)
    expect(adapter.resolutions).toBe(2)
    expect(adapter.requests.map(({ provider, model, maxTokens }) => ({ provider, model, maxTokens }))).toEqual([
      { provider: 'mock', model: 'first', maxTokens: 123 },
      { provider: 'mock', model: 'first', maxTokens: 123 },
    ])
    expect(adapter.requests[0]?.messages).not.toContainEqual(expect.objectContaining({
      content: [{ type: 'text', text: 'durable recovery context' }],
    }))
    expect(adapter.requests[1]?.messages).toContainEqual(expect.objectContaining({
      content: [{ type: 'text', text: 'durable recovery context' }],
    }))
    expect(agent.session.events.filter(event => event.type === 'request/header')).toHaveLength(1)
  })

  it('freezes an adapter-owned default across a delayed retry', async () => {
    const adapter = new MutableDefaultAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-frozen-default'), {
      provider: 'mock',
      model: 'model',
    })
    const backoffStarted = Promise.withResolvers<undefined>()
    const releaseRetry = Promise.withResolvers<undefined>()
    ctx.on('agent/request-error', async () => {
      backoffStarted.resolve(undefined)
      await releaseRetry.promise
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await backoffStarted.promise
    adapter.mutableDefaultMaxTokens = 222
    releaseRetry.resolve(undefined)
    await agent.whenIdle()

    expect(adapter.resolutions).toBe(2)
    expect(adapter.requests.map(({ provider, model, maxTokens }) => ({ provider, model, maxTokens }))).toEqual([
      { provider: 'mock', model: 'model', maxTokens: 111 },
      { provider: 'mock', model: 'model', maxTokens: 111 },
    ])
    expect(agent.session.events.filter(event => event.type === 'request/header')).toHaveLength(1)
  })

  it('rebuilds retry messages after a durable surface replacement', async () => {
    const adapter = new MutableDefaultAdapter([fail('busy', 'RATE_LIMIT'), textResponse('ok')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-replaced-surface'), {
      provider: 'mock',
      model: 'model',
    })
    const backoffStarted = Promise.withResolvers<undefined>()
    const releaseRetry = Promise.withResolvers<undefined>()
    ctx.on('agent/request-error', async () => {
      backoffStarted.resolve(undefined)
      await releaseRetry.promise
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'before replacement' }], source: { kind: 'user' } }))
    await backoffStarted.promise
    const original = agent.session.events.find(event => event.type === 'user/message')
    if (original === undefined) throw new Error('expected the initial user message event')
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'after replacement' }],
      source: { kind: 'plugin', plugin: 'test-retry-replacement' },
    }), { surfaceOp: { op: 'replace', start: original.seq, end: original.seq }, sourceEventSeqs: [original.seq] })
    releaseRetry.resolve(undefined)
    await agent.whenIdle()

    expect(adapter.requests[0]?.messages).toContainEqual(expect.objectContaining({
      content: [{ type: 'text', text: 'before replacement' }],
    }))
    expect(adapter.requests[1]?.messages).toContainEqual(expect.objectContaining({
      content: [{ type: 'text', text: 'after replacement' }],
    }))
    expect(adapter.requests[1]?.messages).not.toContainEqual(expect.objectContaining({
      content: [{ type: 'text', text: 'before replacement' }],
    }))
  })

  it('lets cancellation win over a retry action', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-cancel'), { provider: 'mock', model: 'mock' })
    ctx.on('agent/request-error', async ({ agent: subject }) => {
      subject.cancel({ kind: 'user' })
      return { kind: 'retry' }
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.find(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'aborted', reason: { kind: 'user' } } },
    })
  })

  it('does not retry when the recovery listener fails before returning its action', async () => {
    const adapter = new MockAdapter([fail('busy', 'RATE_LIMIT'), textResponse('unused')])
    const ctx = await harness(adapter)
    const agent = ctx.agentLoop.create(SessionId('request-error-recovery-failed'), {
      provider: 'mock',
      model: 'mock',
    })
    ctx.on('agent/request-error', async () => {
      throw new Error('recovery failed')
    })

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(1)
    expect(agent.session.events.filter(event => event.type === 'turn/start')).toHaveLength(1)
    expect(agent.session.events.find(event => event.type === 'turn/end')).toMatchObject({
      type: 'turn/end',
      data: { reason: { kind: 'error' } },
    })
  })
})
