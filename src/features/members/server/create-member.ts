/**
 * One place that creates a single member row.
 *
 * Approving a registration and adding someone by hand both go through here, so
 * both enforce the same duplicate rules and compose names the same way (module 03,
 * business rules). If these two paths ever drift, the same person ends up on the
 * roll twice, which is the bug the whole duplicate check exists to prevent.
 *
 * The CSV import is deliberately not here. It needs a whole file to land or fail
 * together, which the browser cannot ask for one row at a time, so it goes through
 * kofa_import_members instead. The name rules still match: it duplicates this
 * module's composeFullName/normalizeName handling.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { composeFullName, normalizeName } from "@/lib/members/normalize-name";

export type CreateMemberInput = {
  firstName: string;
  middleInitial?: string | null;
  lastName: string;
  dateOfBirth?: string | null;
  gender?: string | null;
  contactNumber?: string | null;
  batch?: string | null;
};

export type CreateMemberOk = {
  ok: true;
  memberId: string;
  fullName: string;
};

/** An active member already holds this name. Nothing was inserted. */
export type CreateMemberConflict = {
  ok: false;
  reason: "conflict";
  conflictName: string;
  conflictId: string;
};

export type CreateMemberInvalid = {
  ok: false;
  reason: "invalid";
  message: string;
};

export type CreateMemberResult = CreateMemberOk | CreateMemberConflict | CreateMemberInvalid;

/**
 * Finds an active member whose normalized name equals the composed name.
 * Returns null when the name is free.
 */
export async function findActiveMemberByName(
  firstName: string,
  lastName: string,
  middleInitial?: string | null,
): Promise<{ id: string; fullName: string } | null> {
  const target = normalizeName(composeFullName({ firstName, middleInitial, lastName }));
  if (!target) return null;

  const { data, error } = await getSupabaseAdmin()
    .from("members")
    .select("id, full_name")
    .eq("is_active", true);

  if (error) {
    // Let the caller's own insert surface the failure rather than silently
    // treating a broken lookup as "no duplicate found".
    throw new Error(error.message);
  }

  for (const row of data ?? []) {
    if (normalizeName(row.full_name as string) === target) {
      return { id: row.id as string, fullName: row.full_name as string };
    }
  }
  return null;
}

/**
 * Creates one member. Returns a conflict instead of inserting when an active
 * member already has the same name, which is what REG-6 asks the UI to explain.
 */
export async function createMember(input: CreateMemberInput): Promise<CreateMemberResult> {
  const fullName = composeFullName({
    firstName: input.firstName,
    middleInitial: input.middleInitial,
    lastName: input.lastName,
  });

  if (!normalizeName(fullName)) {
    return { ok: false, reason: "invalid", message: "A first and last name are required." };
  }

  const existing = await findActiveMemberByName(
    input.firstName,
    input.lastName,
    input.middleInitial,
  );
  if (existing) {
    return { ok: false, reason: "conflict", conflictName: existing.fullName, conflictId: existing.id };
  }

  const { data, error } = await getSupabaseAdmin()
    .from("members")
    .insert({
      full_name: fullName,
      date_of_birth: input.dateOfBirth || null,
      gender: input.gender || null,
      contact_number: input.contactNumber || null,
      batch: input.batch || null,
    })
    .select("id")
    .single();

  if (error) {
    // The database can still refuse a duplicate through its own index. Report it
    // as the same conflict so the caller has one code path.
    if (error.code === "23505") {
      return { ok: false, reason: "conflict", conflictName: fullName, conflictId: "" };
    }
    return { ok: false, reason: "invalid", message: error.message };
  }

  return { ok: true, memberId: (data?.id as string) ?? "", fullName };
}
