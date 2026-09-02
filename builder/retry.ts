/**
 * Retry policy for reaching a model endpoint.
 *
 * Free and shared endpoints answer 429 and 5xx routinely — a PoC run against
 * opencode zen hit 429/502/503 five times in eight attempts. Without a retry
 * the agent stops mid-conversation, and if a tool already ran, its side
 * effect has landed while the caller is told the run failed. Retrying is
 * therefore not a nicety here; it is what keeps the report truthful.
 */

export interface RetryPolicy {
  /** Total attempts per model, including the first. */
  attempts: number;
  /** First backoff step; each retry doubles it. */
  baseDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { attempts: 3, baseDelayMs: 500 };

/**
 * Statuses worth trying again.
 *
 * 429 and 5xx say "not now"; 4xx otherwise says "not like this", and
 * repeating an unauthorised or malformed request only wastes quota.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/** Exponential backoff for `attempt` (1-based, so the first retry waits base). */
export function retryDelayMs(policy: RetryPolicy, attempt: number): number {
  return policy.baseDelayMs * 2 ** (attempt - 1);
}

export function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}
