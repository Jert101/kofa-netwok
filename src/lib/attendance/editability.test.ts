import { describe, expect, it } from "vitest";
import { decideEditability, lockBannerText } from "./editability";

describe("lockBannerText", () => {
  it("names the month and the pending state", () => {
    expect(lockBannerText("August 2026", "pending")).toBe(
      "The August 2026 report is pending approval. Attendance is read-only.",
    );
  });

  it("names the month and the approved state", () => {
    expect(lockBannerText("August 2026", "approved")).toBe(
      "The August 2026 report is approved. Attendance is read-only.",
    );
  });
});

describe("decideEditability", () => {
  it("is editable when nothing blocks it", () => {
    expect(decideEditability({ locked: false, isFuture: false })).toEqual({
      editable: true,
      banner: null,
    });
  });

  it("shows the pending banner when the report is awaiting approval", () => {
    const result = decideEditability({
      locked: true,
      lockReason: "pending_approval",
      lockMonthLabel: "August 2026",
      isFuture: false,
    });

    expect(result.editable).toBe(false);
    expect(result.banner?.tone).toBe("locked");
    expect(result.banner?.title).toBe(
      "The August 2026 report is pending approval. Attendance is read-only.",
    );
  });

  it("shows the approved banner when the report is done", () => {
    const result = decideEditability({
      locked: true,
      lockReason: "approved",
      lockMonthLabel: "August 2026",
      isFuture: false,
    });

    expect(result.banner?.title).toBe(
      "The August 2026 report is approved. Attendance is read-only.",
    );
  });

  it("shows the future message for a Mass that has not happened", () => {
    const result = decideEditability({ locked: false, isFuture: true });

    expect(result.editable).toBe(false);
    expect(result.banner?.tone).toBe("future");
    expect(result.banner?.title).toBe("This Mass hasn't happened yet.");
  });

  it("prefers the lock over the future message", () => {
    // Both are true for a locked month with a session dated ahead of today. The lock
    // is the one that will not resolve on its own, so it is the one to say.
    const result = decideEditability({
      locked: true,
      lockReason: "approved",
      lockMonthLabel: "September 2026",
      isFuture: true,
    });

    expect(result.banner?.tone).toBe("locked");
  });

  it("assumes approval when a lock has no reason given", () => {
    // An older saved session might have locked: true with nothing else. Showing
    // "pending approval" when the report is actually approved would be a lie about
    // who needs to act next, so the more final of the two states is assumed.
    const result = decideEditability({ locked: true, isFuture: false });
    expect(result.banner?.title).toContain("approved");
  });

  it("still explains the lock when the month label is missing", () => {
    const result = decideEditability({ locked: true, isFuture: false });
    expect(result.banner?.title).toContain("this month");
  });

  it("pairs every not-editable state with a banner that explains itself", () => {
    // A greyed-out roster with no explanation is the worst outcome: it reads as a
    // broken app rather than a process.
    const cases = [
      { locked: false, isFuture: false },
      { locked: true, isFuture: false },
      { locked: false, isFuture: true },
      { locked: true, isFuture: true },
    ];

    for (const input of cases) {
      const result = decideEditability(input);
      if (result.editable) {
        expect(result.banner).toBeNull();
      } else {
        expect(result.banner?.title.length).toBeGreaterThan(0);
        expect(result.banner?.body.length).toBeGreaterThan(0);
      }
    }
  });
});
