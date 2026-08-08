import { config } from "../config.js";

/** Minimal rate limiter: guarantees at least `intervalMs` between requests. */
class RateLimiter {
  private last = 0;
  constructor(private intervalMs: number) {}
  async wait(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.last + this.intervalMs - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
  }
}

const limiter = new RateLimiter(config.requestDelayMs);

export interface HttpOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  retries?: number;
  /** Response codes that should not be retried. */
  noRetry?: number[];
}

export async function httpJson<T = any>(url: string, opts: HttpOptions = {}): Promise<T> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = 30000,
    retries = 3,
    noRetry = [400, 401, 403, 404],
  } = opts;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.wait();
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt * attempt * 1000));
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "user-agent": config.userAgent,
          accept: "application/json, */*",
          ...headers,
        },
        body: body ?? undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (res.status === 429 || (res.status >= 500 && !noRetry.includes(res.status))) {
        lastErr = new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
        continue;
      }
      if (!res.ok) {
        throw new HttpError(res.status, url, text);
      }
      if (!text) return undefined as T;
      return JSON.parse(text) as T;
    } catch (err: any) {
      if (err instanceof HttpError) throw err;
      if (attempt >= retries) throw err;
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error(`request failed: ${url}`);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public body: string
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 300)}`);
  }
}

export async function httpText(url: string, opts: HttpOptions = {}): Promise<string> {
  const res = await rawFetch(url, opts);
  return res;
}

async function rawFetch(url: string, opts: HttpOptions): Promise<string> {
  const { method = "GET", headers = {}, body, timeoutMs = 30000 } = opts;
  await limiter.wait();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { "user-agent": config.userAgent, ...headers },
      body: body ?? undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, text);
    return text;
  } finally {
    clearTimeout(timer);
  }
}
