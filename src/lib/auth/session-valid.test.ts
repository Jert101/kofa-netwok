import { describe, expect, it } from "vitest";
import {
  ACTOR_REQUIRED_BY_DEFAULT,
  CLOCK_SKEW_TOLERANCE_MS,
  isActorRequired,
  isSessionValid,
  SESSIONS_VALID_AFTER_KEY,
} from "./session-valid";
import type { Role } from "./roles";

const NOW = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW / 1000);
const iso = (ms: number) => new Date(ms).toISOString();

describe("isSessionValid", () => {
  it("accepts any session when nothing has been revoked", () => {
    expect(isSessionValid(NOW_SECONDS, null, NOW)).toBe(true);
    expect(isSessionValid(NOW_SECONDS, undefined, NOW)).toBe(true);
    expect(isSessionValid(NOW_SECONDS, "", NOW)).toBe(true);
  });

  it("ignores an unparseable stored timestamp rather than locking everyone out", () => {
    expect(isSessionValid(NOW_SECONDS, "not-a-date", NOW)).toBe(true);
  });

  it("accepts a session issued after the cutoff", () => {
    expect(isSessionValid(NOW_SECONDS, iso(NOW - 60_000), NOW)).toBe(true);
  });

  it("rejects a session issued before the cutoff", () => {
    expect(isSessionValid(NOW_SECONDS - 600, iso(NOW), NOW)).toBe(false);
  });

  it("keeps a session issued in the same second as the cutoff", () => {
    // This is deliberate: an admin who changes their own PIN is reissued a
    // cookie in the same second the cutoff is written, and must stay signed in.
    expect(isSessionValid(NOW_SECONDS, iso(NOW), NOW)).toBe(true);
  });

  it("refuses a token dated well into the future", () => {
    expect(isSessionValid(NOW_SECONDS + 600, iso(NOW - 60_000), NOW)).toBe(false);
  });

  it("allows five seconds of clock skew", () => {
    expect(CLOCK_SKEW_TOLERANCE_MS).toBe(5_000);
    // Issued 3 seconds "before" the cutoff, which is really just skew.
    expect(isSessionValid(Math.floor((NOW - 3_000) / 1000), iso(NOW), NOW)).toBe(true);
    // Issued 30 seconds before, which is a genuinely older session.
    expect(isSessionValid(Math.floor((NOW - 30_000) / 1000), iso(NOW), NOW)).toBe(false);
  });

  it("rejects a session with no issued-at time when a cutoff exists", () => {
    expect(isSessionValid(undefined, iso(NOW), NOW)).toBe(false);
    expect(isSessionValid(Number.NaN, iso(NOW), NOW)).toBe(false);
  });
});

describe("session validity keys", () => {
  it("has a key for every role", () => {
    const roles: Role[] = ["admin", "secretary", "member", "officer", "treasurer", "super_admin"];
    for (const role of roles) {
      expect(SESSIONS_VALID_AFTER_KEY[role]).toBe(`sessions_valid_after_${role}`);
    }
  });
});

describe("isActorRequired", () => {
  it("defaults staff roles to required and members to optional", () => {
    expect(isActorRequired("admin", {})).toBe(true);
    expect(isActorRequired("secretary", {})).toBe(true);
    expect(isActorRequired("officer", {})).toBe(true);
    expect(isActorRequired("treasurer", {})).toBe(true);
    expect(isActorRequired("super_admin", {})).toBe(true);
    expect(isActorRequired("member", {})).toBe(false);
    expect(ACTOR_REQUIRED_BY_DEFAULT.member).toBe(false);
  });

  it("lets an explicit setting override the default", () => {
    expect(isActorRequired("member", { require_actor_name_member: "true" })).toBe(true);
    expect(isActorRequired("admin", { require_actor_name_admin: "false" })).toBe(false);
  });
});
