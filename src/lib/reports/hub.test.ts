import { describe, expect, it } from "vitest";
import {
  buildStatusStrip,
  describeWait,
  isDownloadable,
  monthLabelFrom,
  statusLabel,
  toReportRowView,
} from "@/lib/reports/hub";

const TZ = "Asia/Manila";

/** October 2026: the final Sunday is the 25th. 20:00 Manila = 12:00 UTC. */
const BEFORE = new Date("2026-10-20T12:00:00.000Z");
const IN_WINDOW = new Date("2026-10-25T12:00:00.000Z");

function strip(over: Partial<Parameters<typeof buildStatusStrip>[0]> = {}) {
  return buildStatusStrip({
    monthStart: "2026-10-01",
    now: BEFORE,
    timeZone: TZ,
    existingStatus: null,
    canBypass: false,
    ...over,
  });
}

describe("monthLabelFrom", () => {
  it("formats a month start readably", () => {
    expect(monthLabelFrom("2026-09-01")).toBe("September 2026");
    expect(monthLabelFrom("2026-01-01")).toBe("January 2026");
  });

  it("returns the input unchanged when it is not a month start", () => {
    expect(monthLabelFrom("nonsense")).toBe("nonsense");
  });
});

describe("buildStatusStrip", () => {
  it("reports ready inside the window", () => {
    const s = strip({ now: IN_WINDOW });
    expect(s.tone).toBe("ready");
    expect(s.label).toBe("Ready to generate");
    expect(s.canGenerate).toBe(true);
  });

  it("reports the opening moment outside the window", () => {
    const s = strip();
    expect(s.tone).toBe("blocked");
    expect(s.label).toBe("Outside schedule");
    expect(s.detail).toContain("Sun 25 Oct");
    expect(s.detail).toContain("8:00 PM");
    expect(s.canGenerate).toBe(false);
  });

  it("keeps a pending report ahead of the schedule in the copy", () => {
    // The distinction matters: "outside schedule" on a month already awaiting review reads
    // as though the user still has something to do about the window.
    const s = strip({ existingStatus: "pending", now: IN_WINDOW });
    expect(s.label).toBe("Pending approval");
    expect(s.canGenerate).toBe(false);
  });

  it("says pending approval even outside the window", () => {
    expect(strip({ existingStatus: "pending", now: BEFORE }).label).toBe("Pending approval");
  });

  it("reports an approved month as already existing", () => {
    const s = strip({ existingStatus: "approved" });
    expect(s.label).toBe("Already exists");
    expect(s.canGenerate).toBe(false);
  });

  it("lets an approved report win over a pending one being stale", () => {
    // Guard against the labels being swapped: the status that matters is the live one.
    expect(strip({ existingStatus: "approved", now: IN_WINDOW }).label).toBe("Already exists");
  });

  it("treats a rejected report as though the month is free", () => {
    const s = strip({ existingStatus: "rejected", now: IN_WINDOW });
    expect(s.tone).toBe("ready");
    expect(s.canGenerate).toBe(true);
  });

  it("offers bypass to an admin outside the window but not to a secretary", () => {
    expect(strip({ canBypass: true }).canBypass).toBe(true);
    expect(strip({ canBypass: false }).canBypass).toBe(false);
  });

  it("never offers generate when a report is already waiting", () => {
    // Even for an admin: overriding the schedule does not resolve a pending approval.
    expect(strip({ existingStatus: "pending", canBypass: true }).canGenerate).toBe(false);
  });

  it("reports a broken timezone distinctly from a closed window", () => {
    const s = strip({ timeZone: "Not/AZone" });
    expect(s.tone).toBe("blocked");
    expect(s.label).toBe("Schedule unavailable");
    expect(s.detail).toContain("timezone");
  });

  it("never promises an opening time for a report that already exists", () => {
    expect(strip({ existingStatus: "approved", now: BEFORE }).detail).not.toContain("8:00 PM");
  });
});

describe("toReportRowView", () => {
  const base = {
    id: "r1",
    report_month: "2026-09-01",
    title: "Attendance Report — September 2026",
    status: "approved",
    generated_by: "secretary",
    created_at: "2026-10-01T00:00:00.000Z",
  };

  it("maps the fields the hub shows", () => {
    const v = toReportRowView(base);
    expect(v.monthLabel).toBe("September 2026");
    expect(v.generatedBy).toBe("Secretary");
    expect(v.reviewNote).toBeNull();
  });

  it("names the generating role", () => {
    expect(toReportRowView({ ...base, generated_by: "admin" }).generatedBy).toBe("Admin");
  });

  it("carries the rejection reason through", () => {
    const v = toReportRowView({
      ...base,
      status: "rejected",
      review_note: "Missing sessions",
      reviewed_by: "super_admin",
      reviewed_at: "2026-10-02T00:00:00.000Z",
    });
    expect(v.reviewNote).toBe("Missing sessions");
    expect(v.reviewedBy).toBe("super_admin");
  });

  it("defaults to archived when the summary predates the flag", () => {
    expect(toReportRowView(base).dataArchived).toBe(true);
  });

  it("reads data_archived false as not archived", () => {
    expect(toReportRowView({ ...base, summary_json: { data_archived: false } }).dataArchived).toBe(false);
  });

  it("falls back to a readable title", () => {
    expect(toReportRowView({ ...base, title: null }).title).toBe("September 2026 report");
  });
});

describe("isDownloadable", () => {
  it("allows only approved reports", () => {
    // Mirrors the PDF route, which 403s every other status for non-super-admins. Offering
    // the button anywhere else produces a visible failure rather than a graceful one.
    expect(isDownloadable("approved")).toBe(true);
    expect(isDownloadable("pending")).toBe(false);
    expect(isDownloadable("rejected")).toBe(false);
  });
});

describe("statusLabel", () => {
  it("names each status", () => {
    expect(statusLabel("approved")).toBe("Approved");
    expect(statusLabel("pending")).toBe("Pending approval");
    expect(statusLabel("rejected")).toBe("Rejected");
  });

  it("passes an unknown status through rather than hiding it", () => {
    expect(statusLabel("archived")).toBe("archived");
  });
});

describe("describeWait", () => {
  const now = new Date("2026-10-05T12:00:00.000Z");

  it("describes hours, days and singulars", () => {
    expect(describeWait("2026-10-05T11:30:00.000Z", now)).toBe("under an hour");
    expect(describeWait("2026-10-05T11:00:00.000Z", now)).toBe("1 hour");
    expect(describeWait("2026-10-03T12:00:00.000Z", now)).toBe("2 days");
  });

  it("does not report zero days", () => {
    expect(describeWait("2026-10-05T11:59:00.000Z", now)).toBe("under an hour");
  });

  it("says unknown rather than NaN for a bad timestamp", () => {
    expect(describeWait("garbage", now)).toBe("unknown");
  });
});