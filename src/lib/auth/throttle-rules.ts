export type ThrottleKind = "login" | "register" | "appeal";

export type ThrottleRule = {
  /** Failures allowed inside the window before the next attempt is blocked. */
  maxFailures: number;
  /** Window length in milliseconds. */
  windowMs: number;
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** Per-IP limits from module 02 AUTH-2. */
export const THROTTLE_RULES: Record<ThrottleKind, ThrottleRule> = {
  login: { maxFailures: 5, windowMs: 15 * MINUTE },
  register: { maxFailures: 5, windowMs: HOUR },
  appeal: { maxFailures: 10, windowMs: HOUR },
};

/** Global login ceiling; crossing it adds a delay to every login attempt. */
export const GLOBAL_LOGIN_LIMIT = { maxFailures: 30, windowMs: HOUR, delayMs: 2_000 };

/** Register requires at least this long between page load and submit. */
export const REGISTER_MIN_FILL_MS = 3_000;

export type ThrottleDecision =
  | { blocked: false; globalDelayMs: number }
  | { blocked: true; retryAfterSeconds: number; globalDelayMs: number };

/**
 * Pure window math for the per-IP limit. `failureTimes` may be in any order and
 * may contain entries older than the window; only failures inside the window
 * count. Successes are not passed in because they never reset another client's
 * counter (module 02 AUTH-2).
 */
export function evaluateThrottle(
  failureTimes: readonly number[],
  rule: ThrottleRule,
  now: number,
): ThrottleDecision {
  const windowStart = now - rule.windowMs;
  const inWindow = failureTimes.filter((t) => t > windowStart && t <= now).sort((a, b) => a - b);

  if (inWindow.length < rule.maxFailures) {
    return { blocked: false, globalDelayMs: 0 };
  }

  // Blocked until the oldest in-window failure falls out of the window.
  const oldest = inWindow[0];
  const retryAfterMs = oldest + rule.windowMs - now;
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    globalDelayMs: 0,
  };
}

/** Global slowdown: applies once the whole-site hourly failure count is crossed. */
export function evaluateGlobalThrottle(
  failureTimes: readonly number[],
  now: number,
): number {
  const windowStart = now - GLOBAL_LOGIN_LIMIT.windowMs;
  const inWindow = failureTimes.filter((t) => t > windowStart && t <= now);
  return inWindow.length >= GLOBAL_LOGIN_LIMIT.maxFailures ? GLOBAL_LOGIN_LIMIT.delayMs : 0;
}
