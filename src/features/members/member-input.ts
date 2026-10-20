/**
 * The member write shapes shared by the form, the routes and the CSV importer
 * (module 03, conventions: one shared validator per feature).
 *
 * These are the wire names (snake_case) because that is what the sheet
 * collects and what the CSV template headers use. They are not all columns:
 * `members` stores one `full_name`, so callers must compose it from the parts
 * (see `createMember` / `editMember`) and never send `first_name` et al. to
 * the table -- PostgREST answers 400 PGRST204 for unknown columns, which is
 * how "Could not find the 'first_name' column" reaches the screen.
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
  gender: genderSchema.optional().nullable(),
  contact_number: contactNumberSchema.optional().nullable(),
  batch: batchSchema.optional().nullable(),
};

/**
 * The date of birth, required on the add path. The empty string is turned into
 * "missing" before the shape check, so a person who left the field blank reads
 * "Required" rather than "Use YYYY-MM-DD".
 *
 * Why it is required at all: see `birthday.ts`. The parish announces birthdays
 * and a member with no date of birth can never be greeted. The public
 * registration form has always required one, so the only members missing one
 * are the ones an admin typed in by hand.
 */
export const requiredDateOfBirthSchema = z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  dateOfBirthSchema,
);

/**
 * Adding a member. First and last name are required, because `full_name` is
 * derived from them and the duplicate check compares the composed result.
 */
export const createMemberSchema = z.object({
  first_name: z.string().trim().min(1, "A first name is required.").max(100),
  last_name: z.string().trim().min(1, "A last name is required.").max(100),
  date_of_birth: requiredDateOfBirthSchema,
  ...sharedFields,
});

/**
 * Editing a member. Every field is optional, but the name is still rejected if
 * it is present and empty, so a partial update cannot blank a name out.
 */
export const memberEditSchema = z.object({
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  // Nullable so an edit can still touch a row that predates the required rule;
  // the add path is where a missing date of birth is refused.
  date_of_birth: dateOfBirthSchema.optional().nullable(),
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
