/**
 * COM-1 / COM-2: who an announcement is for, and how the feed is ordered.
 *
 * Pure on purpose. The audience rules are the part of the announcements module worth being sure
 * about, because a bug here leaks a message to the parish that was meant for one role, and the
 * symptom is a person reading something that was not theirs. So it is arithmetic on arrays, in a
 * file with no database in it, and it has tests.
 */

import type { Role } from "@/lib/auth/roles";

/** The three roles that can post. Anything else cannot reach the composer or the API. */
export const ANNOUNCER_ROLES = ["admin", "secretary", "officer"] as const satisfies readonly Role[];

/** Every role that can read the feed. */
export const AUDIENCE_ROLES = ["admin", "secretary", "officer", "member", "treasurer"] as const;

/** Spec COM-1. Deliberately below the database column, which is generous for older rows. */
export const TITLE_MAX = 100;
export const BODY_MAX = 2000;

export type Audience = {
  roles: Role[];
  batches: string[];
};

/** The audience of a post as it comes back from the database, before it is interpreted. */
export type AnnouncementRow = {
  id: string;
  created_at?: string | null;
  created_by?: string | null;
  updated_at?: string | null;
  audience_roles?: string[] | null;
  audience_batches?: string[] | null;
  delete_at?: string | null;
  pinned?: boolean | null;
};

export type Viewer = {
  role: Role;
  /** The viewer's batch year, e.g. "2024". Null when the parish has not recorded one. */
  batch: string | null;
};

export const MAX_PINNED = 3;

/** The audience of a stored row, normalised. Every reader goes through this one function. */
export function audienceOf(row: AnnouncementRow): Audience {
  return normalizeAudience({ roles: row.audience_roles, batches: row.audience_batches });
}

export function emptyAudience(): Audience {
  return { roles: [], batches: [] };
}

/**
 * Normalise whatever the composer or a stored row produced into a usable audience.
 *
 * An empty result means everyone, and that is the documented default rather than an oversight: a
 * post with no audience fields was written before audiences existed and must stay visible to the
 * whole parish.
 */
export function normalizeAudience(input: {
  roles?: readonly string[] | null;
  batches?: readonly string[] | null;
}): Audience {
  const roles: Role[] = [];
  for (const r of input.roles ?? []) {
    const role = String(r).trim().toLowerCase();
    if ((AUDIENCE_ROLES as readonly string[]).includes(role) && !roles.includes(role as Role)) {
      roles.push(role as Role);
    }
  }

  const batches: string[] = [];
  for (const b of input.batches ?? []) {
    const batch = String(b).trim();
    if (batch && !batches.includes(batch)) batches.push(batch);
  }

  return { roles, batches };
}

/**
 * COM-2: does this post belong in this viewer's feed?
 *
 * Roles and batches are a union, never an intersection: a post for "secretaries and batch 2024"
 * is for secretaries in any batch and for batch 2024 in any role. Requiring both would silently
 * hide posts from people who match either half, which is the kind of bug nobody reports because the
 * symptom is "I didn't get told" rather than an error.
 *
 * An audience naming only batches cannot match a viewer without a batch year, and that is correct:
 * the alternative is showing a batch-specific post to everyone who never told us their batch.
 */
export function isForViewer(audience: Audience, viewer: Viewer): boolean {
  if (audience.roles.length === 0 && audience.batches.length === 0) return true;
  if (audience.roles.includes(viewer.role)) return true;
  if (viewer.batch && audience.batches.includes(viewer.batch)) return true;
  return false;
}

/** Expired posts stay out of the feed but are still visible to `mine=1` so they can be cleaned up. */
export function isExpired(row: AnnouncementRow, now: Date = new Date()): boolean {
  if (!row.delete_at) return false;
  return new Date(row.delete_at).getTime() <= now.getTime();
}

