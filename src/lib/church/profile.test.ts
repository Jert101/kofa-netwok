import { describe, expect, it } from "vitest";

import {
  SECTION_IDS,
  hasAbout,
  hasCouncil,
  hasLeadership,
  hasPatrons,
  hasRoles,
  hasTimeline,
  initialsOf,
  navSections,
  paragraphsOf,
} from "./profile";
import type { ChurchProfile } from "./profile";

function church(patch: Partial<ChurchProfile> = {}): ChurchProfile {
  return {
    parish_name: "St. Joseph",
    priest_name: null,
    headline: null,
    about: null,
    updated_at: null,
    council: [],
    ...patch,
  };
}

describe("initialsOf", () => {
  it("uses the first and last word", () => {
    expect(initialsOf("Maria Santos")).toBe("MS");
  });

  it("skips a leading title, so the letters are the person's", () => {
    // "FJ" for "Fr. John" is the reverend's initial followed by his first name's.
    expect(initialsOf("Fr. John Santos")).toBe("JS");
    expect(initialsOf("Rev. Maria Santos")).toBe("MS");
    expect(initialsOf("Sir Juan dela Cruz")).toBe("JC");
  });

  it("takes two letters when a title is all there is to a name", () => {
    // One name word left after the title, so both letters come from it.
    expect(initialsOf("Rev. Maria")).toBe("MA");
  });

  it("handles middle names by taking the first and last", () => {
    expect(initialsOf("Ana Maria Reyes")).toBe("AR");
  });

  it("takes two letters from a single word rather than one", () => {
    // One lone letter in a circle reads as a broken avatar.
    expect(initialsOf("Superadmin")).toBe("SU");
  });

  it("keeps the first and last word of a surname with a particle", () => {
    expect(initialsOf("Juan dela Cruz")).toBe("JC");
  });

  it("does not throw on nothing", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf("!!!")).toBe("?");
  });

  it("keeps Sister, which is part of the name", () => {
    // "Sr." is Sister and is not stripped, so "Sr. Rosa" gives SR -- Sister Rosa, which is how she is
    // written. Sir is a knight's title and *is* stripped. The two look identical in a list of
    // honorifics and mean opposite things here, which is exactly the trap.
    expect(initialsOf("Sr. Rosa")).toBe("SR");
    expect(initialsOf("Sir Juan Santos")).toBe("JS");
  });

  it("falls back to a placeholder when stripping the title leaves nothing", () => {
    // "FR" would print the reverend's title as the reverend's initials, which is a name and not initials.
    expect(initialsOf("Fr.")).toBe("?");
  });
});

describe("paragraphsOf", () => {
  it("splits on blank lines", () => {
    expect(paragraphsOf("One.\n\nTwo.")).toEqual(["One.", "Two."]);
  });

  it("collapses a hard-wrapped paragraph, which is what a textarea produces", () => {
    expect(paragraphsOf("A sentence\nthat was typed\nacross three lines.")).toEqual([
      "A sentence that was typed across three lines.",
    ]);
  });

  it("keeps paragraphs apart while joining their internal wrapping", () => {
    expect(paragraphsOf("First line\nstill first.\n\nSecond para.")).toEqual([
      "First line still first.",
      "Second para.",
    ]);
  });

  it("drops empty ones, so no blank paragraph is rendered", () => {
    expect(paragraphsOf("One.\n\n\n\nTwo.\n\n")).toEqual(["One.", "Two."]);
  });

  it("returns nothing for absent or blank text", () => {
    expect(paragraphsOf(null)).toEqual([]);
    expect(paragraphsOf(undefined)).toEqual([]);
    expect(paragraphsOf("   \n\n  ")).toEqual([]);
  });
});

