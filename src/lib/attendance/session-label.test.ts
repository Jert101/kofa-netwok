import { describe, expect, it } from "vitest";

import { sessionLabel } from "./guard-session-write";

describe("sessionLabel", () => {
  it("names a Mass by the Mass", () => {
    expect(sessionLabel({ mass_id: "m1", massName: "Sunday 8 AM" })).toBe("Sunday 8 AM");
  });

  it("falls back to Mass when the join is missing", () => {
    // A Mass whose row was deleted still has its id, so it is still a Mass -- just an unnamed one.
    expect(sessionLabel({ mass_id: "m1", massName: null })).toBe("Mass");
    expect(sessionLabel({ mass_id: "m1", massName: "  " })).toBe("Mass");
  });

  it("names a gathering by its title", () => {
    expect(sessionLabel({ mass_id: null, title: "Monthly Meeting" })).toBe("Monthly Meeting");
  });

  it("never answers with a blank or with undefined", () => {
    // The database constraint refuses an untitled gathering, so these are reachable only through a row
    // written before the constraint existed or straight into the table. Either way the screen gets a
    // word rather than an empty heading.
    expect(sessionLabel({ mass_id: null, title: null })).toBe("Meeting");
    expect(sessionLabel({ mass_id: null, title: "  " })).toBe("Meeting");
    expect(sessionLabel({})).toBe("Meeting");
  });

  it("prefers the Mass over the title when both are somehow present", () => {
    // The constraint forbids this combination, so it can only arrive from a row written before the
    // constraint existed. A Mass with a stray title is still a Mass.
    expect(sessionLabel({ mass_id: "m1", title: "Monthly Meeting", massName: "Sunday 8 AM" })).toBe(
      "Sunday 8 AM",
    );
  });
});
