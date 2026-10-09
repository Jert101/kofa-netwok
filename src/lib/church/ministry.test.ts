import { describe, expect, it } from "vitest";

import {
  MINISTRY_COLUMNS,
  MINISTRY_EDITOR_FIELDS,
  MINISTRY_FIELDS,
  MINISTRY_KINDS,
  MINISTRY_SYSTEM_COLUMNS,
  MINISTRY_TABLE,
  createSchema,
  isMinistryKind,
  isRoleIcon,
  milestonesToItalicise,
  nextSortOrder,
  patchSchema,
} from "./ministry";

describe("the kinds", () => {
  it("gives every validated column an editor field, so nothing is validated but uneditable", () => {
    // The council's `photo_url` was patchable and absent from its schema, and a column that validates
    // but has no field is a column the super admin cannot reach. This is the check that catches it --
    // and it did: the role's `icon` was validated by the schema and declared nowhere else.
    for (const kind of MINISTRY_KINDS) {
      const editable = MINISTRY_EDITOR_FIELDS[kind].map((f) => f.column);
      const selected = MINISTRY_COLUMNS[kind]
        .split(",")
        .map((c) => c.trim())
        .filter((c) => !(MINISTRY_SYSTEM_COLUMNS as readonly string[]).includes(c));
      // Every editable column is written by a save, and every one is read back.
      for (const column of editable) {
        expect(selected, `${kind}.${column}`).toContain(column);
      }
      // And nothing is read back that cannot be edited from here.
      for (const column of selected) {
        expect(editable, `${kind}.${column}`).toContain(column);
      }
    }
  });

  it("keeps every list's system columns to the same three, so no table grows a secret field", () => {
    for (const kind of MINISTRY_KINDS) {
      const present = MINISTRY_COLUMNS[kind]
        .split(",")
        .map((c) => c.trim())
        .filter((c) => (MINISTRY_SYSTEM_COLUMNS as readonly string[]).includes(c));
      expect(present.sort(), kind).toEqual([...MINISTRY_SYSTEM_COLUMNS].sort());
    }
  });

  it("only offers icons it can draw, on the only kind that picks one", () => {
    const iconField = MINISTRY_EDITOR_FIELDS.role.find((f) => f.column === "icon");
    expect(iconField?.choices).toBeDefined();
    for (const choice of iconField?.choices ?? []) expect(isRoleIcon(choice)).toBe(true);
    for (const kind of ["milestone", "patron"] as const) {
      for (const f of MINISTRY_EDITOR_FIELDS[kind]) expect(f.choices).toBeUndefined();
    }
  });

  it("gives every editor field a label, so none renders as an unlabelled box", () => {
    for (const kind of MINISTRY_KINDS) {
      for (const f of MINISTRY_EDITOR_FIELDS[kind]) {
        expect(f.label.trim(), `${kind}.${f.column}`).not.toBe("");
      }
    }
  });

  it("covers exactly the three lists, and names each one's table", () => {
    expect([...MINISTRY_KINDS]).toEqual(["role", "milestone", "patron"]);
    // A kind with no table would build a query against "undefined", which fails at runtime and not at
    // compile time -- the URL is a parameter, so the type system never sees the column name.
    for (const kind of MINISTRY_KINDS) expect(MINISTRY_TABLE[kind]).toMatch(/^[a-z_]+$/);
  });

  it("recognises its own kinds and nothing else", () => {
    expect(isMinistryKind("role")).toBe(true);
    expect(isMinistryKind("patron")).toBe(true);
    expect(isMinistryKind("council")).toBe(false);
    expect(isMinistryKind("../users")).toBe(false);
    expect(isMinistryKind(null)).toBe(false);
    expect(isMinistryKind(7)).toBe(false);
  });
});

describe("role icons", () => {
  it("refuses a key it cannot draw", () => {
    // An unrecognised icon renders as nothing at all, silently, so it is caught at the door instead.
    expect(isRoleIcon("cross")).toBe(true);
    expect(isRoleIcon("bell")).toBe(true);
    expect(isRoleIcon("totally-made-up")).toBe(false);
    expect(isRoleIcon("")).toBe(false);
  });

  it("is rejected by the create schema rather than stored", () => {
    const bad = createSchema("role").safeParse({ name: "Bell ringer", icon: "evil" });
    expect(bad.success).toBe(false);
  });

  it("defaults to a cross rather than leaving a role unlabelled", () => {
    const parsed = createSchema("role").parse({ name: "Crucifer" });
    expect(parsed.icon).toBe("cross");
  });
});

