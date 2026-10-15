// Fixed-window rate limiting.
//
// The counter is pure (unit-tested in tests/rateLimit.test.ts); the middleware keeps the state in a Map.
//
// LIMITATION: the counters live in this process's memory. That is correct for the current
// single-Node-process Plesk deployment. If the app is ever scaled to more than one process, move the
// counters to a shared store (Redis/MySQL) — otherwise the effective limit becomes max x processes.

import type { RequestHandler, Request } from "express";

export interface Window {
  count: number;
  resetAt: number;
}

export interface Decision {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

function currentWindow(state: Map<string, Window>, key: string, windowMs: number, now: number): Window {
  const existing = state.get(key);
  return !existing || existing.resetAt <= now ? { count: 0, resetAt: now + windowMs } : existing;
}

/** Reports the budget for `key` WITHOUT consuming any of it. */
export function peek(
  state: Map<string, Window>,
  key: string,
  max: number,
  windowMs: number,
  now: number
): Decision {
  const window = currentWindow(state, key, windowMs, now);
  return {
    allowed: window.count < max,
    remaining: Math.max(0, max - window.count),
    resetAt: window.resetAt,
  };
}

/** Consumes one unit of `key`'s budget and reports the resulting state. */
export function hit(
  state: Map<string, Window>,
  key: string,
  max: number,
  windowMs: number,
  now: number
): Decision {
  const window = currentWindow(state, key, windowMs, now);
  window.count += 1;
  state.set(key, window);
  return {
    allowed: window.count <= max,
    remaining: Math.max(0, max - window.count),
    resetAt: window.resetAt,
  };
}

export function prune(state: Map<string, Window>, now: number): void {
  for (const [key, window] of state) {
    if (window.resetAt <= now) state.delete(key);
  }
}

export interface RateLimitOptions {
  /** Names the bucket in the RateLimit-Policy header. */
  name: string;
  max: number;
  windowMs: number;
  /** Cap on tracked keys, so spoofed source addresses cannot grow memory without bound. */
  maxKeys?: number;
  /**
   * Count only failed (>= 400) responses. Used on login so that normal successful use never eats
   * into the brute-force budget.
   */
  countOnlyFailures?: boolean;
}

const MAX_KEYS_DEFAULT = 10_000;

export function rateLimit({
  name,
  max,
  windowMs,
  maxKeys = MAX_KEYS_DEFAULT,
  countOnlyFailures = false,
}: RateLimitOptions): RequestHandler {
  const state = new Map<string, Window>();

  return (req: Request, res, next) => {
    const now = Date.now();
    prune(state, now);
    // Bound memory: evict the oldest tracked key rather than refusing to track new ones.
    while (state.size >= maxKeys) {
      const oldest = state.keys().next();
      if (oldest.done) break;
      state.delete(oldest.value);
    }

    const key = req.ip ?? "unknown";
    const decision = peek(state, key, max, windowMs, now);
    const resetSeconds = Math.max(1, Math.ceil((decision.resetAt - now) / 1000));

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(decision.remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));
    res.setHeader("RateLimit-Policy", `${name};w=${Math.ceil(windowMs / 1000)}`);

    if (!decision.allowed) {
      res.setHeader("Retry-After", String(resetSeconds));
      res.status(429).json({ error: "too many requests, please slow down" });
      return;
    }

    if (countOnlyFailures) {
      res.on("finish", () => {
        if (res.statusCode >= 400) hit(state, key, max, windowMs, Date.now());
      });
    } else {
      hit(state, key, max, windowMs, now);
    }
    next();
  };
}