describe("the section predicates", () => {
  it("needs an actual priest name", () => {
    expect(hasLeadership(church({ priest_name: "Fr. John Santos" }))).toBe(true);
    expect(hasLeadership(church({ priest_name: "   " }))).toBe(false);
    expect(hasLeadership(church())).toBe(false);
    expect(hasLeadership(null)).toBe(false);
  });

  it("needs a paragraph of background, not just whitespace", () => {
    expect(hasAbout(church({ about: "Founded in 1952." }))).toBe(true);
    expect(hasAbout(church({ about: "  \n\n " }))).toBe(false);
    expect(hasAbout(church())).toBe(false);
    expect(hasAbout(null)).toBe(false);
  });

  it("counts a council with names but no offices", () => {
    // An office column is a nicety. A name on a council page is the point.
    expect(hasCouncil(church({ council: [{ id: "1", name: "Ana", office: null, bio: null, sort_order: 0 }] }))).toBe(true);
  });

  it("treats an empty council as no council", () => {
    // A heading over nothing reads as a mistake, not as an absence.
    expect(hasCouncil(church())).toBe(false);
    expect(hasCouncil(church({ council: [] }))).toBe(false);
    expect(hasCouncil(null)).toBe(false);
  });

  it("treats an absent list the same as an empty one", () => {
    // The reader degrades an unreadable list to `[]`, and a database where migration 040 has not been
    // applied leaves the keys out entirely. Both have to read as "no section" rather than crashing, and
    // neither may produce a heading over nothing.
    expect(hasRoles(church())).toBe(false);
    expect(hasTimeline(church())).toBe(false);
    expect(hasPatrons(church()));
    expect(hasRoles(null)).toBe(false);
    expect(hasTimeline(null)).toBe(false);
    expect(hasPatrons(null)).toBe(false);
    expect(hasRoles(church({ roles: [] }))).toBe(false);
  });

  it("counts a role, a milestone and a patron as sections of their own", () => {
    expect(
      hasRoles(church({ roles: [{ id: "1", name: "Crucifer", description: null, icon: "cross", sort_order: 0 }] })),
    ).toBe(true);
    expect(hasTimeline(church({ milestones: [{ id: "1", year_label: "c. 251", body: "x", sort_order: 0 }] }))).toBe(true);
    expect(hasPatrons(church({ patrons: [{ id: "1", name: "St. Tarcisius", note: null, sort_order: 0 }] }))).toBe(true);
  });
});

describe("navSections", () => {
  it("offers no links at all on a profile with nothing in it", () => {
    expect(navSections(null)).toEqual([]);
    expect(navSections(church())).toEqual([]);
  });

  it("only links to sections that are actually on the page", () => {
    // A link to a section that is not rendered scrolls to the top of the footer and looks broken.
    const labels = navSections(
      church({
        priest_name: "Rev. Fr. A",
        roles: [{ id: "1", name: "Crucifer", description: null, icon: "cross", sort_order: 0 }],
        milestones: [{ id: "1", year_label: "1570", body: "x", sort_order: 0 }],
      }),
    ).map((s) => s.label);
    expect(labels).toEqual(["About", "Roles", "History"]);
  });

  it("leaves out a section whose list is empty but keeps the rest", () => {
    const sections = navSections(
      church({ council: [{ id: "1", name: "Ana", office: null, bio: null, sort_order: 0 }] }),
    );
    expect(sections.map((s) => s.label)).toEqual(["Council"]);
  });

  it("gives every link an href matching the id its section declares", () => {
    // Written out here rather than imported, so renaming SECTION_IDS without updating a section's
    // `id` attribute is caught rather than producing a link that scrolls nowhere.
    const hrefs = navSections(church({ about: "A paragraph.", council: [{ id: "1", name: "A", office: null, bio: null, sort_order: 0 }] })).map(
      (s) => s.href,
    );
    expect(hrefs).toEqual(["#about", "#council"]);
    expect(SECTION_IDS.about).toBe("about");
    expect(SECTION_IDS.council).toBe("council");
  });

  it("does not link to the patrons, which is a short section between two longer ones", () => {
    const labels = navSections(
      church({ patrons: [{ id: "1", name: "St. Tarcisius", note: null, sort_order: 0 }] }),
    ).map((s) => s.label);
    expect(labels).toEqual([]);
  });
});