/**
 * The member write shapes shared by the form, the routes and the CSV importer
 * (module 03, conventions: one shared validator per feature).
 *
 * These are the wire/column names (snake_case) because that is what the sheet
 * collects, what the table stores and what the CSV template headers use. The
 * server service is handed the camelCase view through `toCreateMemberInput`.
 *
 * Client-safe on purpose: importing this from a component must not drag in the
 * Supabase admin client.
 */

import { z } from "zod";

/** Before 1900 nobody in the parish was born; after today nobody has been yet. */
export function isReasonableBirthDate(iso: string, now = new Date()): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return false;
  // Rejects 1990-02-30 as well as 1990-13-01, which Date.UTC would roll over.
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return false;
  }
  if (y < 1900) return false;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return date <= today;
}

/**
 * A middle initial is one letter. People type "L." and "l" for the same person,
 * so the period is stripped and the case folded *before* the length is checked;
 * a plain `.max(1)` on the raw string would reject "L." as two characters.
 */
export const middleInitialSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\./g, "").toUpperCase())
  .pipe(
    z
      .string()
      .max(1, "Use a single letter, or leave it empty.")
      .regex(/^[A-Z]*$/, "Use a single letter, or leave it empty."),
  );

export const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine(isReasonableBirthDate, "That is not a real birth date.");

export const batchSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "Use a four digit year.");

export const genderSchema = z.enum(["male", "female"]);

export const contactNumberSchema = z
  .string()
  .trim()
  .max(20, "That contact number is too long.");

/** The shared optional fields, so add, edit and import cannot drift apart. */
const sharedFields = {
  middle_initial: middleInitialSchema.optional().nullable(),
  date_of_birth: dateOfBirthSchema.optional().nullable(),
  gender: genderSchema.optional().nullable(),
  contact_number: contactNumberSchema.optional().nullable(),
  batch: batchSchema.optional().nullable(),
};

/**
 * Adding a member. First and last name are required, because `full_name` is
 * derived from them and the duplicate check compares the composed result.
 */
export const createMemberSchema = z.object({
  first_name: z.string().trim().min(1, "A first name is required.").max(100),
  last_name: z.string().trim().min(1, "A last name is required.").max(100),
  ...sharedFields,
});

/**
 * Editing a member. Every field is optional, but the name is still rejected if
 * it is present and empty, so a partial update cannot blank a name out.
 */
export const memberEditSchema = z.object({
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  ...sharedFields,
});

export type CreateMemberForm = z.infer<typeof createMemberSchema>;
export type MemberEditForm = z.infer<typeof memberEditSchema>;

/** The camelCase view `createMember` expects. */
export function toCreateMemberInput(form: CreateMemberForm): {
  firstName: string;
  middleInitial: string | null;
  lastName: string;
  dateOfBirth: string | null;
  gender: string | null;
  contactNumber: string | null;
  batch: string | null;
} {
  return {
    firstName: form.first_name,
    middleInitial: form.middle_initial ?? null,
    lastName: form.last_name,
    dateOfBirth: form.date_of_birth ?? null,
    gender: form.gender ?? null,
    contactNumber: form.contact_number ?? null,
    batch: form.batch ?? null,
  };
}
