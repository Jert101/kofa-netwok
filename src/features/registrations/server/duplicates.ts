/**
 * Silent duplicate flagging for public registration (module 03, REG-2).
 *
 * The applicant is never told a name already exists. Confirming that would let
 * anyone test whether a given person is in the parish, turning the public form into
 * a member lookup. The application is always accepted; the match is recorded and
 * shown to the admin as a badge to judge.
 */

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { composeFullName, normalizeName, type NameParts } from "@/lib/members/normalize-name";

export type DuplicateCheck = {
  /** Active member with the same name, if any. */
  memberId: string | null;
  memberName: string | null;
  /** A pending request with the same name, if any. */
  pendingRequestId: string | null;
  pendingRequestName: string | null;
};

export type NamedRequest = {
  id: string;
  fullName: string;
};

const NONE: DuplicateCheck = {
  memberId: null,
  memberName: null,
  pendingRequestId: null,
  pendingRequestName: null,
};

/**
 * Compares the applicant's name against active members and still-pending requests.
 *
 * A rejected request is not a match: the person was already turned down once and
 * may legitimately apply again, and blocking or flagging that would be noise.
 */
export async function findPossibleDuplicate(
  parts: NameParts,
  excludeRequestId?: string,
): Promise<DuplicateCheck> {
  const composed = composeFullName(parts);
  const target = normalizeName(composed);
  if (!target) return NONE;

  const sb = getSupabaseAdmin();

  // Members are stored one name per row, so the whole directory has to be read.
  // It is a few thousand rows at most and this runs once per application.
  const [membersResult, pendingResult] = await Promise.all([
    sb.from("members").select("id, full_name").eq("is_active", true),
    sb
      .from("registration_requests")
      .select("id, first_name, last_name, middle_initial")
      .eq("status", "pending"),
  ]);

  if (membersResult.error) {
    // A flag is a convenience for the admin, not a gate. If the check cannot run,
    // accept the application rather than losing it.
    console.error("[registrations] duplicate check failed for members:", membersResult.error.message);
  } else {
    for (const row of membersResult.data ?? []) {
      if (normalizeName(row.full_name as string) === target) {
        return {
          memberId: row.id as string,
          memberName: row.full_name as string,
          pendingRequestId: null,
          pendingRequestName: null,
        };
      }
    }
  }

  if (pendingResult.error) {
    console.error(
      "[registrations] duplicate check failed for pending requests:",
      pendingResult.error.message,
    );
  } else {
    for (const row of pendingResult.data ?? []) {
      if (row.id === excludeRequestId) continue;
      const other = composeFullName({
        firstName: row.first_name as string,
        middleInitial: row.middle_initial as string | null,
        lastName: row.last_name as string,
      });
      if (normalizeName(other) === target) {
        return {
          memberId: null,
          memberName: null,
          pendingRequestId: row.id as string,
          pendingRequestName: other,
        };
      }
    }
  }

  return NONE;
}

/**
 * Finds names that appear more than once among *still pending* requests.
 *
 * `allPending` is the whole pending set, not just the page being shown: a twin on
 * page 3 has to be flagged on page 1, and the table is the only place this is
 * known because there is no column for it.
 *
 * Kept pure and separate from the fetch so the matching can be tested.
 */
export function buildPendingTwinMap<T extends NamedRequest>(
  page: readonly T[],
  allPending: readonly NamedRequest[],
): Map<string, NamedRequest> {
  const idsByName = new Map<string, NamedRequest[]>();
  for (const row of allPending) {
    const key = normalizeName(row.fullName);
    if (!key) continue;
    const bucket = idsByName.get(key);
    if (bucket) bucket.push(row);
    else idsByName.set(key, [row]);
  }

  const twins = new Map<string, NamedRequest>();
  for (const row of page) {
    const candidates = idsByName.get(normalizeName(row.fullName)) ?? [];
    const other = candidates.find((c) => c.id !== row.id);
    if (other) twins.set(row.id, other);
  }
  return twins;
}

/**
 * Every still-pending request, reduced to the fields needed for matching.
 *
 * Only the id and the composed name are read, so this stays small enough to run
 * on each page of the review table.
 */
export async function fetchPendingNamePairs(): Promise<NamedRequest[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("registration_requests")
    .select("id, first_name, last_name, middle_initial")
    .eq("status", "pending");

  if (error) {
    // A missing badge is a smaller problem than failing to load the page.
    console.error("[registrations] could not read pending requests:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    fullName: composeFullName({
      firstName: row.first_name as string,
      middleInitial: row.middle_initial as string | null,
      lastName: row.last_name as string,
    }),
  }));
}

/**
 * Looks up the names behind `possible_duplicate_member_id`.
 *
 * Without this the table knows a request matches an existing member but cannot
 * say who, so the most important duplicate badge is the one that never appears.
 * Inactive members are included: a request can match someone who was since
 * deactivated, and the admin still needs to see the name to judge it.
 */
export async function fetchMemberNames(ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const { data, error } = await getSupabaseAdmin()
    .from("members")
    .select("id, full_name")
    .in("id", unique);

  if (error) {
    console.error("[registrations] could not read duplicate members:", error.message);
    return new Map();
  }

  const names = new Map<string, string>();
  for (const row of data ?? []) names.set(row.id as string, row.full_name as string);
  return names;
}
