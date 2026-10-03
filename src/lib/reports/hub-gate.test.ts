import { describe, expect, it } from "vitest";
import { buildStatusStrip } from "./hub";

/**
 * The strip's inputs come from the server, and this is the contract between the two.
 *
 * `time_zone` and `report_status` were added to `/api/reports/can-generate` so the component
 * could call the tested function instead of re-deriving four states inline. These tests pin the
 * shape that decision depends on: a missing `report_status` must not be mistaken for an
 * approved report, because "Already exists" for a month with no report is a dead end for the
 * user and a green light for nobody.
 */

const TZ = "Asia/Manila";
const SEPTEMBER = "2026-09-01";

describe("status strip from server gate fields", () => {
  it("shows ready inside the window with no report", () => {
    // 27 Sep 2026 is the last Sunday; 21:00 in Manila is after the 20:00 opening.
    const strip = buildStatusStrip({
      monthStart: SEPTEMBER,
      now: new Date("2026-09-27T13:00:00Z"), // 21:00 +08
      timeZone: TZ,
      existingStatus: null,
      canBypass: false,
    });
    expect(strip.tone).toBe("ready");
    expect(strip.canGenerate).toBe(true);
  });

  it("blocks before the window opens", () => {
    const strip = buildStatusStrip({
      monthStart: SEPTEMBER,
      now: new Date("2026-09-27T10:00:00Z"), // 18:00 +08, two hours early
      timeZone: TZ,
      existingStatus: null,
      canBypass: false,
    });
    expect(strip.tone).toBe("blocked");
    expect(strip.canGenerate).toBe(false);
  });

  it("names the opening moment when blocked", () => {
    const strip = buildStatusStrip({
      monthStart: SEPTEMBER,
      now: new Date("2026-09-27T10:00:00Z"),
      timeZone: TZ,
      existingStatus: null,
      canBypass: false,
    });
    expect(strip.detail).toMatch(/8:00/);
  });

  it("shows pending when the active report is awaiting review", () => {
    const strip = buildStatusStrip({
      monthStart: SEPTEMBER,
      now: new Date("2026-09-27T13:00:00Z"),
      timeZone: TZ,
      existingStatus: "pending",
      canBypass: false,
    });
    expect(strip.label).toBe("Pending approval");
    expect(strip.tone).toBe("waiting");
    expect(strip.canGenerate).toBe(false);
  });

  it("shows already exists for an approved month", () => {
    const strip = buildStatusStrip({
      monthStart: SEPTEMBER,
      now: new Date("2026-09-27T13:00:00Z"),
      timeZone: TZ,
      existingStatus: "approved",
      canBypass: false,
    });
    expect(strip.label).toBe("Already exists");
    expect(strip.canGenerate).toBe(false);
  });

  it("lets a rejected month be generated again", () => {
    // A rejected row does not hold the month. Treating it as blocking would leave the month
    // permanently stuck with no path forward.
    const strip = buildStatusStrip({
      monthStart: SEPTEMBER,
      now: new Date("2026-09-27T13:00:00Z"),
      timeZone: TZ,
      existingStatus: "rejected",
      canBypass: false,
    });
    expect(strip.canGenerate).toBe(true);
  });

  it("lets an existing report outrank the schedule", () => {
    // Inside the window this passes anyway; the meaningful case is a pending report outside it.
    const strip = buildStatusStrip({
      monthStart: SEPTEMBER,
      now: new Date("2026-09-10T10:00:00Z"),
      timeZone: TZ,
      existingStatus: "pending",
      canBypass: false,
    });
    expect(strip.label).toBe("Pending approval");
  });

  it("reports a timezone failure instead of pretending the window is closed", () => {
    // A misconfigured setting must be distinguishable from "not yet Sunday", or an admin
    // hunts for a schedule that does not exist.
    const strip = buildStatusStrip({
      monthStart: SEPTEMBER,
      now: new Date("2026-09-27T13:00:00Z"),
      timeZone: "Not/AZone",
      existingStatus: null,
      canBypass: false,
    });
    expect(strip.label).toBe("Schedule unavailable");
    expect(strip.canGenerate).toBe(false);
  });

  it("offers bypass to an admin but not a secretary, when blocked", () => {
    const now = new Date("2026-09-10T10:00:00Z");
    const base = { monthStart: SEPTEMBER, now, timeZone: TZ, existingStatus: null } as const;
    expect(buildStatusStrip({ ...base, canBypass: true }).canBypass).toBe(true);
    expect(buildStatusStrip({ ...base, canBypass: false }).canBypass).toBe(false);
  });

  it("uses the church timezone, not the runner's", () => {
    // Same instant, two zones, opposite verdicts. The opening is 20:00 *in that zone*, so the
    // two cannot agree here; if they did, the zone would be ignored, which is exactly the bug
    // that sending `time_zone` from the server prevents.
    //
    // 2026-09-27T16:00Z is 00:00 on 28 Sep in Manila: past that zone's 27th 20:00 opening, so
    // ready. It is 16:00 on 27 Sep in UTC, before that zone's 20:00 opening, so blocked.
    const now = new Date("2026-09-27T16:00:00Z");
    const manila = buildStatusStrip({
      monthStart: SEPTEMBER,
      now,
      timeZone: TZ,
      existingStatus: null,
      canBypass: false,
    });
    const utc = buildStatusStrip({
      monthStart: SEPTEMBER,
      now,
      timeZone: "UTC",
      existingStatus: null,
      canBypass: false,
    });
    expect(manila.tone).toBe("ready");
    expect(utc.tone).toBe("blocked");
  });
});