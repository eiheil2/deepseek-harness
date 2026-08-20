/**
 * Package-owned relational invariants for the session event log. Load this
 * companion beside `@deepseek-ai/dsh-invariants` to enable the checks.
 *
 * @module @deepseek-ai/dsh-session/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertNever } from '@deepseek-ai/dsh-llm'
import type { CallId } from '@deepseek-ai/dsh-llm'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { TOOL_NOT_STARTED } from './repair.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-session'

/** Cordis companion plugin name. */
export const name = 'session-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Per-session bookkeeping for relational log checks. */
interface SessionTrace {
  lastSeq: number
  openTurn: number | null
  openStep: number | null
  nextTurn: number
  nextStep: number
  sawAssistantMessage: boolean
  assistantCalls: Set<CallId>
  pendingCalls: Set<CallId>
}

type CallSetTransition =
  | { kind: 'none' | 'clear' }
  | { kind: 'add'; callIds: readonly CallId[] }
  | { kind: 'delete'; callId: CallId }

/** One accepted event's deferred mutation of a committed session trace. */
interface SessionTraceTransition {
  scalars: Pick<SessionTrace, 'lastSeq' | 'openTurn' | 'openStep' | 'nextTurn' | 'nextStep' | 'sawAssistantMessage'>
  assistantCalls: CallSetTransition
  pendingCalls: CallSetTransition
}

/** Assert that a step-scoped event names the currently open turn and step. */
function requireOpenStep(
  trace: SessionTrace,
  kind: string,
  turn: number,
  step: number,
  fail: InvariantFailure,
): void {
  if (trace.openTurn !== turn || trace.openStep !== step) {
    fail(`${kind} names turn ${turn}/step ${step} but open is turn ${trace.openTurn}/step ${trace.openStep}`)
  }
}

/** Validate one candidate event without mutating the committed trace. */
function validateEvent(
  trace: SessionTrace,
  event: SessionEvent,
  fail: InvariantFailure,
): SessionTraceTransition {
  if (event.seq <= trace.lastSeq) {
    fail(`seq must strictly increase: saw ${event.seq} after ${trace.lastSeq}`)
  }
  let openTurn = trace.openTurn
  let openStep = trace.openStep
  let nextTurn = trace.nextTurn
  let nextStep = trace.nextStep
  let sawAssistantMessage = trace.sawAssistantMessage
  let assistantCalls: CallSetTransition = { kind: 'none' }
  let pendingCalls: CallSetTransition = { kind: 'none' }

  // Context and plugin-owned log-only events may be appended between model
  // executions. Core execution events retain their explicit turn relations.
  switch (event.type) {
    case 'turn/start': {
      if (trace.openTurn !== null) {
        fail(`turn/start ${event.data.turn} while turn ${trace.openTurn} is still open`)
      }
      if (event.data.turn !== trace.nextTurn) {
        fail(`turn/start expected turn ${trace.nextTurn}, got ${event.data.turn}`)
      }
      openTurn = event.data.turn
      nextStep = 1
      break
    }
    case 'turn/end': {
      if (trace.openTurn !== event.data.turn) {
        fail(`turn/end ${event.data.turn} does not match open turn ${trace.openTurn}`)
      }
      if (trace.openStep !== null) {
        fail(`turn/end ${event.data.turn} while step ${trace.openStep} is still open`)
      }
      openTurn = null
      nextTurn += 1
      break
    }
    case 'step/start': {
      if (trace.openTurn !== event.data.turn) {
        fail(`step/start in turn ${event.data.turn} but open turn is ${trace.openTurn}`)
      }
      if (trace.openStep !== null) {
        fail(`step/start ${event.data.step} while step ${trace.openStep} is still open`)
      }
      if (event.data.step !== trace.nextStep) {
        fail(`step/start expected step ${trace.nextStep} in turn ${event.data.turn}, got ${event.data.step}`)
      }
      openStep = event.data.step
      break
    }
    case 'step/end': {
      requireOpenStep(trace, 'step/end', event.data.turn, event.data.step, fail)
      sawAssistantMessage = false
      assistantCalls = { kind: 'clear' }
      pendingCalls = { kind: 'clear' }
      openStep = null
      nextStep += 1
      break
    }
    case 'assistant/chunk': {
      requireOpenStep(trace, 'assistant/chunk', event.data.turn, event.data.step, fail)
      break
    }
    case 'assistant/message': {
      requireOpenStep(trace, 'assistant/message', event.data.turn, event.data.step, fail)
      const callIds: CallId[] = []
      const seen = new Set(trace.assistantCalls)
      for (const block of event.data.message.content) {
        if (block.type !== 'tool-call') continue
        if (seen.has(block.id)) fail(`assistant/message repeats tool-call ${block.id} in this step`)
        seen.add(block.id)
        callIds.push(block.id)
      }
      sawAssistantMessage = true
      assistantCalls = { kind: 'add', callIds }
      break
    }
    case 'tool/call': {
      requireOpenStep(trace, 'tool/call', event.data.turn, event.data.step, fail)
      if (trace.sawAssistantMessage && !trace.assistantCalls.has(event.data.callId)) {
        fail(`tool/call ${event.data.callId} was not declared by an assistant tool-call block in this step`)
      }
      if (trace.sawAssistantMessage) assistantCalls = { kind: 'delete', callId: event.data.callId }
      pendingCalls = { kind: 'add', callIds: [event.data.callId] }
      break
    }
    case 'tool/result': {
      // Session has already validated a content rewrite that cites its replaced event.
      // It is durable turn work, not a second execution of the original call.
      if (event.surfaceOp !== 'append') {
        if (trace.openTurn === null) {
          fail('tool/result surface replacement appended outside any open turn')
        }
        break
      }
      requireOpenStep(trace, 'tool/result', event.data.turn, event.data.step, fail)
      const callId = event.data.message.source.callId
      const syntheticNotStarted = event.data.message.content[0].isError === true && event.data.error?.code === TOOL_NOT_STARTED
      if (!trace.pendingCalls.has(callId) && !syntheticNotStarted) {
        fail(`tool/result for ${callId} with no prior tool/call in this step`)
      }
      if (syntheticNotStarted && trace.sawAssistantMessage) {
        if (!trace.assistantCalls.has(callId)) {
          fail(`not-started tool/result ${callId} was not declared by an assistant tool-call block in this step`)
        }
        assistantCalls = { kind: 'delete', callId }
      } else {
        pendingCalls = { kind: 'delete', callId }
      }
      break
    }
    case 'user/message':
      break
    case 'session/end-seed':
      // Unconstrained: an unbalanced seed legally puts it inside an open turn.
      break
    case 'todo/write':
    case 'request/header':
    case 'request/context': {
      if (trace.openTurn === null) {
        fail(`${event.type} appended outside any open turn (core execution events must be turn-enclosed)`)
      }
      break
    }
    default:
      // Merge-extensible event relations belong to their owning plugin.
      break
  }
  return {
    scalars: { lastSeq: event.seq, openTurn, openStep, nextTurn, nextStep, sawAssistantMessage },
    assistantCalls,
    pendingCalls,
  }
}