describe("createSchema", () => {
  it("insists on the one field with no blank value", () => {
    // A role with no name and a patron with no name are cards with nothing on them.
    expect(createSchema("role").safeParse({ name: "  " }).success).toBe(false);
    expect(createSchema("patron").safeParse({ name: "" }).success).toBe(false);
  });

  it("requires a milestone to say something, but not to have a year", () => {
    // "c. 251" and "1962-65" are both real, and neither is a timestamp. The year is display text.
    expect(createSchema("milestone").safeParse({ body: "Something happened." }).success).toBe(true);
    expect(createSchema("milestone").safeParse({ year_label: "1570" }).success).toBe(false);
  });

  it("accepts a patron with a name and no note", () => {
    const parsed = createSchema("patron").parse({ name: "St. Tarcisius" });
    expect(parsed.name).toBe("St. Tarcisius");
  });

  it("rejects text past the length each column was given", () => {
    for (const [kind, fields] of Object.entries(MINISTRY_FIELDS)) {
      for (const [column, max] of fields) {
        const parsed = createSchema(kind as keyof typeof MINISTRY_FIELDS).safeParse({
          name: "x",
          body: "x",
          year_label: "x",
          [column]: "y".repeat(max + 1),
        });
        expect(parsed.success, `${kind}.${column}`).toBe(false);
      }
    }
  });
});

describe("patchSchema", () => {
  it("accepts a partial change, because a patch that must carry the whole row overwrites", () => {
    // This is the one that caused the council photo bug: a patch of a single stripped field became an
    // empty patch, which was then refused as "nothing to change".
    const parsed = patchSchema("role").parse({ description: "Carries the cross." });
    expect(Object.keys(parsed)).toEqual(["description"]);
  });

  it("still refuses to blank the required field", () => {
    expect(patchSchema("role").safeParse({ name: "" }).success).toBe(false);
    expect(patchSchema("milestone").safeParse({ body: "" }).success).toBe(false);
  });

  it("accepts a blank optional field, which is how it is cleared", () => {
    // An empty string becomes null in the writer. This is how a patron's note is removed.
    expect(patchSchema("patron").safeParse({ note: "" }).success).toBe(true);
    expect(patchSchema("role").safeParse({ description: "" }).success).toBe(true);
  });
});

describe("nextSortOrder", () => {
  it("starts at zero for an empty list rather than at nothing", () => {
    expect(nextSortOrder([])).toBe(0);
  });

  it("lands after the last row, not after the highest number seen", () => {
    // Order is edited by hand and will not stay dense. After the last *row* is what a person means.
    expect(nextSortOrder([{ sort_order: 0 }, { sort_order: 1 }, { sort_order: 2 }])).toBe(3);
  });

  it("handles a list whose order was renumbered", () => {
    expect(nextSortOrder([{ sort_order: 5 }, { sort_order: 2 }, { sort_order: 9 }])).toBe(10);
  });
});

describe("milestonesToItalicise", () => {
  it("finds the two document titles", () => {
    expect(milestonesToItalicise("Ministeria Quaedam establishes lector and acolyte.")).toEqual([
      "Ministeria Quaedam",
    ]);
    expect(milestonesToItalicise("Spiritus Domini opens the ministries.")).toEqual(["Spiritus Domini"]);
  });

  it("finds nothing in ordinary prose", () => {
    expect(milestonesToItalicise("Canon 230 allows lay persons to serve.")).toEqual([]);
  });

  it("returns only phrases that are actually present", () => {
    // The point is that the caller can split on exactly these and nothing else.
    const found = milestonesToItalicise("From Ministeria Quaedam to Spiritus Domini, and back.");
    expect(found).toEqual(["Ministeria Quaedam", "Spiritus Domini"]);
  });
});