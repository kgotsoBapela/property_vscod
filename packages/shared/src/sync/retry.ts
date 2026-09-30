import { AdapterError } from "../adapters/types";

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: AdapterError, delayMs: number) => void;
}

export const DEFAULT_RETRY: RetryOptions = { retries: 4, baseDelayMs: 500, maxDelayMs: 30_000, timeoutMs: 30_000 };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function toAdapterError(e: unknown): AdapterError {
  if (e instanceof AdapterError) return e;
  if (e instanceof Error && e.name === "AbortError") return new AdapterError("timeout", e.message);
  return new AdapterError("permanent", e instanceof Error ? e.message : String(e));
}

export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AdapterError("timeout", `Timed out after ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Bounded exponential backoff with full jitter; honours Retry-After for rate limits. */
export async function withRetry<T>(fn: (signal: AbortSignal) => Promise<T>, opts: RetryOptions = DEFAULT_RETRY): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTimeout(fn, opts.timeoutMs);
    } catch (e) {
      const err = toAdapterError(e);
      if (!err.retryable || attempt >= opts.retries) throw err;
      const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
      const delay = err.retryAfterMs ?? Math.round(Math.random() * exp);
      opts.onRetry?.(attempt + 1, err, delay);
      await sleep(Math.min(delay, opts.maxDelayMs));
    }
  }
}
