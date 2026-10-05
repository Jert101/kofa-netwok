import { describe, expect, it } from "vitest";

import { isRealIsoDate, isUuid } from "./route-params";

describe("isRealIsoDate", () => {
  it("accepts a real calendar date", () => {
    expect(isRealIsoDate("2026-01-04")).toBe(true);
    expect(isRealIsoDate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects a well-shaped date that does not exist", () => {
    // The old guard was a regex, so this passed and became a request for a day with no sessions.
    expect(isRealIsoDate("2026-02-31")).toBe(false);
    expect(isRealIsoDate("2025-02-29")).toBe(false); // not a leap year
    expect(isRealIsoDate("2026-13-01")).toBe(false);
    expect(isRealIsoDate("2026-00-10")).toBe(false);
  });

  it("rejects anything that is not an ISO date at all", () => {
    expect(isRealIsoDate("")).toBe(false);
    expect(isRealIsoDate("today")).toBe(false);
    expect(isRealIsoDate("2026-1-4")).toBe(false);
    expect(isRealIsoDate("01/04/2026")).toBe(false);
    expect(isRealIsoDate("/admin")).toBe(false);
    expect(isRealIsoDate("2026-01-04T00:00:00Z")).toBe(false);
  });
});

describe("isUuid", () => {
  it("accepts a uuid", () => {
    expect(isUuid("3f1b7c2e-9a44-4d1e-8b0a-6c2f5e9d1a37")).toBe(true);
    expect(isUuid("3F1B7C2E-9A44-4D1E-8B0A-6C2F5E9D1A37")).toBe(true);
  });

  it("rejects anything else", () => {
    // This segment goes straight into a fetch URL, so a wrong value is a request to a bad endpoint.
    expect(isUuid("")).toBe(false);
    expect(isUuid("abc")).toBe(false);
    expect(isUuid("../../admin")).toBe(false);
    expect(isUuid("3f1b7c2e9a444d1e8b0a6c2f5e9d1a37")).toBe(false);
    expect(isUuid("3f1b7c2e-9a44-4d1e-8b0a-6c2f5e9d1a37 ")).toBe(false);
  });
});