/** Apply one deferred call-set mutation. */
function applyCallSetTransition(calls: Set<CallId>, transition: CallSetTransition): void {
  switch (transition.kind) {
    case 'none':
      break
    case 'add':
      for (const callId of transition.callIds) calls.add(callId)
      break
    case 'delete':
      calls.delete(transition.callId)
      break
    case 'clear':
      calls.clear()
      break
    /* v8 ignore next -- validateEvent produces this closed transition union */
    default:
      assertNever(transition, 'session trace call-set transition')
  }
}

/** Apply one already-validated transition after its event commits. */
function applyTransition(trace: SessionTrace, transition: SessionTraceTransition): void {
  Object.assign(trace, transition.scalars)
  applyCallSetTransition(trace.assistantCalls, transition.assistantCalls)
  applyCallSetTransition(trace.pendingCalls, transition.pendingCalls)
}

/** Install the session contribution into its child registration fiber. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, SessionTrace>()
  const stagedTransitions = new WeakMap<SessionEvent, {
    session: Session
    trace: SessionTrace
    transition: SessionTraceTransition
  }>()

  const freshTrace = (): SessionTrace => ({
    lastSeq: -1,
    openTurn: null,
    openStep: null,
    nextTurn: 1,
    nextStep: 1,
    sawAssistantMessage: false,
    assistantCalls: new Set(),
    pendingCalls: new Set(),
  })

  const seedSession = (session: Session): SessionTrace => {
    const trace = freshTrace()
    traces.set(session, trace)
    for (const event of session.events) {
      applyTransition(trace, validateEvent(trace, event, fail))
    }
    return trace
  }

  /* v8 ignore next -- session/event always follows list() or session/created seeding */
  const traceFor = (session: Session): SessionTrace => traces.get(session) ?? seedSession(session)

  for (const session of ctx.sessions.list()) seedSession(session)

  ctx.on('session/created', (session) => { seedSession(session) }, { global: true })

  ctx.on('session/event', (session, event) => {
    const staged = stagedTransitions.get(event)
    /* v8 ignore next 2 -- internal/dispatch stages the exact callback arguments */
    if (staged === undefined || staged.session !== session) {
      return fail('session/event reached publication without matching pre-commit validation')
    }
    stagedTransitions.delete(event)
    applyTransition(staged.trace, staged.transition)
  }, { global: true })

  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const trace = traceFor(session)
    const transition = validateEvent(trace, event, fail)
    // A later dispatch listener may veto. Validation is pure, so abandoning
    // this weakly keyed transition does not advance or retain the session.
    stagedTransitions.set(event, { session, trace, transition })
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the session invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
