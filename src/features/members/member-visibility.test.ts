import { describe, expect, it } from "vitest";

import {
  memberScopeFor,
  memberScopeForSubject,
  redactMember,
  visibleMemberFields,
} from "./member-visibility";

const SOMEONE_ELSE = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";

const row = {
  id: SOMEONE_ELSE,
  full_name: "Dela Cruz, Ana",
  date_of_birth: "1990-04-12",
  gender: "female",
  contact_number: "09171234567",
  batch: "2024",
  is_active: false,
  deactivated_at: "2026-01-04T00:00:00Z",
  deactivation_reason: "Left the parish after a dispute with the parish council.",
  created_at: "2024-06-01T00:00:00Z",
};

describe("memberScopeFor", () => {
  it("gives the admin everything, because the admin edits all of it", () => {
    const scope = memberScopeFor({ role: "admin", actorId: null });
    expect(scope).toEqual({ dateOfBirth: true, contactNumber: true, deactivationReason: true });
  });

  it("gives the treasurer the phone number but not the reason someone left", () => {
    const scope = memberScopeFor({ role: "treasurer", actorId: null });
    // Chasing dues needs the number.
    expect(scope.contactNumber).toBe(true);
    // Why a member is off the roll is not part of collecting money.
    expect(scope.deactivationReason).toBe(false);
  });

  it("gives the secretary and officer the roster but no phone numbers", () => {
    for (const role of ["secretary", "officer"] as const) {
      const scope = memberScopeFor({ role, actorId: null });
      expect(scope.contactNumber).toBe(false);
      expect(scope.deactivationReason).toBe(false);
      // Birthdays stay: the directory is specified around birth-month lists.
      expect(scope.dateOfBirth).toBe(true);
    }
  });

  it("gives a plain member the minimal set the spec asks for", () => {
    expect(memberScopeFor({ role: "member", actorId: null })).toEqual({
      dateOfBirth: false,
      contactNumber: false,
      deactivationReason: false,
    });
  });
});

describe("memberScopeForSubject", () => {
  it("shows a member their own row in full, whatever their role", () => {
    // Identity wins over role, the same rule the payments lookup uses.
    const scope = memberScopeForSubject({ role: "member", actorId: ME }, ME);
    expect(scope).toEqual({ dateOfBirth: true, contactNumber: true, deactivationReason: true });
  });

  it("does not extend that to anybody else", () => {
    const scope = memberScopeForSubject({ role: "member", actorId: ME }, SOMEONE_ELSE);
    expect(scope.contactNumber).toBe(false);
  });

  it("does not mistake a null actor id for a match", () => {
    // Two sessions with no actor picked are both "null", so `null === null` must not unlock a row.
    const scope = memberScopeForSubject({ role: "member", actorId: null }, null);
    expect(scope.contactNumber).toBe(false);
  });
});

describe("redactMember", () => {
  it("returns the row untouched for a full scope", () => {
    const scope = memberScopeFor({ role: "admin", actorId: null });
    expect(redactMember(row, scope)).toBe(row);
  });

  it("blanks the hidden fields and leaves the rest readable", () => {
    const out = redactMember(row, memberScopeFor({ role: "member", actorId: null }));
    expect(out.contact_number).toBeNull();
    expect(out.deactivation_reason).toBeNull();
    expect(out.date_of_birth).toBeNull();
    // The roster itself is not secret: name, batch and active flag still come through.
    expect(out.full_name).toBe("Dela Cruz, Ana");
    expect(out.batch).toBe("2024");
    expect(out.is_active).toBe(false);
    expect(out.deactivated_at).toBe("2026-01-04T00:00:00Z");
  });

  it("keeps the field present as null rather than dropping the key", () => {
    // A stable client shape: an omitted key would be `undefined` and could crash a component, while
    // `null` is a value the directory already knows how to print.
    const out = redactMember(row, memberScopeFor({ role: "member", actorId: null }));
    expect("contact_number" in out).toBe(true);
    expect("deactivation_reason" in out).toBe(true);
  });

  it("does not mutate the row it was given", () => {
    redactMember(row, memberScopeFor({ role: "member", actorId: null }));
    expect(row.contact_number).toBe("09171234567");
    expect(row.deactivation_reason).toContain("dispute");
  });
});

describe("visibleMemberFields", () => {
  it("always offers the roster columns", () => {
    const fields = visibleMemberFields(memberScopeFor({ role: "member", actorId: null }));
    for (const always of ["id", "full_name", "gender", "batch", "is_active", "deactivated_at"]) {
      expect(fields).toContain(always);
    }
  });

  it("withholds the sensitive column names from a member", () => {
    const fields = visibleMemberFields(memberScopeFor({ role: "member", actorId: null }));
    expect(fields).not.toContain("contact_number");
    expect(fields).not.toContain("deactivation_reason");
    expect(fields).not.toContain("date_of_birth");
  });

  it("gives the treasurer the contact column and withholds the reason column", () => {
    const fields = visibleMemberFields(memberScopeFor({ role: "treasurer", actorId: null }));
    expect(fields).toContain("contact_number");
    expect(fields).not.toContain("deactivation_reason");
  });
});
