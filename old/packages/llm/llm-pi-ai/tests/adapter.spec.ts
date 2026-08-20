import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  SaveImageAttachment,
  StoredImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { createUserMessage, CONTEXT_WINDOW_EXCEEDED_CODE, LlmError, ReasoningEffortId, userAgent } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import {
  closeOpenAICodexWebSocketSessions,
  resetOpenAICodexWebSocketDebugStats,
} from '@earendil-works/pi-ai/api/openai-codex-responses'
import { piSessionScopeId } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  closeOpenAICodexWebSocketSessions()
  resetOpenAICodexWebSocketDebugStats()
  await closeMockServers()
})

const IMAGE_REF: ImageAttachmentRef = {
  attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
  mediaType: 'image/png',
  bytes: 1,
  width: 1,
  height: 1,
}

async function harness(baseURL: string, overrides: Record<string, unknown> = {}): Promise<Context> {
  vi.stubEnv('PI_TEST_KEY', 'test-key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: { deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL, ...overrides } },
  })
  return ctx
}

/** Direct adapter over the real profile resolver, with a fixed key per call. */
function adapterOf(
  providers: Record<string, LlmPiAi.PiAiProviderProfile>,
  apiKey: string | undefined = 'test-key',
): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles(providers),
    resolveApiKey: () => Promise.resolve(apiKey),
  })
}

const CODEX_ACCOUNT_CLAIMS = {
  'https://api.openai.com/auth': { chatgpt_account_id: 'acct' },
}

function codexToken(signature: string): string {
  return `e30.${Buffer.from(JSON.stringify(CODEX_ACCOUNT_CLAIMS)).toString('base64url')}.${signature}`
}

function codexResponse(id: string): Record<string, unknown> {
  return {
    type: 'response.completed',
    response: {
      id,
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'gpt-5.4',
      output: [{
        id: `${id}-message`,
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'hello', annotations: [] }],
      }],
      usage: {
        input_tokens: 1,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 0,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 1,
      },
    },
  }
}

function codexEvents(id: string): Record<string, unknown>[] {
  return [
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: `${id}-message`, type: 'message', role: 'assistant', status: 'in_progress', content: [] },
    },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'hello' },
    codexResponse(id),
  ]
}

class FakeCodexWebSocket extends EventTarget {
  static readonly sockets: FakeCodexWebSocket[] = []
  static failNextRequest = false
  static responseIndex = 0

  readonly sent: Record<string, unknown>[] = []
  readonly responseIds: string[] = []
  readyState = 0

  constructor(readonly url: string | URL, readonly options?: unknown) {
    super()
    FakeCodexWebSocket.sockets.push(this)
    queueMicrotask(() => {
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
    })
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>)
    if (FakeCodexWebSocket.failNextRequest) {
      FakeCodexWebSocket.failNextRequest = false
      queueMicrotask(() => {
        const error = new Event('error')
        Object.defineProperty(error, 'message', { value: 'synthetic WebSocket failure' })
        this.dispatchEvent(error)
      })
      return
    }
    const responseId = `response-${++FakeCodexWebSocket.responseIndex}`
    this.responseIds.push(responseId)
    queueMicrotask(() => {
      for (const response of codexEvents(responseId)) {
        const message = new Event('message')
        Object.defineProperty(message, 'data', { value: JSON.stringify(response) })
        this.dispatchEvent(message)
      }
    })
  }

  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new Event('close'))
  }

  static reset(): void {
    this.sockets.splice(0)
    this.failNextRequest = false
    this.responseIndex = 0
  }
}

beforeEach(() => {
  // Configuration carries only the reference; these mounts resolve it from
  // the environment, which is the whole credential plane without a seam.
  vi.stubEnv('PI_TEST_KEY', 'test-key')
})

