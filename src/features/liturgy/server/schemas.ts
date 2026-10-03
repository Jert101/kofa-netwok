import { z } from "zod";

/**
 * Module 07 request schemas.
 *
 * Wider than `lib/attendance/liturgy-slots.ts`, which required a `member_id` on every row and
 * had no guest field. LIT-1 makes free text a first-class choice in the assignee picker, and
 * LIT-2's copy can produce positions with nobody in them yet, so a row may legitimately carry
 * a guest name, a member id, or (mid-edit) neither.
 *
 * `free_text` and `member_id` are both optional rather than mutually exclusive here; which one
 * wins is a server rule, enforced in `writeLiturgyRows`, because deciding it here would reject
 * the payload instead of resolving it.
 */
export const slotSchema = z.object({
  position_label: z.string().trim().min(1).max(80),
  member_id: z.string().uuid().nullable().optional(),
  free_text: z.string().trim().max(120).nullable().optional(),
});

export const slotsSchema = z.array(slotSchema).max(64);

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const massIdSchema = z.string().uuid();

/**
 * `expected_version` is optional so a first save works, and present afterwards so "Updated by
 * another device" can be reported (spec §8). It is a token rather than an integer because the
 * server falls back to row timestamps until migration 030 has run.
 */
export const saveBodySchema = z.object({
  slots: slotsSchema,
  expected_version: z.string().max(60).nullable().optional(),
});

export const plannedQuerySchema = z.object({
  date: dateSchema,
  mass_id: massIdSchema,
});

export const plannedSaveBodySchema = saveBodySchema.extend({
  session_date: dateSchema,
  mass_id: massIdSchema,
});

export const sessionSaveBodySchema = saveBodySchema;

/** LIT-2's copy request. `to` is either a planned (date, mass) pair or a session id. */
export const copyBodySchema = z
  .object({
    from: z.union([
      z.object({ session_date: dateSchema, mass_id: massIdSchema }),
      z.object({ session_id: z.string().uuid() }),
    ]),
    to: z.union([
      z.object({ session_date: dateSchema, mass_id: massIdSchema }),
      z.object({ session_id: z.string().uuid() }),
    ]),
    include_members: z.boolean(),
  })
  .refine((v) => !sameTarget(v.from, v.to), {
    message: "Pick a different date to copy from.",
    path: ["from"],
  });

function sameTarget(
  a: { session_date?: string; mass_id?: string; session_id?: string },
  b: { session_date?: string; mass_id?: string; session_id?: string },
): boolean {
  if (a.session_id && b.session_id) return a.session_id === b.session_id;
  return a.session_date === b.session_date && a.mass_id === b.mass_id;
}

export const templateSaveBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
  position_labels: z.array(z.string().trim().min(1).max(80)).min(1).max(48),
});

export const templateRenameBodySchema = z.object({
  name: z.string().trim().min(1).max(60),
});