/**
 * COM-2: pinned first, then newest, and the pinned block is capped.
 *
 * Over-cap pins are demoted rather than dropped. Hiding a post because the parish pinned five is
 * worse than showing it unpinned: the author published it, somebody thought it mattered, and
 * quietly removing it is the one outcome nobody asked for. The API refuses to create a fourth, so
 * this only ever applies to rows that predate the limit.
 *
 * `includeExpired` exists for the author's own list. The feed drops a post that has run out; the
 * author still has to be able to find it, because "unpin this" and "delete the wrong thing" are the
 * requests that arrive after the expiry date, not before it.
 */
export function sortAnnouncements<T extends AnnouncementRow>(
  rows: T[],
  now: Date = new Date(),
  includeExpired = false,
): T[] {
  const visible = includeExpired ? rows : rows.filter((r) => !isExpired(r, now));
  const ordered = [...visible].sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff !== 0) return pinDiff;
    return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
  });

  let pinnedSeen = 0;
  return ordered.map((r) => {
    if (!r.pinned) return r;
    pinnedSeen += 1;
    if (pinnedSeen <= MAX_PINNED) return r;
    return { ...r, pinned: false };
  });
}

/** Expiry presets, in the order the composer offers them. Default is one month. */
export type ExpiryPreset = "week" | "month" | "custom" | "never";

export const DEFAULT_EXPIRY: ExpiryPreset = "month";

/**
 * The stored `delete_at` for a preset.
 *
 * Null means never, which is a real choice rather than "unset": the difference between a post that
 * disappears in a month and one that sits in the feed forever is exactly what an author picks here.
 */
export function expiryFor(
  preset: ExpiryPreset,
  now: Date = new Date(),
  customIso?: string | null,
): string | null {
  switch (preset) {
    case "week":
      return new Date(now.getTime() + 7 * 86_400_000).toISOString();
    case "month":
      return new Date(now.getTime() + 30 * 86_400_000).toISOString();
    case "custom":
      return customIso ?? null;
    case "never":
      return null;
  }
}

/** COM-1: who may change this post. */
export function canModify(row: AnnouncementRow, viewerRole: Role): boolean {
  // System rows are the birthday job's. Their text is generated and their style is fixed, so
  // letting a human retitle one would put the parish's own greeting in a stranger's words.
  if (row.created_by === "system") return false;
  if (viewerRole === "admin") return true;
  return row.created_by === viewerRole;
}

/** COM-1: the badge the feed shows when `updated_at` is set. */
export function wasEdited(row: AnnouncementRow): boolean {
  return Boolean(row.updated_at);
}

/**
 * Role names as the composer and the feed show them.
 *
 * Written out rather than pluralised by appending "s", because "Secretarys" is a word, and a
 * composer that says "Secretarys" is a composer people stop trusting.
 */
const ROLE_LABELS: Record<string, { one: string; many: string }> = {
  admin: { one: "Admins", many: "Admins" },
  secretary: { one: "Secretaries", many: "Secretaries" },
  officer: { one: "Officers", many: "Officers" },
  member: { one: "Members", many: "Members" },
  treasurer: { one: "Treasurers", many: "Treasurers" },
};

/** Human summary for the composer and the feed, e.g. "Everyone" or "Officers + batch 2024". */
export function describeAudience(audience: Audience): string {
  if (audience.roles.length === 0 && audience.batches.length === 0) return "Everyone";

  const parts: string[] = [];
  if (audience.roles.length > 0) {
    const labels = audience.roles.map((r) => ROLE_LABELS[r]?.many ?? r);
    parts.push(labels.length === 1 ? labels[0] : labels.slice(0, -1).join(", ") + " and " + labels[labels.length - 1]);
  }
  if (audience.batches.length > 0) {
    parts.push(
      audience.batches.length === 1
        ? `batch ${audience.batches[0]}`
        : `batches ${audience.batches.slice(0, -1).join(", ")} and ${audience.batches[audience.batches.length - 1]}`,
    );
  }
  return parts.join(" + ");
}
