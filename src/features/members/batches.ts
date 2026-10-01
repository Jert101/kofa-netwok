/**
 * Batch labels and the "this is in use" message (module 03, MEM-6).
 *
 * Client-safe on purpose. The delete dialog wants to warn before the admin asks,
 * and the route wants to report the same sentence once the server has the real
 * counts. One helper keeps those two from drifting into different wording, which
 * would look like a bug even though both are correct.
 */

export type BatchRow = {
  id: string;
  year: string;
  member_count: number;
  /** Payment structures scoped to this batch. A batch can be in use with no members. */
  structure_count?: number;
};

export function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Names what is holding a batch, so the admin does not have to go looking.
 *
 * The spec's example is "2025 is used by 34 members and 1 payment structure.", so
 * both counts are named when both are present. Zero counts are left out entirely:
 * saying "used by 0 members" alongside a real count would just be noise.
 */
export function batchInUseMessage(
  year: string,
  memberCount: number,
  structureCount: number,
): string {
  const parts: string[] = [];
  if (memberCount > 0) parts.push(plural(memberCount, "member"));
  if (structureCount > 0) parts.push(plural(structureCount, "payment structure"));
  return `${year} is used by ${parts.join(" and ")}.`;
}

export function isBatchInUse(batch: Pick<BatchRow, "member_count" | "structure_count">): boolean {
  return batch.member_count > 0 || (batch.structure_count ?? 0) > 0;
}
