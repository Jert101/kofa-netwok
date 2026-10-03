import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEAL_RETENTION_MONTHS,
  DEFAULT_AUDIT_RETENTION_MONTHS,
  LOGIN_ATTEMPTS_RETENTION_DAYS,
  MAX_AUDIT_RETENTION_MONTHS,
  MIN_AUDIT_RETENTION_MONTHS,
  parseAppealRetentionMonths,
  parseAuditRetentionMonths,
  retentionCutoff,
} from "./retention";

describe("LOGIN_ATTEMPTS_RETENTION_DAYS", () => {
  it("keeps brute-force rows for a week", () => {
    expect(LOGIN_ATTEMPTS_RETENTION_DAYS).toBe(7);
  });
});

describe("parseAuditRetentionMonths", () => {
  it("defaults to twelve months when unset", () => {
    expect(parseAuditRetentionMonths(null)).toBe(DEFAULT_AUDIT_RETENTION_MONTHS);
    expect(parseAuditRetentionMonths(undefined)).toBe(12);
    expect(parseAuditRetentionMonths("")).toBe(12);
    expect(parseAuditRetentionMonths("   ")).toBe(12);
  });

  it("reads a valid stored value", () => {
    expect(parseAuditRetentionMonths("6")).toBe(6);
    expect(parseAuditRetentionMonths("24")).toBe(24);
    expect(parseAuditRetentionMonths(" 3 ")).toBe(3);
  });

  it("falls back rather than deleting everything for a bad value", () => {
    // 0 or a negative value would mean "wipe the log", which must never follow a typo.
    expect(parseAuditRetentionMonths("0")).toBe(12);
    expect(parseAuditRetentionMonths("-5")).toBe(12);
    expect(parseAuditRetentionMonths("abc")).toBe(12);
    expect(parseAuditRetentionMonths("100000")).toBe(12);
  });

  it("keeps the accepted range sane", () => {
    expect(MIN_AUDIT_RETENTION_MONTHS).toBeGreaterThanOrEqual(1);
    expect(MAX_AUDIT_RETENTION_MONTHS).toBeLessThanOrEqual(120);
  });
});

describe("parseAppealRetentionMonths", () => {
  it("keeps a year of appeal history by default (APL-3)", () => {
    expect(parseAppealRetentionMonths(null)).toBe(DEFAULT_APPEAL_RETENTION_MONTHS);
    expect(DEFAULT_APPEAL_RETENTION_MONTHS).toBe(12);
  });

  it("reads a valid stored value", () => {
    expect(parseAppealRetentionMonths("24")).toBe(24);
    expect(parseAppealRetentionMonths(" 6 ")).toBe(6);
  });

  it("falls back rather than pruning history for a bad value", () => {
    // Same reasoning as the audit log: the sweep deleting attendance history on the
    // strength of a typo is the worse failure.
    expect(parseAppealRetentionMonths("0")).toBe(12);
    expect(parseAppealRetentionMonths("-1")).toBe(12);
    expect(parseAppealRetentionMonths("forever")).toBe(12);
  });

  it("is independent of the audit setting", () => {
    // They share a parser, not a value. A parish keeping five years of audit history
    // should not silently keep five years of appeal items too.
    expect(parseAppealRetentionMonths("60")).toBe(60);
    expect(parseAuditRetentionMonths("60")).toBe(60);
    expect(parseAppealRetentionMonths("3")).not.toBe(parseAuditRetentionMonths("5"));
  });
});

describe("retentionCutoff", () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0, 0);

  it("walks calendar months, not 30-day blocks", () => {
    const cutoff = retentionCutoff(at(2026, 9, 30), 12);
    expect(cutoff.getFullYear()).toBe(2025);
    expect(cutoff.getMonth()).toBe(8);
    expect(cutoff.getDate()).toBe(30);
  });

  it("keeps the day-of-month when it exists in the target month", () => {
    const cutoff = retentionCutoff(at(2026, 3, 15), 1);
    expect(cutoff.getMonth()).toBe(1);
    expect(cutoff.getDate()).toBe(15);
  });

  it("clamps to the last day when the target month is shorter", () => {
    // Mar 31 back one month must be Feb 28, not an overflow into March.
    const cutoff = retentionCutoff(at(2026, 3, 31), 1);
    expect(cutoff.getMonth()).toBe(1);
    expect(cutoff.getDate()).toBe(28);
  });

  it("clamps onto a leap day", () => {
    const cutoff = retentionCutoff(at(2028, 3, 31), 1);
    expect(cutoff.getFullYear()).toBe(2028);
    expect(cutoff.getMonth()).toBe(1);
    expect(cutoff.getDate()).toBe(29);
  });

  it("does not mutate the caller's date", () => {
    const now = at(2026, 9, 30);
    retentionCutoff(now, 6);
    expect(now.getFullYear()).toBe(2026);
    expect(now.getMonth()).toBe(8);
    expect(now.getDate()).toBe(30);
  });
});
