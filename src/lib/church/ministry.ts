import { z } from "zod";

/**
 * The three editable lists on the landing page, other than the council.
 *
 * They are described as data rather than written as three near-identical routes, three near-identical
 * editor blocks and three near-identical page sections. That is not tidiness for its own sake: three
 * copies of "add a row, edit it, save it, delete it" drift apart the first time one of them gets a fix,
 * and the third one is always the copy that missed it.
 *
 * A `kind` narrows the table, the columns and the validation together, so adding a field cannot leave
 * one of the three behind -- which is exactly what happened to `photo_url`, which was patchable on the
 * council and silently dropped from its schema.
 */

/** The lists. `council` is absent because it has its own routes, an `is_active` and photographs. */
export const MINISTRY_KINDS = ["role", "milestone", "patron"] as const;

export type MinistryKind = (typeof MINISTRY_KINDS)[number];

export function isMinistryKind(value: unknown): value is MinistryKind {
  return typeof value === "string" && (MINISTRY_KINDS as readonly string[]).includes(value);
}

/** The table each kind is stored in. Not derived from the name, so it cannot be parameterised by accident. */
export const MINISTRY_TABLE: Record<MinistryKind, string> = {
  role: "ministry_roles",
  milestone: "history_milestones",
  patron: "patron_saints",
};

/**
 * The glyph a role is drawn with.
 *
 * A closed list, because these are rendered as drawn icons on the page and an open list would mean
 * storing a name from some icon library and trusting it to still exist when the library is upgraded. A
 * stored key that has been renamed renders nothing at all, silently.
 */
export const ROLE_ICONS = [
  "cross",
  "candle",
  "censer",
  "bell",
  "book",
  "star",
  "hands",
  "scroll",
] as const;

export type RoleIcon = (typeof ROLE_ICONS)[number];

export function isRoleIcon(value: unknown): value is RoleIcon {
  return typeof value === "string" && (ROLE_ICONS as readonly string[]).includes(value);
}

/** Fields of `history_milestones` that are italicised on the page. A short, closed list, for the same reason. */
export const MILESTONE_ITALICS = ["Ministeria Quaedam", "Spiritus Domini"] as const;

export type Role = {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  sort_order: number;
  is_active?: boolean;
};

export type Milestone = {
  id: string;
  year_label: string;
  body: string;
  sort_order: number;
  is_active?: boolean;
};

export type Patron = {
  id: string;
  name: string;
  note: string | null;
  sort_order: number;
  is_active?: boolean;
};

/**
 * Every editable column of a kind, in one place: how it is validated, how long it may be, and how the
 * editor draws it.
 *
 * These used to be two lists -- `MINISTRY_FIELDS` for validation and `MINISTRY_EDITOR_FIELDS` for the
 * form -- and they had already drifted, because the role's `icon` was validated but declared only in
 * the schema builder. A test comparing the two caught it. One list cannot drift from itself, so the
 * validation and the form are both built from this.
 */
export type MinistryFieldSpec = {
  column: string;
  label: string;
  placeholder: string;
  max: number;
  /** A textarea rather than an input, for the columns that hold a sentence. */
  multiline?: boolean;
  /** A fixed set of choices rather than free text. Only roles use this today. */
  choices?: readonly RoleIcon[];
};

export const MINISTRY_EDITOR_FIELDS: Record<MinistryKind, readonly MinistryFieldSpec[]> = {
  role: [
    { column: "name", label: "Role", placeholder: "e.g. Crucifer", max: 120 },
    {
      column: "description",
      label: "What they do",
      placeholder: "One or two sentences.",
      max: 400,
      multiline: true,
    },
    { column: "icon", label: "Icon", placeholder: "", max: 20, choices: ROLE_ICONS },
  ],
  milestone: [
    { column: "year_label", label: "When", placeholder: "e.g. c. 251, or 1962–65", max: 40 },
    { column: "body", label: "What happened", placeholder: "One sentence.", max: 600, multiline: true },
  ],
  patron: [
    { column: "name", label: "Saint", placeholder: "e.g. St. Tarcisius", max: 120 },
    { column: "note", label: "Note", placeholder: "Optional — e.g. Patron of altar servers.", max: 300 },
  ],
};

/** The columns the editor must not draw: written by the database or by list management, never typed. */
export const MINISTRY_SYSTEM_COLUMNS = ["id", "sort_order", "is_active"] as const;

/** The editable text columns of a kind, with their maximum lengths. Derived, so it cannot go stale. */
export const MINISTRY_FIELDS: Record<MinistryKind, ReadonlyArray<readonly [string, number]>> = Object.fromEntries(
  MINISTRY_KINDS.map((kind) => [
    kind,
    MINISTRY_EDITOR_FIELDS[kind]
      .filter((f) => !f.choices)
      .map((f) => [f.column, f.max] as const),
  ]),
) as unknown as Record<MinistryKind, ReadonlyArray<readonly [string, number]>>;