describe('pi-ai session cache scope', () => {
  const model: Parameters<typeof piSessionScopeId>[2] = {
    id: 'gpt-5.4',
    api: 'openai-codex-responses' as const,
    baseUrl: 'https://a.example/api',
    headers: { 'x-model': 'model-value' },
  }
  const credential = codexToken('credential-a')
  const scope = (
    overrides: Partial<{
      sessionId: string
      provider: string
      model: typeof model
      generation: number
      headers: Record<string, string>
      credential: string
    }> = {},
  ): string | undefined => piSessionScopeId(
    overrides.sessionId ?? 'harness-session',
    overrides.provider ?? 'openai-codex',
    overrides.model ?? model,
    overrides.generation ?? 1,
    overrides.headers ?? { 'x-route': 'route-value', 'X-Order': 'last' },
    overrides.credential ?? credential,
  )

  it('is stable, fixed-length, and opaque within one complete request scope', () => {
    const first = scope()
    const reordered = scope({ headers: { 'X-Order': 'last', 'x-route': 'route-value' } })

    expect(first).toBe(reordered)
    expect(first).toMatch(/^dsh-[A-Za-z0-9_-]{43}$/)
    expect(first?.length).toBeLessThanOrEqual(64)
    for (const secret of [
      'harness-session',
      'openai-codex',
      'gpt-5.4',
      'openai-codex-responses',
      'a.example',
      'route-value',
      'model-value',
      credential,
    ]) expect(first).not.toContain(secret)
  })

  it('separates every cache-owning request dimension', () => {
    const first = scope()
    const variants = [
      scope({ sessionId: 'another-session' }),
      scope({ provider: 'another-route' }),
      scope({ model: { ...model, id: 'gpt-5.4-mini' } }),
      scope({ model: { ...model, api: 'openai-responses' } }),
      scope({ model: { ...model, baseUrl: 'https://b.example/api' } }),
      scope({ generation: 2 }),
      scope({ headers: { 'x-route': 'another-value', 'X-Order': 'last' } }),
      scope({ credential: codexToken('credential-b') }),
    ]

    expect(new Set([first, ...variants])).toHaveLength(variants.length + 1)
  })

  it('disables persistent SDK sessions for absent sessions and ambient credentials', () => {
    expect(piSessionScopeId(undefined, 'openai-codex', model, 1, {}, credential)).toBeUndefined()
    expect(piSessionScopeId('session', 'openai-codex', model, 1, {}, undefined)).toBeUndefined()
  })

  const profiles = (baseURL: string, headers?: Record<string, string>) => resolveProfiles({
    'openai-codex': {
      apiKeyEnv: 'PI_TEST_KEY',
      baseURL,
      transport: 'websocket-cached',
      ...headers === undefined ? {} : { headers },
    },
  })

  const profilesWithUnrelatedRoute = (baseURL: string, unrelatedBaseURL: string) => resolveProfiles({
    'openai-codex': {
      apiKeyEnv: 'PI_TEST_KEY', baseURL, transport: 'websocket-cached',
    },
    deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: unrelatedBaseURL },
  })

  const drain = async (adapter: PiAiAdapter): Promise<unknown[]> => {
    const chunks = []
    for await (const _chunk of adapter.stream({
      provider: 'openai-codex',
      model: 'gpt-5.4',
      sessionId: 'shared-harness-session' as never,
      messages: [],
    })) chunks.push(_chunk)
    return chunks
  }

  it('reuses only an identical endpoint, snapshot, and credential scope', async () => {
    vi.stubGlobal('WebSocket', FakeCodexWebSocket)
    FakeCodexWebSocket.reset()
    let current = profiles('https://a.example/api')
    let credential = codexToken('credential-a')
    const adapter = new PiAiAdapter({
      profiles: () => current,
      resolveApiKey: () => Promise.resolve(credential),
    })

    const first = await drain(adapter)
    expect(first.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    current = profiles('https://b.example/api')
    await drain(adapter)
    expect(FakeCodexWebSocket.sockets).toHaveLength(2)
    expect(String(FakeCodexWebSocket.sockets[0]?.url)).toBe('wss://a.example/api/codex/responses')
    expect(String(FakeCodexWebSocket.sockets[1]?.url)).toBe('wss://b.example/api/codex/responses')
    expect(FakeCodexWebSocket.sockets[1]?.sent[0]).not.toHaveProperty('previous_response_id')

    await drain(adapter)
    expect(FakeCodexWebSocket.sockets).toHaveLength(2)
    expect(FakeCodexWebSocket.sockets[1]?.sent).toHaveLength(2)

    credential = codexToken('credential-b')
    await drain(adapter)
    expect(FakeCodexWebSocket.sockets).toHaveLength(3)
    expect(FakeCodexWebSocket.sockets[2]?.sent[0]).not.toHaveProperty('previous_response_id')
  })

  it('does not carry one profile generation\'s SSE fallback into the next', async () => {
    vi.stubGlobal('WebSocket', FakeCodexWebSocket)
    FakeCodexWebSocket.reset()
    FakeCodexWebSocket.failNextRequest = true
    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      codexEvents('sse-response').map(event => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )))
    vi.stubGlobal('fetch', fetchMock)
    let current = profiles('https://a.example/api')
    const adapter = new PiAiAdapter({
      profiles: () => current,
      resolveApiKey: () => Promise.resolve(codexToken('credential-a')),
    })

    await drain(adapter)
    expect(FakeCodexWebSocket.sockets).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    current = profiles('https://a.example/api', { 'x-profile-generation': 'next' })
    await drain(adapter)
    expect(FakeCodexWebSocket.sockets).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps an unchanged route cache when an unrelated provider changes', async () => {
    vi.stubGlobal('WebSocket', FakeCodexWebSocket)
    FakeCodexWebSocket.reset()
    let current = profilesWithUnrelatedRoute('https://a.example/api', 'https://b.example/api')
    const adapter = new PiAiAdapter({
      profiles: () => current,
      resolveApiKey: () => Promise.resolve(codexToken('credential-a')),
    })

    await drain(adapter)
    current = profilesWithUnrelatedRoute('https://a.example/api', 'https://c.example/api')
    await drain(adapter)

    // Route A's profile and endpoint did not change, so the cached SDK
    // session remains attached and the second request reuses its response id.
    expect(FakeCodexWebSocket.sockets).toHaveLength(1)
    expect(FakeCodexWebSocket.sockets[0]?.sent).toHaveLength(2)
    expect(FakeCodexWebSocket.sockets[0]?.sent[1]?.prompt_cache_key)
      .toBe(FakeCodexWebSocket.sockets[0]?.sent[0]?.prompt_cache_key)
  })

  it('does not reuse a removed route cache scope when the route is re-added', async () => {
    vi.stubGlobal('WebSocket', FakeCodexWebSocket)
    FakeCodexWebSocket.reset()
    let current = profiles('https://a.example/api')
    const adapter = new PiAiAdapter({
      profiles: () => current,
      resolveApiKey: () => Promise.resolve(codexToken('credential-a')),
    })

    await drain(adapter)
    current = resolveProfiles({})
    await expect(adapter.listModels('openai-codex')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    current = profiles('https://a.example/api')
    await drain(adapter)

    expect(FakeCodexWebSocket.sockets).toHaveLength(2)
    expect(FakeCodexWebSocket.sockets[1]?.sent[0]).not.toHaveProperty('previous_response_id')
  })
})

