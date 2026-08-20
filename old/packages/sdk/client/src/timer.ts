/** Timer-range validation shared by the SDK request and teardown paths. */

import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Reject a delay that Node would clamp or schedule inconsistently. */
export function assertSdkTimerDelay(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(`${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}
