import { describe, expect, it } from "vitest";
import {
  createMemberSchema,
  isReasonableBirthDate,
  memberEditSchema,
  toCreateMemberInput,
} from "@/features/members/member-input";

describe("isReasonableBirthDate", () => {
  const now = new Date("2026-09-30T00:00:00Z");

  it("accepts a real past date", () => {
    expect(isReasonableBirthDate("1990-05-04", now)).toBe(true);
  });

  it("accepts today", () => {
    expect(isReasonableBirthDate("2026-09-30", now)).toBe(true);
  });

  it("rejects tomorrow", () => {
    expect(isReasonableBirthDate("2026-10-01", now)).toBe(false);
  });

  it("rejects a day that does not exist instead of rolling it over", () => {
    expect(isReasonableBirthDate("1990-02-30", now)).toBe(false);
    expect(isReasonableBirthDate("2025-02-29", now)).toBe(false);
  });

  it("accepts a real leap day", () => {
    expect(isReasonableBirthDate("2024-02-29", now)).toBe(true);
  });

  it("rejects a month outside 1 to 12", () => {
    expect(isReasonableBirthDate("1990-13-01", now)).toBe(false);
    expect(isReasonableBirthDate("1990-00-10", now)).toBe(false);
  });

  it("rejects a year before the parish existed", () => {
    expect(isReasonableBirthDate("1899-12-31", now)).toBe(false);
  });
});

describe("createMemberSchema", () => {
  it("requires a first and last name", () => {
    expect(createMemberSchema.safeParse({ first_name: "", last_name: "Smith" }).success).toBe(false);
    expect(createMemberSchema.safeParse({ first_name: "Jerson" }).success).toBe(false);
  });

  it("trims the names", () => {
    const parsed = createMemberSchema.parse({
      first_name: "  Jerson  ",
      last_name: "  Catadman ",
    });
    expect(parsed.first_name).toBe("Jerson");
    expect(parsed.last_name).toBe("Catadman");
  });

  it("normalises a middle initial and tolerates the trailing period", () => {
    const parsed = createMemberSchema.parse({
      first_name: "Jerson",
      middle_initial: "l.",
      last_name: "Catadman",
    });
    expect(parsed.middle_initial).toBe("L");
  });

  it("rejects a middle initial longer than one letter", () => {
    expect(
      createMemberSchema.safeParse({
        first_name: "Jerson",
        middle_initial: "Luc",
        last_name: "Catadman",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown gender instead of storing it", () => {
    expect(
      createMemberSchema.safeParse({
        first_name: "Jerson",
        last_name: "Catadman",
        gender: "other",
      }).success,
    ).toBe(false);
  });

  it("rejects a batch that is not a four digit year", () => {
    const base = { first_name: "Jerson", last_name: "Catadman" };
    expect(createMemberSchema.safeParse({ ...base, batch: "25" }).success).toBe(false);
    expect(createMemberSchema.safeParse({ ...base, batch: "2025" }).success).toBe(true);
  });

  it("allows every optional field to be omitted", () => {
    const parsed = createMemberSchema.parse({ first_name: "Jerson", last_name: "Catadman" });
    expect(parsed.date_of_birth).toBeUndefined();
    expect(toCreateMemberInput(parsed).dateOfBirth).toBeNull();
  });
});

describe("toCreateMemberInput", () => {
  it("maps the snake_case wire shape to what the service expects", () => {
    const parsed = createMemberSchema.parse({
      first_name: "Jerson",
      middle_initial: "l",
      last_name: "Catadman",
      date_of_birth: "1990-05-04",
      gender: "male",
      contact_number: " 09171234567 ",
      batch: "2025",
    });

    // This is the mapping the old route skipped, which is how a member sheet
    // submission ended up inserting an undefined first name.
    expect(toCreateMemberInput(parsed)).toEqual({
      firstName: "Jerson",
      middleInitial: "L",
      lastName: "Catadman",
      dateOfBirth: "1990-05-04",
      gender: "male",
      contactNumber: "09171234567",
      batch: "2025",
    });
  });

  it("turns absent values into null so the column is cleared, not skipped", () => {
    const parsed = createMemberSchema.parse({
      first_name: "Jerson",
      last_name: "Catadman",
      middle_initial: null,
      batch: null,
    });
    const input = toCreateMemberInput(parsed);
    expect(input.middleInitial).toBeNull();
    expect(input.batch).toBeNull();
  });
});

describe("memberEditSchema", () => {
  it("accepts an empty object, since an edit may touch one field", () => {
    expect(memberEditSchema.safeParse({}).success).toBe(true);
  });

  it("rejects blanking a name out", () => {
    expect(memberEditSchema.safeParse({ first_name: "" }).success).toBe(false);
    expect(memberEditSchema.safeParse({ last_name: "   " }).success).toBe(false);
  });

  it("validates a date that is present but leaves an absent one alone", () => {
    expect(memberEditSchema.safeParse({}).success).toBe(true);
    expect(memberEditSchema.safeParse({ date_of_birth: null }).success).toBe(true);
    expect(memberEditSchema.safeParse({ date_of_birth: "04/05/1990" }).success).toBe(false);
    expect(memberEditSchema.safeParse({ date_of_birth: "1990-02-30" }).success).toBe(false);
  });
});