describe('PiAiAdapter provider routing', () => {
  it('resolves a catalog model dynamically and uses a private endpoint', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, {
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })
    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 1, reasoningTokens: 0 })
    expect(server.paths).toEqual(['/chat/completions'])
  })

  it('uses the target protocol defaults after repointing a catalog model', async () => {
    const server = await mockServer([{ status: 401 }])
    const ctx = await harness(`${server.url}/v1`, {
      api: 'openai-responses',
      models: [{ id: 'deepseek-v4-flash' }],
    })

    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      system: 'policy',
      messages: [],
    })

    const request = server.requests[0] as { input?: Array<{ role?: string }> } | undefined
    expect(request?.input?.[0]?.role).toBe('developer')
  })

  it('drops foreign reasoning spellings after repointing a catalog model', async () => {
    const server = await mockServer([{ status: 401 }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        google: {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-responses',
          baseURL: `${server.url}/v1`,
          models: [{ id: 'gemini-3-pro-preview' }],
        },
      },
    })

    await assemble(ctx, {
      provider: 'google',
      model: 'gemini-3-pro-preview',
      reasoningEffort: ReasoningEffortId('high'),
      messages: [],
    })

    const request = server.requests[0] as { reasoning?: { effort?: string } } | undefined
    expect(request?.reasoning?.effort).toBe('high')
  })

  it('merges profile headers with Harness attribution winning', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url, {
      headers: { 'x-company': 'private', 'User-Agent': 'wrong' },
    })
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(server.headers[0]?.['x-company']).toBe('private')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('forwards common stream options and profile reasoning', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url, {
      reasoning: 'max',
      cacheRetention: 'none',
      transport: 'sse',
      timeoutMs: 5000,
      websocketConnectTimeoutMs: 3000,
      streamIdleTimeoutMs: 10_000,
      thinkingBudgets: { high: 2048 },
    })
    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      messages: [],
      temperature: 0.2,
      maxTokens: 77,
      sessionId: 'session-for-pi' as never,
    })
    expect(server.requests[0]).toMatchObject({
      model: 'deepseek-v4-flash',
      temperature: 0.2,
      max_completion_tokens: 77,
      thinking: { type: 'enabled' },
      reasoning_effort: 'max',
    })
  })

  it('uses a dynamic request effort and reports unsupported efforts before network I/O', async () => {
    const server = await mockServer([{ events: textEvents }, { events: textEvents }])
    const ctx = await harness(server.url, { reasoning: 'max' })

    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      reasoningEffort: ReasoningEffortId('high'),
      messages: [],
    })
    expect(server.requests[0]).toMatchObject({ reasoning_effort: 'high' })

    await assemble(ctx, {
      model: 'deepseek-v4-flash',
      reasoningEffort: ReasoningEffortId('off'),
      messages: [],
    })
    expect(server.requests[1]).toMatchObject({ thinking: { type: 'disabled' } })
    expect(server.requests[1]).not.toHaveProperty('reasoning_effort')

    const unsupported = await assemble(ctx, {
      model: 'deepseek-v4-flash',
      reasoningEffort: ReasoningEffortId('xhigh'),
      messages: [],
    })
    expect(unsupported.finish).toMatchObject({
      kind: 'error',
      failure: { code: 'UNSUPPORTED_REASONING_EFFORT' },
    })
    expect(server.requests).toHaveLength(2)
  })

  it('preserves omitted profile options when constructing the adapter directly', async () => {
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['deepseek'], adapterOf({
      deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url },
    }))

    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })

    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
  })

  it('names a route by its displayName, and by its own key once the profiles drop it', () => {
    const adapter = adapterOf({ 'acme-gateway': {
      displayName: 'Acme Gateway',
      api: 'openai-completions',
      baseURL: 'https://acme.test/v1',
      models: [{ id: 'acme-large' }],
    } })
    expect(adapter.providerInfo('acme-gateway')).toEqual({ id: 'acme-gateway', name: 'Acme Gateway' })

    // The registry and the profiles can disagree for a moment: a refused
    // registration swap leaves the previous routes serving while resolution
    // has already moved on, so a selector may ask about a route the current
    // profiles no longer describe. It gets the key rather than nothing.
    expect(adapter.providerInfo('departed')).toEqual({ id: 'departed', name: 'departed' })
  })

  it('reports unsupported stop sequences rather than silently ignoring them', async () => {
    const server = await mockServer([])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [], stop: ['END'] })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'UNSUPPORTED_OPTION' } })
    expect(server.requests).toEqual([])
  })

  it('reports unknown catalog models before network I/O', async () => {
    const server = await mockServer([])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'not-in-the-catalog', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'UNKNOWN_MODEL' } })
    expect(server.requests).toEqual([])
  })

  it('uses the catalog API implementation, including OpenAI Responses', async () => {
    const server = await mockServer([{ status: 401, body: JSON.stringify({ error: { message: 'expected mock failure' } }) }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: { openai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${server.url}/v1` } },
    })
    const result = await assemble(ctx, { provider: 'openai', model: 'gpt-4.1', messages: [] })
    expect(result.finish.kind).toBe('error')
    expect(server.paths).toEqual(['/v1/responses'])
  })

  it('resolves an attachment service mounted after the adapter when dispatching an image', async () => {
    const server = await mockServer([{ status: 401, body: JSON.stringify({ error: { message: 'expected mock failure' } }) }])
    const attachmentId = AttachmentId(`sha256:${'a'.repeat(64)}`)
    const ref: ImageAttachmentRef = {
      attachmentId,
      mediaType: 'image/png',
      bytes: 1,
      width: 1,
      height: 1,
    }
    const readImage = vi.fn((_ref: ImageAttachmentRef): Promise<StoredImageAttachment> =>
      Promise.resolve({ ref, data: Uint8Array.of(1) }))

    class LateAttachmentStore extends AttachmentStore {
      readonly imageLimits: ImageAttachmentLimits = {
        maxImageBytes: 1,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1,
        maxImagePixels: 1,
        mediaTypes: ['image/png'],
      }

      validateImage(_input: SaveImageAttachment): Promise<void> {
        return Promise.reject(new Error('not used'))
      }

      saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        return Promise.reject(new Error('not used'))
      }

      readImage(value: ImageAttachmentRef): Promise<StoredImageAttachment> {
        return readImage(value)
      }
    }

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: { openai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${server.url}/v1` } },
    })
    await ctx.plugin(LateAttachmentStore)

    const result = await assemble(ctx, {
      provider: 'openai',
      model: 'gpt-4.1',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })

    expect(result.finish.kind).toBe('error')
    expect(readImage).toHaveBeenCalledWith(ref)
    expect(server.paths).toEqual(['/v1/responses'])
  })

  it('forces one wire request for an SDK-retryable provider failure', async () => {
    const server = await mockServer([
      {
        status: 429,
        headers: { 'retry-after-ms': '1' },
        body: JSON.stringify({ error: { message: 'retryable provider failure' } }),
      },
      { status: 500, body: JSON.stringify({ error: { message: 'hidden SDK retry' } }) },
      { status: 500, body: JSON.stringify({ error: { message: 'second hidden SDK retry' } }) },
    ])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: { openai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${server.url}/v1` } },
    })

    const result = await assemble(ctx, { provider: 'openai', model: 'gpt-4.1', messages: [] })

    expect(result.finish).toMatchObject({ kind: 'error' })
    expect(server.paths).toEqual(['/v1/responses'])
  })

  it('uses OpenAI Responses against an Azure project v1 path with its API key header', async () => {
    const server = await mockServer([{ status: 401, body: JSON.stringify({ error: { message: 'expected mock failure' } }) }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        openai: {
          apiKeyEnv: 'PI_TEST_KEY',
          baseURL: `${server.url}/api/projects/openai/openai/v1`,
          headers: { 'api-key': 'test-key', Authorization: '' },
        },
      },
    })
    const result = await assemble(ctx, { provider: 'openai', model: 'gpt-5.5', messages: [] })
    expect(result.finish.kind).toBe('error')
    expect(server.paths).toEqual(['/api/projects/openai/openai/v1/responses'])
    expect(server.headers[0]?.['api-key']).toBe('test-key')
    expect(server.headers[0]?.authorization).toBe('')
  })

  it.each([
    [401, 'AUTH'],
    [400, 'INVALID_REQUEST'],
    [429, 'RATE_LIMIT'],
    [500, 'SERVER'],
  ] as const)('maps HTTP %s failures to %s', async (status, code) => {
    const server = await mockServer([{ status, body: JSON.stringify({ error: { message: `provider ${status}` } }) }])
    const ctx = await harness(server.url)
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code } })
    expect(server.paths).toEqual(['/chat/completions'])
  })

  it('uses the resolved catalog context window for usage-based overflow detection', async () => {
    const model = getBuiltinModels('deepseek').find(candidate => candidate.id === 'deepseek-v4-flash')
    if (model === undefined) throw new Error('deepseek-v4-flash missing from pi-ai test catalog')
    const events = [
      '{"choices":[{"delta":{"role":"assistant","content":""},"index":0,"finish_reason":null}]}',
      JSON.stringify({
        choices: [{ delta: {}, index: 0, finish_reason: 'stop' }],
        usage: { prompt_tokens: model.contextWindow + 1, completion_tokens: 0 },
      }),
      '[DONE]',
    ]
    const server = await mockServer([{ events }])
    const ctx = await harness(server.url)

    const result = await assemble(ctx, { model: model.id, messages: [] })

    expect(result.finish).toEqual({
      kind: 'error',
      failure: {
        message: `pi-ai detected context overflow for model "${model.id}"`,
        code: CONTEXT_WINDOW_EXCEEDED_CODE,
      },
    })
  })

  it('stops the SDK request when the adapter idle watchdog expires', async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 200 }])
    const ctx = await harness(server.url, { streamIdleTimeoutMs: 20 })

    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'TIMEOUT' } })
    await Promise.race([
      server.responseClosed,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => { reject(new Error('SDK request did not close after idle timeout')) }, 1_000)
      }),
    ])

    expect(server.paths).toEqual(['/chat/completions'])
    expect(server.closedResponses).toBe(1)
  })
})

describe('provider profile lifecycle', () => {
  it('keeps adapter helpers off the package root', () => {
    for (const helper of [
      'resolveProfiles',
      'toPiContext',
      'toPiReplayState',
      'toPiAssistant',
      'mapStopReason',
      'mapUsage',
      'toStreamChunks',
    ]) expect(LlmPiAi).not.toHaveProperty(helper)
  })

  it('registers every profile atomically and unregisters on dispose', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(LlmPiAi, {
      providers: {
        openai: {
          retryPolicy: {
            mode: 'always',
            backoff: { initialDelayMs: 25, maxDelayMs: 100, jitterRatio: 0.2 },
          },
        },
        anthropic: {},
      },
    })
    expect(ctx.llm.listProviders()).toEqual([
      { id: 'openai', name: 'openai' },
      { id: 'anthropic', name: 'anthropic' },
    ])
    expect(ctx.llm.providerRetryPolicy('openai')).toEqual({
      mode: 'always',
      initialDelayMs: 25,
      maxDelayMs: 100,
      jitterRatio: 0.2,
    })
    expect(ctx.llm.providerRetryPolicy('anthropic')).toMatchObject({
      mode: 'normal',
      maxRetries: 2,
    })
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('exposes the installed pi-ai model catalog through provider-neutral metadata', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, { providers: { openai: {} } })
    const models = await ctx.llm.listModels('openai')
    expect(models.find(model => model.id === 'gpt-4.1')).toEqual({
      provider: 'openai', id: 'gpt-4.1', name: 'GPT-4.1',
      inputModalities: ['text', 'image'],
    })
    expect(models.every(model => model.provider === 'openai')).toBe(true)
    const info = await ctx.llm.resolveModelInfo('openai', 'gpt-4.1')
    expect(typeof info.context?.contextWindow).toBe('number')
  })

  it('exposes pi-ai model thinking levels verbatim without inventing a provider default', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: { deepseek: {}, openai: {} },
    })

    await expect(ctx.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash'))
      .resolves.toMatchObject({
        reasoning: {
          efforts: [
            { id: ReasoningEffortId('off'), name: 'Off' },
            { id: ReasoningEffortId('high'), name: 'High' },
            { id: ReasoningEffortId('max'), name: 'Max' },
          ],
        },
      })
    const extended = await ctx.llm.resolveModelInfo('openai', 'gpt-5.6-sol')
    expect(extended.reasoning?.efforts.map(effort => effort.id)).toEqual([
      ReasoningEffortId('off'),
      ReasoningEffortId('low'),
      ReasoningEffortId('medium'),
      ReasoningEffortId('high'),
      ReasoningEffortId('xhigh'),
      ReasoningEffortId('max'),
    ])
    // A catalog model without reasoning is the same case as a hand-declared
    // one: pi-ai reports the single level `off`, which translates to omitting
    // the reasoning option — exactly what naming no effort already does. The
    // capability is reported unavailable rather than offering that control.
    expect((await ctx.llm.resolveModelInfo('openai', 'gpt-4.1')).reasoning).toBeUndefined()
  })

  it('uses a supported profile reasoning value as the model default and rejects an unsupported one', async () => {
    const supported = new Context()
    await supported.plugin(LlmRuntime)
    await supported.plugin(LlmPiAi, {
      providers: { deepseek: { reasoning: 'max' } },
    })
    await expect(supported.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash'))
      .resolves.toMatchObject({ reasoning: { defaultEffort: ReasoningEffortId('max') } })

    // A profile level this model cannot take DESCRIBES as no default rather
    // than failing: resolveModelInfo builds the model catalog, and a catalog
    // that throws takes its whole provider out of every picker — one mis-set
    // field would hide every model on the route, including the ones that do
    // support the level. The request path below is where it is refused.
    const unsupported = new Context()
    await unsupported.plugin(LlmRuntime)
    await unsupported.plugin(LlmPiAi, {
      providers: { deepseek: { reasoning: 'medium' } },
    })
    const described = await unsupported.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash')
    expect(described.reasoning?.defaultEffort).toBeUndefined()
    expect(described.reasoning?.efforts.length).toBeGreaterThan(0)
    await expect(assemble(unsupported, {
      provider: 'deepseek', model: 'deepseek-v4-flash', messages: [],
    })).resolves.toMatchObject({
      finish: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT' } },
    })

    const disabled = new Context()
    await disabled.plugin(LlmRuntime)
    await disabled.plugin(LlmPiAi, {
      providers: { deepseek: { reasoning: 'off' } },
    })
    await expect(disabled.llm.resolveModelInfo('deepseek', 'deepseek-v4-flash'))
      .resolves.toMatchObject({ reasoning: { defaultEffort: ReasoningEffortId('off') } })
  })

  it('serves declared reasoning efforts to selectors and honours the profile default', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: 'https://acme.test/v1',
          compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
          reasoning: 'high',
          models: [{
            id: 'acme-think',
            contextWindow: 65_536,
            maxTokens: 4096,
            reasoningEfforts: { off: null, low: 'low', high: 'high' },
          }],
        },
      },
    })

    // Declared levels reach the same seam catalog metadata does, so the
    // effort picker works for a model pi-ai has never heard of.
    await expect(ctx.llm.resolveModelInfo('acme-gateway', 'acme-think')).resolves.toMatchObject({
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('off'), name: 'Off' },
          { id: ReasoningEffortId('low'), name: 'Low' },
          { id: ReasoningEffortId('high'), name: 'High' },
        ],
        defaultEffort: ReasoningEffortId('high'),
      },
    })
  })

  it('sends the declared wire spelling and refuses undeclared levels before network I/O', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
          models: [{
            id: 'acme-think',
            contextWindow: 65_536,
            maxTokens: 4096,
            reasoningEfforts: { off: null, high: 'ultra' },
          }],
        },
      },
    })

    await assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId('high'),
      messages: [],
    })
    // The declared value, not the canonical level name, goes on the wire.
    expect(server.requests[0]).toMatchObject({ reasoning_effort: 'ultra' })

    const undeclared = await assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId('max'),
      messages: [],
    })
    expect(undeclared.finish).toMatchObject({
      kind: 'error',
      failure: { code: 'UNSUPPORTED_REASONING_EFFORT' },
    })
    expect(server.requests).toHaveLength(1)
  })

  it('dispatches the compat-switched dialect on a declared route', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }, { events: textEvents }, { events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          // Without the switch pi-ai guesses the dialect from the endpoint
          // URL, and a private gateway's URL says nothing.
          compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: true },
          models: [{
            id: 'acme-think',
            contextWindow: 65_536,
            maxTokens: 4096,
            reasoningEfforts: { off: null, low: 'low', high: 'high' },
          }],
        },
      },
    })
    const prompt = (effort: string): Promise<unknown> => assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId(effort),
      messages: [],
    })

    await prompt('high')
    expect(server.requests[0]).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'high' })

    await prompt('low')
    expect(server.requests[1]).toMatchObject({ thinking: { type: 'enabled' }, reasoning_effort: 'low' })
    expect(server.requests[1]).not.toEqual(server.requests[0])

    await prompt('off')
    expect(server.requests[2]).toMatchObject({ thinking: { type: 'disabled' } })
    expect(server.requests[2]).not.toHaveProperty('reasoning_effort')
  })

  it('sends a declared off value as the effort parameter instead of omitting it', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
          models: [{
            id: 'acme-think',
            contextWindow: 65_536,
            maxTokens: 4096,
            reasoningEfforts: { off: 'none', high: 'high' },
          }],
        },
      },
    })

    // The adapter strips a selected Off to "no reasoning option", and pi-ai's
    // dispatch reads thinkingLevelMap.off exactly then — so the declared value
    // still reaches the wire, which is the README's promise for `off: none`.
    await assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId('off'),
      messages: [],
    })
    expect(server.requests[0]).toMatchObject({ reasoning_effort: 'none' })
  })

  it('rejects a reasoning declaration when compat leaves its wire control ambiguous', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: 'https://acme.test/v1',
          compat: { supportsReasoningEffort: false },
          models: [{
            id: 'acme-think',
            contextWindow: 65_536,
            maxTokens: 4096,
            reasoningEfforts: { off: null, high: 'high' },
          }],
        },
      },
    })).rejects.toThrow(/without a resolved thinkingFormat/)
  })

  it('dispatches one valueless positive level through a binary thinking dialect', async () => {
    vi.stubEnv('PI_TEST_KEY', 'test-key')
    const server = await mockServer([{ events: textEvents }, { events: textEvents }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        'acme-gateway': {
          apiKeyEnv: 'PI_TEST_KEY',
          api: 'openai-completions',
          baseURL: `${server.url}/v1`,
          compat: { thinkingFormat: 'deepseek', supportsReasoningEffort: false },
          models: [{
            id: 'acme-think',
            reasoningEfforts: { off: null, high: null },
          }],
        },
      },
    })

    await assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId('high'),
      messages: [],
    })
    await assemble(ctx, {
      provider: 'acme-gateway',
      model: 'acme-think',
      reasoningEffort: ReasoningEffortId('off'),
      messages: [],
    })

    expect(server.requests[0]).toMatchObject({ thinking: { type: 'enabled' } })
    expect(server.requests[0]).not.toHaveProperty('reasoning_effort')
    expect(server.requests[1]).toMatchObject({ thinking: { type: 'disabled' } })
  })

  it('accepts absent credentials for pi-ai ambient authentication', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'ambient-key')
    const server = await mockServer([{ events: textEvents }])
    // A profile that names no reference at all is the one case that defers to
    // pi-ai's own provider-native discovery.
    const ctx = await harness(server.url, { apiKeyEnv: undefined })
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(server.headers[0]?.authorization).toBe('Bearer ambient-key')
  })

  it('falls back to the ambient environment for apiKeyEnv without the credentials seam', async () => {
    vi.stubEnv('PI_CUSTOM_REF_KEY', 'custom-ref-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url, { apiKey: undefined, apiKeyEnv: 'PI_CUSTOM_REF_KEY' })
    await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(server.headers[0]?.authorization).toBe('Bearer custom-ref-key')
  })

  it('fails a named-but-missing apiKeyEnv instead of using another ambient key', async () => {
    // The exact confusion this guards: the named reference is empty while an
    // unrelated provider key sits in the environment. Deferring to pi-ai's own
    // discovery here would authenticate as another tenant.
    vi.stubEnv('PI_CUSTOM_REF_KEY', '')
    vi.stubEnv('DEEPSEEK_API_KEY', 'ambient-key')
    const server = await mockServer([{ events: textEvents }])
    const ctx = await harness(server.url, { apiKey: undefined, apiKeyEnv: 'PI_CUSTOM_REF_KEY' })
    const first = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(first.finish).toMatchObject({ kind: 'error', failure: { code: 'MISSING_CREDENTIAL' } })
    const second = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [] })
    expect(second.finish.kind).toBe('error')
    if (second.finish.kind !== 'error') throw new Error('expected an error finish')
    expect(second.finish.failure.message).toMatch(/provider route "deepseek".*PI_CUSTOM_REF_KEY/s)
    expect(server.requests).toHaveLength(0)
  })

  it('validates empty, underspecified, legacy-shaped, and explicitly blank profiles', () => {
    // Empty and omitted dicts are the dormant zero-route posture, not errors.
    expect(resolveProfiles({}).size).toBe(0)
    expect(resolveProfiles(undefined).size).toBe(0)
    expect(() => resolveProfiles({ '': {} })).toThrow(/non-empty/)
    // A route the installed catalog does not ship is allowed, but it has no
    // defaults to fall back on: it must describe its own models.
    expect(() => resolveProfiles({ 'not-real': {} })).toThrow(/resolves no models/)
    // The pre-release array shape and its per-profile provider field fail
    // loud with migration directions instead of half-working.
    expect(() => resolveProfiles([{ provider: 'openai' }] as never)).toThrow(/dict keyed by provider/)
    expect(() => resolveProfiles({ openai: { provider: 'openai' } as never })).toThrow(/moved to the providers dict key/)
    expect(() => resolveProfiles({ openai: { baseURL: '' } })).toThrow(/empty baseURL/)
    expect(() => resolveProfiles({ openai: { apiKeyEnv: 'not-a-var!' } })).toThrow(/must match/)
  })

  it.each(['maxRetries', 'maxRetryDelayMs'] as const)(
    'rejects removed profile field %s instead of silently restoring hidden SDK retries',
    async (field) => {
      const legacy = { [field]: 2 }
      expect(() => resolveProfiles({ openai: legacy })).toThrow(/removed.*agent recovery/i)
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      await expect(ctx.plugin(LlmPiAi, { providers: { openai: legacy } }))
        .rejects.toThrow(/removed.*agent recovery/i)
    },
  )

  it('rejects invalid stream tunables at plugin load', async () => {
    const invalid = [
      { timeoutMs: -1 },
      { timeoutMs: MAX_TIMER_DELAY_MS + 1 },
      { websocketConnectTimeoutMs: -1 },
      { websocketConnectTimeoutMs: MAX_TIMER_DELAY_MS + 1 },
      { streamIdleTimeoutMs: 0 },
      { streamIdleTimeoutMs: Number.NaN },
      { streamIdleTimeoutMs: MAX_TIMER_DELAY_MS + 1 },
    ]
    for (const entry of invalid) {
      const ctx = new Context()
      await ctx.plugin(LlmRuntime)
      await expect(ctx.plugin(LlmPiAi, { providers: { openai: { ...entry } } }))
        .rejects.toThrow()
    }
  })

  it('rejects invalid nested retryPolicy at the provider-profile boundary', async () => {
    expect(() => resolveProfiles({
      openai: { retryPolicy: { mode: 'always', backoff: { jitterRatio: -1 } } },
    })).toThrow(/retryPolicy\.backoff\.jitterRatio/)

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await expect(ctx.plugin(LlmPiAi, {
      providers: { openai: { retryPolicy: { mode: 'normal', maxRetries: -1 } } },
    })).rejects.toThrow(/retryPolicy/)
    expect(ctx.llm.listProviders()).toEqual([])
  })

  it('constructs the adapter directly and rejects routes it does not own', async () => {
    const adapter = adapterOf({ openai: {} })
    await expect(adapter.listModels('anthropic')).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(adapter.resolveModel('anthropic', 'claude-sonnet-4'))
      .rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(adapter.resolveModel('openai', 'not-a-catalog-model'))
      .rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
    await expect((async () => {
      for await (const _chunk of adapter.stream({ provider: 'anthropic', model: 'claude-sonnet-4', messages: [] })) { /* drain */ }
    })()).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    expect(new LlmError('x', 'X')).toBeInstanceOf(Error)
  })

  it('rejects unsupported or unresolved image input before provider I/O', async () => {
    const adapter = adapterOf({ openai: {}, deepseek: {} })
    const drain = async (options: Parameters<PiAiAdapter['stream']>[0]): Promise<void> => {
      for await (const _chunk of adapter.stream(options)) { /* drain */ }
    }

    await expect(drain({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: IMAGE_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(drain({
      provider: 'openai',
      model: 'gpt-4.1',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: IMAGE_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    await expect(drain({
      provider: 'openai',
      model: 'gpt-4.1',
      messages: [createUserMessage({
        content: [{
          type: 'tool-result',
          toolCallId: 'call-outer' as never,
          content: [{
            type: 'tool-result',
            toolCallId: 'call-inner' as never,
            content: [{ type: 'image', attachment: IMAGE_REF }],
          }],
        }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
  })

  it('validates profiles at the shared resolver boundary', () => {
    expect(() => resolveProfiles({
      openai: { timeoutMs: MAX_TIMER_DELAY_MS + 1 },
    })).toThrow(/timeoutMs.*no greater/)
    expect(() => resolveProfiles({
      openai: { websocketConnectTimeoutMs: MAX_TIMER_DELAY_MS + 1 },
    })).toThrow(/websocketConnectTimeoutMs.*no greater/)
    expect(() => resolveProfiles({
      openai: {
        timeoutMs: MAX_TIMER_DELAY_MS,
        websocketConnectTimeoutMs: MAX_TIMER_DELAY_MS,
      },
    })).not.toThrow()
    expect(() => resolveProfiles({
      openai: { streamIdleTimeoutMs: 0 },
    })).toThrow(/streamIdleTimeoutMs.*positive finite/)
    expect(() => resolveProfiles({
      openai: { streamIdleTimeoutMs: MAX_TIMER_DELAY_MS + 1 },
    })).toThrow(/streamIdleTimeoutMs.*no greater/)
  })
})

describe('abort wiring', () => {
  it('forwards caller cancellation into attachment hydration before provider dispatch', async () => {
    const server = await mockServer([])
    const observed = Promise.withResolvers<AbortSignal | undefined>()
    const release = Promise.withResolvers<StoredImageAttachment>()

    class BlockingAttachmentStore extends AttachmentStore {
      readonly imageLimits: ImageAttachmentLimits = {
        maxImageBytes: 1,
        maxImagesPerMessage: 1,
        maxMessageImageBytes: 1,
        maxImagePixels: 1,
        mediaTypes: ['image/png'],
      }

      validateImage(_input: SaveImageAttachment): Promise<void> {
        return Promise.reject(new Error('not used'))
      }

      saveImage(_input: SaveImageAttachment): Promise<ImageAttachmentRef> {
        return Promise.reject(new Error('not used'))
      }

      readImage(_ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment> {
        observed.resolve(signal)
        if (signal === undefined) return release.promise
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => { reject(new Error(String(signal.reason))) }, { once: true })
        })
      }
    }

    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: { openai: { apiKeyEnv: 'PI_TEST_KEY', baseURL: `${server.url}/v1` } },
    })
    await ctx.plugin(BlockingAttachmentStore)
    const controller = new AbortController()
    const pending = assemble(ctx, {
      provider: 'openai',
      model: 'gpt-4.1',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: IMAGE_REF }],
        source: { kind: 'plugin', plugin: 'test' },
      })],
      signal: controller.signal,
    })

    const attachmentSignal = await observed.promise
    controller.abort('cancelled during attachment hydration')
    if (attachmentSignal === undefined) release.resolve({ ref: IMAGE_REF, data: Uint8Array.of(1) })
    const result = await pending

    expect(attachmentSignal).toBeDefined()
    expect(attachmentSignal?.aborted).toBe(true)
    expect(result.finish.kind).toBe('aborted')
    expect(server.requests).toEqual([])
  })

  it('preserves an unknown pre-dispatch adapter Error exactly', async () => {
    const original = new Error('SDK context conversion exploded')
    const message = Object.defineProperty({}, 'content', {
      get() { throw original },
    })
    const adapter = adapterOf({ deepseek: {} })
    const drain = async (): Promise<void> => {
      for await (const _chunk of adapter.stream({
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        messages: [message as never],
      })) { /* drain */ }
    }

    await expect(drain()).rejects.toBe(original)
  })

  it('lets a concurrent caller abort classify a pre-dispatch adapter failure', async () => {
    const controller = new AbortController()
    const original = new Error('conversion lost its caller')
    const message = Object.defineProperty({}, 'content', {
      get() {
        controller.abort('caller cancelled during conversion')
        throw original
      },
    })
    const adapter = adapterOf({ deepseek: {} })
    const drain = async (): Promise<void> => {
      for await (const _chunk of adapter.stream({
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        messages: [message as never],
        signal: controller.signal,
      })) { /* drain */ }
    }

    await expect(drain()).rejects.toMatchObject({ code: 'ABORTED', cause: original })
  })

  it('resolves catalog endpoints without an override before honoring pre-abort', async () => {
    const adapter = adapterOf({ deepseek: {} })
    const controller = new AbortController()
    controller.abort('already stopped')
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      messages: [],
      signal: controller.signal,
    })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
  })

  it('honors a pre-aborted caller signal', async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 20 }])
    const ctx = await harness(server.url)
    const controller = new AbortController()
    controller.abort('already stopped')
    const result = await assemble(ctx, { model: 'deepseek-v4-flash', messages: [], signal: controller.signal })
    expect(result.finish.kind).toBe('aborted')
  })

  it('forwards an abort that arrives while provider streaming is active', async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 30 }])
    const ctx = await harness(server.url)
    const controller = new AbortController()
    const resultPromise = assemble(ctx, {
      model: 'deepseek-v4-flash', messages: [], signal: controller.signal,
    })
    setTimeout(() => { controller.abort('stopped during stream') }, 10)
    const result = await resultPromise
    expect(result.finish.kind).toBe('aborted')
  })

  it('aborts upstream when a consumer stops early', async () => {
    const server = await mockServer([{ events: textEvents, delayMs: 30 }])
    const ctx = await harness(server.url)
    for await (const chunk of ctx.llm.stream({ provider: 'deepseek', model: 'deepseek-v4-flash', messages: [] })) {
      if (chunk.type === 'block-start') break
    }
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(server.requests).toHaveLength(1)
  })
})
