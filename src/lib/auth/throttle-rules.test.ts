import { describe, expect, it } from "vitest";
import {
  evaluateGlobalThrottle,
  evaluateThrottle,
  GLOBAL_LOGIN_LIMIT,
  REGISTER_MIN_FILL_MS,
  THROTTLE_RULES,
} from "./throttle-rules";

const NOW = 1_800_000_000_000;
const login = THROTTLE_RULES.login;
const ms = (n: number) => n * 60_000;

describe("evaluateThrottle", () => {
  it("allows attempts below the limit", () => {
    const times = [1, 2, 3, 4].map((i) => NOW - ms(i));
    expect(evaluateThrottle(times, login, NOW)).toEqual({ blocked: false, globalDelayMs: 0 });
  });

  it("blocks on the fifth failure (5 allowed, sixth blocked)", () => {
    const times = [1, 2, 3, 4, 5].map((i) => NOW - ms(i));
    const decision = evaluateThrottle(times, login, NOW);
    expect(decision.blocked).toBe(true);
    if (decision.blocked) expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts exactly five as blocked, four as allowed", () => {
    expect(evaluateThrottle([1, 2, 3, 4].map((i) => NOW - ms(i)), login, NOW).blocked).toBe(false);
    expect(evaluateThrottle([1, 2, 3, 4, 5].map((i) => NOW - ms(i)), login, NOW).blocked).toBe(true);
  });

  it("ignores failures older than the window", () => {
    const old = [1, 2, 3, 4, 5, 6, 7].map((i) => NOW - ms(i) - ms(20));
    expect(evaluateThrottle(old, login, NOW).blocked).toBe(false);
  });

  it("rolls the window as old failures expire", () => {
    const stillInside = [1, 2, 3, 4, 5].map((i) => NOW - ms(i));
    expect(evaluateThrottle(stillInside, login, NOW).blocked).toBe(true);

    const justExpired = [1, 2, 3, 4, 5].map((i) => NOW - ms(i) - ms(16));
    expect(evaluateThrottle(justExpired, login, NOW).blocked).toBe(false);
  });

  it("keeps the wait time until the oldest failure leaves the window", () => {
    const times = [NOW - ms(15) + 1, NOW - ms(14), NOW - ms(13), NOW - ms(12), NOW - ms(11)];
    const decision = evaluateThrottle(times, login, NOW);
    expect(decision.blocked).toBe(true);
    if (decision.blocked) expect(decision.retryAfterSeconds).toBe(1);
  });

  it("handles unsorted input", () => {
    const times = [5, 1, 4, 2, 3].map((i) => NOW - ms(i));
    expect(evaluateThrottle(times, login, NOW).blocked).toBe(true);
  });

  it("ignores timestamps in the future and duplicates the window edge", () => {
    expect(evaluateThrottle([NOW + ms(60), NOW + ms(30)], login, NOW).blocked).toBe(false);
    const edge = NOW - login.windowMs;
    expect(evaluateThrottle([edge, edge, edge, edge, edge], login, NOW).blocked).toBe(false);
  });

  it("isolates clients: another IP's failures do not block this one", () => {
    const otherClient = [1, 2, 3, 4, 5, 6, 7].map((i) => NOW - ms(i));
    expect(evaluateThrottle([], login, NOW).blocked).toBe(false);
    expect(evaluateThrottle(otherClient, login, NOW).blocked).toBe(true);
  });

  it("uses 5 per hour for register and 10 per hour for appeals", () => {
    expect(THROTTLE_RULES.register.maxFailures).toBe(5);
    expect(THROTTLE_RULES.register.windowMs).toBe(60 * 60_000);
    expect(THROTTLE_RULES.appeal.maxFailures).toBe(10);
    expect(THROTTLE_RULES.appeal.windowMs).toBe(60 * 60_000);

    const five = [1, 2, 3, 4, 5].map((i) => NOW - ms(i));
    const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => NOW - ms(i));
    expect(evaluateThrottle(five, THROTTLE_RULES.register, NOW).blocked).toBe(true);
    expect(evaluateThrottle(nine, THROTTLE_RULES.appeal, NOW).blocked).toBe(false);
  });
});

describe("evaluateGlobalThrottle", () => {
  it("stays off below the global ceiling", () => {
    const times = Array.from({ length: 29 }, (_, i) => NOW - ms(i + 1));
    expect(evaluateGlobalThrottle(times, NOW)).toBe(0);
  });

  it("adds a two second delay once 30 hourly failures are seen", () => {
    const times = Array.from({ length: 30 }, (_, i) => NOW - ms(i + 1));
    expect(evaluateGlobalThrottle(times, NOW)).toBe(2000);
    expect(GLOBAL_LOGIN_LIMIT.delayMs).toBe(2000);
  });

  it("ignores failures outside the global hour", () => {
    const times = Array.from({ length: 40 }, (_, i) => NOW - ms(i + 1) - ms(90));
    expect(evaluateGlobalThrottle(times, NOW)).toBe(0);
  });
});

describe("register fill time", () => {
  it("requires three seconds between load and submit", () => {
    expect(REGISTER_MIN_FILL_MS).toBe(3000);
  });
});
