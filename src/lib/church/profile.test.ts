import { describe, expect, it } from "vitest";

import { hasAbout, hasCouncil, hasLeadership, initialsOf, paragraphsOf } from "./profile";
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
});