/** The one field with no sensible blank value, per kind. Everything else may be left empty. */
const REQUIRED_FIELD: Record<MinistryKind, string> = {
  role: "name",
  milestone: "body",
  // A patron with no name is a card with nothing on it. A patron with no note is a name, which is a
  // complete thing, so `note` stays optional here.
  patron: "name",
};

export const MINISTRY_LABEL: Record<MinistryKind, string> = {
  role: "Roles at the altar",
  milestone: "Timeline",
  patron: "Patrons of servers",
};

export const MINISTRY_TABLE_LABEL: Record<MinistryKind, string> = {
  role: "ministry_roles",
  milestone: "history_milestones",
  patron: "patron_saints",
};

/**
 * One text field of a kind, validated.
 *
 * `required` decides whether the field must be present and non-empty, or may be absent.
 */
function textField(kind: MinistryKind, spec: MinistryFieldSpec, required: boolean, present: "optional" | "absent-allowed") {
  const base = z.string().trim().max(spec.max);
  const nonEmpty = base.pipe(
    z.string().min(1, `${MINISTRY_LABEL[kind]} needs ${humanColumn(kind, spec.column)}.`),
  );
  if (!required) return base.nullish();
  // A patch may leave the field out entirely; a create may not. Both refuse it empty when it *is* sent,
  // so `name: ""` cannot blank a name by the back door on an update.
  return present === "absent-allowed" ? nonEmpty.optional() : nonEmpty;
}

/** A choice field, validated against the closed list it will be drawn from. */
function choiceField(spec: MinistryFieldSpec, present: "optional" | "absent-allowed") {
  const base = z
    .string()
    .trim()
    .max(spec.max)
    .refine(isRoleIcon, "Choose one of the listed icons.");
  return present === "absent-allowed" ? base.optional() : base;
}

/**
 * The schema for creating one row of a kind.
 *
 * Built from `MINISTRY_EDITOR_FIELDS` so a new column is added in one place, and so a column that
 * validates is necessarily one the editor can reach.
 */
export function createSchema(kind: MinistryKind) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const spec of MINISTRY_EDITOR_FIELDS[kind]) {
    const required = spec.column === REQUIRED_FIELD[kind];
    shape[spec.column] = spec.choices
      ? choiceField(spec, "optional")
      : textField(kind, spec, required, "optional");
  }
  // An unrecognised icon defaults rather than being refused, so adding a row with no icon chosen works.
  // It is still checked when one *is* chosen -- the value never reaches the column unvalidated.
  if (shape.icon) shape.icon = shape.icon.default("cross");
  shape.sort_order = z.number().int().min(0).max(999).optional();
  return z.object(shape);
}

/**
 * The schema for changing one row.
 *
 * Every field optional, because a patch that must carry the whole row makes every edit a full
 * overwrite -- and overwriting a row with a stale copy is how a name silently reverts.
 */
export function patchSchema(kind: MinistryKind) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const spec of MINISTRY_EDITOR_FIELDS[kind]) {
    const required = spec.column === REQUIRED_FIELD[kind];
    shape[spec.column] = spec.choices
      ? choiceField(spec, "absent-allowed")
      : textField(kind, spec, required, "absent-allowed");
  }
  shape.sort_order = z.number().int().min(0).max(999).nullish();
  shape.is_active = z.boolean().optional();
  return z.object(shape);
}

/** "year_label" as a person would say it in a message. */
function humanColumn(_kind: MinistryKind, column: string): string {
  if (column === "year_label") return "a year";
  if (column === "body") return "something to say";
  if (column === "name") return "a name";
  return column.replace(/_/g, " ");
}

/**
 * The newest sort order in a list, so a new row lands after the last one.
 *
 * -1 when the list is empty, which makes the first row 0 rather than nothing.
 */
export function nextSortOrder(existing: ReadonlyArray<{ sort_order: number }>): number {
  return existing.reduce((max, row) => Math.max(max, row.sort_order), -1) + 1;
}

/**
 * Whether a milestone's body contains a phrase that should be italicised.
 *
 * The page cannot render emphasis from plain text, and this is not worth a markup editor for four words
 * in a paragraph nobody edits often. Matching whole phrases from a closed list keeps the prose safe --
 * there is no HTML in this column and there is no path that would let any in.
 */
export function milestonesToItalicise(body: string): string[] {
  return MILESTONE_ITALICS.filter((phrase) => body.includes(phrase));
}

/** The columns each kind is selected with. Used by both the reader and the writers. */
export const MINISTRY_COLUMNS: Record<MinistryKind, string> = {
  role: "id, name, description, icon, sort_order, is_active",
  milestone: "id, year_label, body, sort_order, is_active",
  patron: "id, name, note, sort_order, is_active",
};