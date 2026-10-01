import { describe, expect, it } from "vitest";
import {
  collapseWhitespace,
  composeFullName,
  findDuplicateName,
  normalizeMiddleInitial,
  normalizeName,
  splitName,
} from "./normalize-name";

describe("collapseWhitespace", () => {
  it("trims and collapses runs of spaces", () => {
    expect(collapseWhitespace("  Jose   de   la  cruz ")).toBe("Jose de la cruz");
  });

  it("leaves tabs and newlines as single spaces", () => {
    expect(collapseWhitespace("Jose\tde\nla")).toBe("Jose de la");
  });

  it("returns an empty string for whitespace only", () => {
    expect(collapseWhitespace("   ")).toBe("");
  });
});

describe("normalizeName", () => {
  it("folds case and whitespace so spacing and typing differences still match", () => {
    const target = normalizeName("Jose De La Cruz");
    expect(normalizeName("  jose   de  la  cruz ")).toBe(target);
    expect(normalizeName("JOSE DE LA CRUZ")).toBe(target);
    expect(normalizeName("Jose  De La  Cruz")).toBe(target);
  });

  it("keeps accents so a different name never collides", () => {
    expect(normalizeName("Niño")).not.toBe(normalizeName("Nino"));
  });

  it("keeps punctuation so Ma. Cristina does not become Cristina", () => {
    expect(normalizeName("Ma. Cristina")).not.toBe(normalizeName("Cristina"));
  });

  it("folds the period on a middle initial so it is not a hidden duplicate", () => {
    // Both forms mean the same person; missing this would let them in twice.
    expect(normalizeName("Jerson L Catadman")).toBe(normalizeName("Jerson L. Catadman"));
  });

  it("does not strip an abbreviation of two or more letters", () => {
    expect(normalizeName("St. John Santos")).not.toBe(normalizeName("St John Santos"));
  });

  it("distinguishes names that differ only in spacing inside a part", () => {
    // De La Cruz and Dela Cruz are different people.
    expect(normalizeName("De La Cruz")).not.toBe(normalizeName("Dela Cruz"));
  });

  it("is empty for an empty name", () => {
    expect(normalizeName("   ")).toBe("");
  });
});

describe("normalizeMiddleInitial", () => {
  it("uppercases and drops the period", () => {
    expect(normalizeMiddleInitial("l")).toBe("L");
    expect(normalizeMiddleInitial("L.")).toBe("L");
  });

  it("keeps only the first letter", () => {
    expect(normalizeMiddleInitial("luis")).toBe("L");
  });

  it("treats missing and empty as absent", () => {
    expect(normalizeMiddleInitial(null)).toBe("");
    expect(normalizeMiddleInitial(undefined)).toBe("");
    expect(normalizeMiddleInitial("")).toBe("");
    expect(normalizeMiddleInitial("  ")).toBe("");
  });
});

describe("composeFullName", () => {
  it("composes first, initial and last", () => {
    expect(composeFullName({ firstName: "jerson", middleInitial: "l", lastName: "catadman" })).toBe(
      "Jerson L. Catadman",
    );
  });

  it("omits the middle part when there is no initial", () => {
    expect(composeFullName({ firstName: "maria", lastName: "santos" })).toBe("Maria Santos");
  });

  it("always adds the period after an initial", () => {
    expect(composeFullName({ firstName: "maria", middleInitial: "d", lastName: "santos" })).toBe(
      "Maria D. Santos",
    );
  });

  it("keeps compound given names and compound surnames intact", () => {
    expect(
      composeFullName({ firstName: "jose maria", middleInitial: "d", lastName: "de la cruz" }),
    ).toBe("Jose Maria D. De La Cruz");
  });

  it("returns what it has when a part is missing", () => {
    expect(composeFullName({ firstName: "", lastName: "Santos" })).toBe("Santos");
    expect(composeFullName({ firstName: "Maria", lastName: "" })).toBe("Maria");
  });
});

describe("splitName", () => {
  it("splits a simple name into first and last", () => {
    expect(splitName("Maria Santos")).toEqual({
      firstName: "Maria",
      middleInitial: "",
      lastName: "Santos",
    });
  });

  it("recognises a middle initial", () => {
    expect(splitName("Jerson L. Catadman")).toEqual({
      firstName: "Jerson",
      middleInitial: "L",
      lastName: "Catadman",
    });
  });

  it("does not read a single letter without a period as an initial", () => {
    // A person can legitimately be named "Jerson L"; the period is what marks an
    // initial, because the directory always stores one.
    expect(splitName("Jerson L Catadman")).toEqual({
      firstName: "Jerson L",
      middleInitial: "",
      lastName: "Catadman",
    });
  });

  it("splits a particle surname at the last token", () => {
    // Documented limitation: "De La" is not knowably a surname from the string alone.
    // Re-composing gives the same name back, so nothing is rewritten.
    expect(splitName("Jose De La Cruz")).toEqual({
      firstName: "Jose De La",
      middleInitial: "",
      lastName: "Cruz",
    });
  });

  it("keeps a multi-word given name together", () => {
    expect(splitName("Jose Maria Santos")).toEqual({
      firstName: "Jose Maria",
      middleInitial: "",
      lastName: "Santos",
    });
  });

  it("does not treat a single-letter last name as an initial", () => {
    expect(splitName("Maria C")).toEqual({
      firstName: "Maria",
      middleInitial: "",
      lastName: "C",
    });
  });

  it("does not treat a leading initial as a first name", () => {
    expect(splitName("L. Catadman")).toEqual({
      firstName: "L.",
      middleInitial: "",
      lastName: "Catadman",
    });
  });

  it("degrades gracefully for one word or nothing", () => {
    expect(splitName("Cher")).toEqual({ firstName: "Cher", middleInitial: "", lastName: "" });
    expect(splitName("   ")).toEqual({ firstName: "", middleInitial: "", lastName: "" });
  });
});

describe("splitName and composeFullName round trip", () => {
  it("rebuilds the same stored name for a normal entry", () => {
    for (const stored of [
      "Jerson L. Catadman",
      "Maria Santos",
      "Jose De La Cruz",
      "Jose Maria D. De La Cruz",
    ]) {
      expect(composeFullName(splitName(stored))).toBe(stored);
    }
  });
});

describe("findDuplicateName", () => {
  const members = [
    { id: "1", full_name: "Jerson L. Catadman" },
    { id: "2", full_name: "Ace Jhon H. Lunor" },
    { id: "3", full_name: "Niño Santos" },
  ];

  it("finds a match that differs only by case and spacing", () => {
    expect(findDuplicateName("  jerson l  catadman ", members, (m) => m.full_name)?.id).toBe("1");
  });

  it("returns the matching entry, not just a boolean", () => {
    const hit = findDuplicateName("ACE JHON H. LUNOR", members, (m) => m.full_name);
    expect(hit?.full_name).toBe("Ace Jhon H. Lunor");
  });

  it("does not match an accented name to its unaccented form", () => {
    expect(findDuplicateName("Nino Santos", members, (m) => m.full_name)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findDuplicateName("Someone Else", members, (m) => m.full_name)).toBeNull();
  });

  it("treats an empty candidate as no match rather than matching a blank row", () => {
    expect(findDuplicateName("   ", [{ id: "x", full_name: "" }], (m) => m.full_name)).toBeNull();
  });
});
