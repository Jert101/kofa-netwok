import { z } from "zod";

const MIN_AGE = 10;
const MAX_AGE = 100;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
] as const;

function yearsSince(iso: string, now: Date): number {
  const [year, month, day] = iso.split("-").map(Number);
  let age = now.getUTCFullYear() - year;
  const monthDiff = now.getUTCMonth() + 1 - month;
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < day)) {
    age -= 1;
  }
  return age;
}

/**
 * Conventions: trim strings and normalize names and phone numbers *before*
 * validating, so one plain schema can serve both the form and the route.
 */
export function normalizeRegisterInput(raw: Record<string, unknown>) {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  return {
    first_name: text(raw.first_name).replace(/\s+/g, " "),
    last_name: text(raw.last_name).replace(/\s+/g, " "),
    middle_initial: text(raw.middle_initial).replace(/\./g, "").toUpperCase(),
    date_of_birth: text(raw.date_of_birth),
    gender: text(raw.gender),
    contact_number: text(raw.contact_number).replace(/\D/g, ""),
    batch: text(raw.batch),
  };
}

const nameField = (label: string) =>
  z
    .string()
    .min(2, `${label} must be at least 2 characters.`)
    .max(60, `${label} must be 60 characters or fewer.`);

export const registerSchema = z.object({
  first_name: nameField("First name"),
  last_name: nameField("Last name"),
  middle_initial: z
    .string()
    .refine((value) => value === "" || /^[A-Z]$/.test(value), {
      message: "Use a single letter, like M.",
    }),
  date_of_birth: z
    .string()
    .regex(ISO_DATE, "Enter a valid date.")
    .refine((value) => {
      const [year, month, day] = value.split("-").map(Number);
      if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    }, "Enter a valid date.")
    .refine((value) => {
      const age = yearsSince(value, new Date());
      return age >= 0;
    }, "Date of birth must be in the past.")
    .refine((value) => {
      const age = yearsSince(value, new Date());
      return age >= MIN_AGE;
    }, `Applicants must be at least ${MIN_AGE} years old.`)
    .refine((value) => {
      const age = yearsSince(value, new Date());
      return age <= MAX_AGE;
    }, `Enter a date of birth within the last ${MAX_AGE} years.`),
  gender: z.enum(["male", "female"], {
    message: "Choose male or female.",
  }),
  contact_number: z
    .string()
    .min(10, "Enter a valid contact number.")
    .max(13, "Enter a valid contact number."),
  batch: z.string().max(20, "That batch is not valid."),
});

export type RegisterInput = z.infer<typeof registerSchema>;
