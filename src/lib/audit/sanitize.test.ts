import { describe, expect, it } from "vitest";
import { sanitizeMeta } from "./sanitize";

describe("sanitizeMeta", () => {
  it("keeps ordinary metadata", () => {
    expect(sanitizeMeta({ count: 3, name: "Server", ok: true })).toEqual({
      count: 3,
      name: "Server",
      ok: true,
    });
  });

  it("strips keys named pin, hash and password", () => {
    const out = sanitizeMeta({
      role: "admin",
      pin: "1234",
      hash: "$2a$10$abc",
      password: "hunter2",
    });
    expect(out).toEqual({ role: "admin" });
  });

  it("strips secret-looking keys regardless of case or suffix", () => {
    const out = sanitizeMeta({
      newPin: "9999",
      PIN_HASH: "$2a$10$abc",
      apiToken: "x",
      userPassword: "p",
      clientSecret: "s",
      credentials: "c",
    });
    expect(out).toEqual({});
  });

  it("strips nested objects and arrays", () => {
    const out = sanitizeMeta({
      before: { name: "A", pin: "1234" },
      after: [{ name: "B", pin_hash: "x" }],
    });
    expect(out).toEqual({ before: { name: "A" }, after: [{ name: "B" }] });
  });

  it("converts dates and drops functions, undefined and non-finite numbers", () => {
    const out = sanitizeMeta({
      at: new Date("2026-01-02T03:04:05.000Z"),
      fn: () => 1,
      missing: undefined,
      bad: Number.NaN,
      inf: Number.POSITIVE_INFINITY,
    });
    expect(out).toEqual({ at: "2026-01-02T03:04:05.000Z" });
  });

  it("keeps null but drops nothing else falsy-looking", () => {
    expect(sanitizeMeta({ note: null, empty: "", zero: 0, no: false })).toEqual({
      note: null,
      empty: "",
      zero: 0,
      no: false,
    });
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeMeta(undefined)).toEqual({});
    expect(sanitizeMeta("nope")).toEqual({});
    expect(sanitizeMeta(42)).toEqual({});
    expect(sanitizeMeta([1, 2, 3])).toEqual({});
  });

  it("caps nesting depth so deep objects cannot blow up the row", () => {
    let deep: Record<string, unknown> = { value: 1 };
    for (let i = 0; i < 12; i++) deep = { nested: deep };
    const out = sanitizeMeta(deep);
    expect(JSON.stringify(out).length).toBeLessThan(500);
  });

  it("caps array length", () => {
    const out = sanitizeMeta({ ids: Array.from({ length: 500 }, (_, i) => i) });
    expect(Array.isArray((out as { ids: unknown[] }).ids)).toBe(true);
    expect((out as { ids: unknown[] }).ids.length).toBeLessThanOrEqual(200);
  });
});
