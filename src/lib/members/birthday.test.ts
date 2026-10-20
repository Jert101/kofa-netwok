import { describe, expect, it } from "vitest";
import {
  MAX_ALTAR_SERVER_AGE,
  ageOn,
  isBirthdayEligible,
} from "@/lib/members/birthday";

describe("ageOn", () => {
  it("counts whole years", () => {
    expect(ageOn("2010-05-04", "2026-05-04")).toBe(16);
  });

  it("does not count a birthday that has not arrived yet this year", () => {
    expect(ageOn("2010-05-04", "2026-05-03")).toBe(15);
  });

  it("counts the day of the birthday itself", () => {
    expect(ageOn("2010-10-20", "2026-10-20")).toBe(16);
  });
});

describe("isBirthdayEligible", () => {
  it("accepts an active member with a date of birth and a batch", () => {
    expect(
      isBirthdayEligible({ date_of_birth: "2014-03-01", batch: "2026", is_active: true }),
    ).toBe(true);
  });

  it("rejects an inactive member even with everything else in place", () => {
    expect(
      isBirthdayEligible({ date_of_birth: "2014-03-01", batch: "2026", is_active: false }),
    ).toBe(false);
  });

  it("rejects a missing date of birth", () => {
    expect(isBirthdayEligible({ date_of_birth: null, batch: "2026", is_active: true })).toBe(false);
    expect(isBirthdayEligible({ batch: "2026", is_active: true })).toBe(false);
  });

  it("rejects a date that is not a plain ISO date", () => {
    expect(
      isBirthdayEligible({ date_of_birth: "03/01/2014", batch: "2026", is_active: true }),
    ).toBe(false);
  });

  it("keeps a member with a cleared batch unless they have aged out", () => {
    // Batch is the ordinary retirement signal, but the office keeps some
    // members on the roll without one; a plausible age is enough to greet them.
    expect(
      isBirthdayEligible({ date_of_birth: "2014-03-01", batch: null, is_active: true }),
    ).toBe(true);
    expect(isBirthdayEligible({ date_of_birth: "2014-03-01", batch: "", is_active: true })).toBe(
      true,
    );
  });

  it("drops an unbatched member who is older than the ministry", () => {
    const tooOld = `${new Date().getUTCFullYear() - (MAX_ALTAR_SERVER_AGE + 1)}-01-01`;
    expect(isBirthdayEligible({ date_of_birth: tooOld, batch: "", is_active: true })).toBe(false);
  });

  it("treats a whitespace batch as no batch", () => {
    const dob = `${new Date().getUTCFullYear() - 12}-01-01`;
    expect(isBirthdayEligible({ date_of_birth: dob, batch: "   ", is_active: true })).toBe(true);
  });
});
