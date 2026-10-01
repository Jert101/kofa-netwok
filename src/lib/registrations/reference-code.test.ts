import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REFERENCE_ALPHABET,
  REFERENCE_CODE_LENGTH,
  describeReferenceCodeProblem,
  hasAmbiguousCharacter,
  isWellFormedReferenceCode,
  normalizeReferenceCodeInput,
} from "./reference-code";
import { generateReferenceCode, generateReferenceCodeWith } from "./generate";

describe("REFERENCE_ALPHABET", () => {
  it("omits the characters people mistype", () => {
    // 0/O and 1/I are the pairs that get confused when a code is read aloud or
    // written down by hand.
    for (const bad of ["0", "O", "1", "I"]) {
      expect(REFERENCE_ALPHABET).not.toContain(bad);
    }
  });

  it("has no repeated characters, so codes do not waste a symbol", () => {
    expect(new Set(REFERENCE_ALPHABET).size).toBe(REFERENCE_ALPHABET.length);
  });

  it("is long enough that guessing a code is hopeless", () => {
    // 31^8 is roughly 8.5e11 possibilities.
    expect(Math.pow(REFERENCE_ALPHABET.length, REFERENCE_CODE_LENGTH)).toBeGreaterThan(1e11);
  });
});

describe("generateReferenceCode", () => {
  it("produces the documented length", () => {
    expect(generateReferenceCode().length).toBe(REFERENCE_CODE_LENGTH);
  });

  it("only ever uses alphabet characters", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateReferenceCode();
      expect([...code].every((ch) => REFERENCE_ALPHABET.includes(ch))).toBe(true);
    }
  });

  it("never contains an ambiguous character", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(hasAmbiguousCharacter(generateReferenceCode())).toBe(false);
    }
  });

  it("does not repeat the same code over many draws", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateReferenceCode());
    expect(seen.size).toBe(500);
  });

  it("clamps an unreasonable length instead of producing nothing", () => {
    expect(generateReferenceCode(2).length).toBe(4);
    expect(generateReferenceCode(99).length).toBe(16);
  });
});

describe("generateReferenceCodeWith", () => {
  it("maps a picker to alphabet characters, left to right", () => {
    // 0 → "A", 1 → "B", 2 → "C"
    const picks = [0, 1, 2, 0, 1, 2, 0, 1];
    let i = 0;
    expect(generateReferenceCodeWith(() => picks[i++])).toBe("ABCABCAB");
  });

  it("wraps a picker that goes past the end of the alphabet", () => {
    const code = generateReferenceCodeWith(() => REFERENCE_ALPHABET.length + 2);
    expect(code.length).toBe(REFERENCE_CODE_LENGTH);
    expect([...code].every((ch) => REFERENCE_ALPHABET.includes(ch))).toBe(true);
  });

  it("tolerates a negative picker", () => {
    const code = generateReferenceCodeWith(() => -1);
    expect(code.length).toBe(REFERENCE_CODE_LENGTH);
  });
});

describe("normalizeReferenceCodeInput", () => {
  it("uppercases and removes separators people add themselves", () => {
    expect(normalizeReferenceCodeInput("abc-def gh")).toBe("ABCDEFGH");
    expect(normalizeReferenceCodeInput("  abcd efgh  ")).toBe("ABCDEFGH");
  });

  it("leaves an already clean code untouched", () => {
    expect(normalizeReferenceCodeInput("K7M2QP4Z")).toBe("K7M2QP4Z");
  });
});

describe("describeReferenceCodeProblem", () => {
  it("accepts a real code", () => {
    expect(describeReferenceCodeProblem("K7M2QP4Z")).toBeNull();
  });

  it("reports the wrong length", () => {
    expect(describeReferenceCodeProblem("K7M2")).toBe("length");
    expect(describeReferenceCodeProblem("K7M2QP4ZAB")).toBe("length");
  });

  it("reports an ambiguous character, which is a transcription slip", () => {
    expect(describeReferenceCodeProblem("K7M2QP04")).toBe("ambiguous");
    expect(describeReferenceCodeProblem("K7M2QPOZ")).toBe("ambiguous");
    expect(describeReferenceCodeProblem("K7M2QPIZ")).toBe("ambiguous");
    expect(describeReferenceCodeProblem("K7M2QP1Z")).toBe("ambiguous");
  });

  it("reports a character outside the alphabet", () => {
    expect(describeReferenceCodeProblem("K7M2QP$Z")).toBe("character");
  });
});

describe("isWellFormedReferenceCode", () => {
  it("is true only for a real code", () => {
    expect(isWellFormedReferenceCode("K7M2QP4Z")).toBe(true);
    expect(isWellFormedReferenceCode("k7m2qp4z")).toBe(false);
    expect(isWellFormedReferenceCode("K7M2QP4")).toBe(false);
    expect(isWellFormedReferenceCode("K7M2QPIZ")).toBe(false);
  });
});

describe("alphabet agrees with the generator in migration 025", () => {
  // The alphabet exists in two places because the code is made in Postgres but
  // checked in the browser. Nothing ties them together at build time, so if they
  // drift the status form starts rejecting codes the database genuinely issued,
  // and the applicant is told "not found" for a code they copied correctly. The
  // two agreeing is the thing worth protecting.
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "025_registration_reference_codes.sql"),
    "utf8",
  );

  it("matches the alphabet declared in SQL", () => {
    const declared = /alphabet\s+constant\s+text\s*:=\s*'([^']+)'/.exec(sql)?.[1];
    expect(declared).toBe(REFERENCE_ALPHABET);
  });

  it("matches the length the SQL function defaults to", () => {
    expect(sql).toMatch(
      new RegExp(`kofa_reference_code\\(p_length\\s+int\\s+DEFAULT\\s+${REFERENCE_CODE_LENGTH}\\)`),
    );
  });

  it("stays unambiguous on the SQL side too", () => {
    const declared = /alphabet\s+constant\s+text\s*:=\s*'([^']+)'/.exec(sql)?.[1] ?? "";
    for (const bad of ["0", "O", "1", "I"]) {
      expect(declared).not.toContain(bad);
    }
  });
});
