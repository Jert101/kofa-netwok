import { describe, expect, it } from "vitest";
import {
  REJECT_PRESETS,
  REJECT_REASON_MAX,
  formatRejectReason,
} from "./reject-reasons";

describe("formatRejectReason", () => {
  it("keeps a preset reason on its own", () => {
    expect(formatRejectReason({ reason: "Not eligible" })).toBe("Not eligible");
  });

  it("appends a note after the preset", () => {
    expect(formatRejectReason({ reason: "Other", note: "Ask for a birth certificate" })).toBe(
      "Other: Ask for a birth certificate",
    );
  });

  it("ignores a note that is only whitespace", () => {
    expect(formatRejectReason({ reason: "Other", note: "   " })).toBe("Other");
  });

  it("returns null when no reason was chosen", () => {
    expect(formatRejectReason({ reason: "" })).toBeNull();
    expect(formatRejectReason({ reason: "   " })).toBeNull();
  });

  it("trims the reason so a stray space does not show up in the applicant's view", () => {
    expect(formatRejectReason({ reason: "  Duplicate application  " })).toBe(
      "Duplicate application",
    );
  });

  it("never exceeds the shown limit, even with a long note", () => {
    const text = formatRejectReason({ reason: "Other", note: "x".repeat(500) });
    expect(text).not.toBeNull();
    expect(text!.length).toBeLessThanOrEqual(REJECT_REASON_MAX);
  });

  it("keeps every preset reason short enough to fit on its own", () => {
    for (const preset of REJECT_PRESETS) {
      expect(formatRejectReason({ reason: preset })!.length).toBeLessThanOrEqual(REJECT_REASON_MAX);
    }
  });
});
