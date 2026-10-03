import { describe, expect, it } from "vitest";
import {
  assigneeLabel,
  insertRow,
  isDirty,
  isRealRow,
  moveEditorRow,
  newRow,
  removeRow,
  rowPositionLabel,
  rowsFromServer,
  toSlots,
  trimmedFreeText,
  updateRow,
  withGuest,
  withMember,
  withNoAssignee,
  type EditorRow,
} from "./editor-rows";

function row(over: Partial<EditorRow> & { id: string }): EditorRow {
  return {
    position_label: "",
    member_id: null,
    member_name: null,
    free_text: null,
    assignee: "empty",
    ...over,
  };
}

// ======================================================================================
// Seeding from the server
// ======================================================================================

describe("rowsFromServer", () => {
  it("marks a row with a member as using the member picker", () => {
    const out = rowsFromServer([
      { position_label: "Crucifix", member_id: "u1", free_text: null },
    ]);
    expect(out[0].assignee).toBe("member");
    expect(out[0].member_id).toBe("u1");
  });

  it("marks a row with free text as using the guest picker", () => {
    const out = rowsFromServer([
      { position_label: "Crucifix", member_id: null, free_text: "Visitor" },
    ]);
    expect(out[0].assignee).toBe("guest");
  });

  it("marks an unfilled position as empty rather than guest", () => {
    const out = rowsFromServer([
      { position_label: "Crucifix", member_id: null, free_text: null },
    ]);
    expect(out[0].assignee).toBe("empty");
  });

  it("prefers the member when a row somehow carries both", () => {
    const out = rowsFromServer([
      { position_label: "Crucifix", member_id: "u1", free_text: "Visitor" },
    ]);
    expect(out[0].assignee).toBe("member");
  });

  it("gives every row a distinct id", () => {
    const out = rowsFromServer([
      { position_label: "A", member_id: null, free_text: null },
      { position_label: "B", member_id: null, free_text: null },
    ]);
    expect(new Set(out.map((r) => r.id)).size).toBe(2);
  });
});

// ======================================================================================
// What counts as a row
// ======================================================================================

describe("isRealRow", () => {
  it("accepts a position with nobody in it", () => {
    // The whole point: an unfilled position is something the officer means.
    expect(isRealRow(row({ id: "a", position_label: "Crucifix" }))).toBe(true);
  });

  it("rejects a position that is only whitespace", () => {
    expect(isRealRow(row({ id: "a", position_label: "   " }))).toBe(false);
  });

  it("rejects a row with no position", () => {
    expect(isRealRow(row({ id: "a" }))).toBe(false);
  });

  it("accepts a guest-only row once it has a position", () => {
    expect(isRealRow(row({ id: "a", position_label: "Crucifix", assignee: "guest", free_text: "V" }))).toBe(true);
  });
});

describe("toSlots", () => {
  it("drops rows with no position", () => {
    const out = toSlots([
      row({ id: "a", position_label: "Crucifix" }),
      row({ id: "b", position_label: "  " }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("keeps an unassigned position with a null member", () => {
    const out = toSlots([row({ id: "a", position_label: "Crucifix" })]);
    expect(out[0]).toEqual({ position_label: "Crucifix", member_id: null, free_text: null });
  });

  it("preserves order", () => {
    const out = toSlots([
      row({ id: "a", position_label: "Crucifix" }),
      row({ id: "b", position_label: "Thurifer" }),
    ]);
    expect(out.map((s) => s.position_label)).toEqual(["Crucifix", "Thurifer"]);
  });

  it("collapses whitespace in the label", () => {
    expect(toSlots([row({ id: "a", position_label: "  Candle   1 " })])[0].position_label).toBe("Candle 1");
  });

  it("sends the member id only in member mode", () => {
    const out = toSlots([
      row({ id: "a", position_label: "A", assignee: "member", member_id: "u1" }),
    ]);
    expect(out[0].member_id).toBe("u1");
  });

  it("sends free text only in guest mode", () => {
    const out = toSlots([
      row({ id: "a", position_label: "A", assignee: "guest", free_text: "Visitor" }),
    ]);
    expect(out[0].free_text).toBe("Visitor");
  });

  it("never sends a member and a guest name together", () => {
    // The row shape allows both to be present; the payload must not, or the server has to guess.
    const out = toSlots([
      row({ id: "a", position_label: "A", assignee: "member", member_id: "u1", free_text: "Visitor" }),
    ]);
    expect(out[0].member_id).toBe("u1");
    expect(out[0].free_text).toBeNull();
  });

  it("trims free text and sends null when it is only spaces", () => {
    const out = toSlots([
      row({ id: "a", position_label: "A", assignee: "guest", free_text: "  Visitor  " }),
      row({ id: "b", position_label: "B", assignee: "guest", free_text: "   " }),
    ]);
    expect(out[0].free_text).toBe("Visitor");
    expect(out[1].free_text).toBeNull();
  });

  it("returns an empty list for no rows, which is a valid clear", () => {
    expect(toSlots([])).toEqual([]);
  });
});

// ======================================================================================
// Dirty tracking — the leave guard
// ======================================================================================

describe("isDirty", () => {
  const base = [row({ id: "a", position_label: "Crucifix", assignee: "member", member_id: "u1", member_name: "Reyes" })];

  it("is false for the list it was seeded from", () => {
    expect(isDirty(base, base)).toBe(false);
  });

  it("is false for an equal list that is a different array", () => {
    expect(isDirty([...base], base)).toBe(false);
  });

  it("is false when a label is retyped identically including trailing space", () => {
    // The point of comparing values: nagging about no-op whitespace trains people to ignore it.
    const now = [row({ id: "a", position_label: "Crucifix ", assignee: "member", member_id: "u1", member_name: "Reyes" })];
    expect(isDirty(now, base)).toBe(false);
  });

  it("is false when only the member's cached name changed", () => {
    const now = [row({ id: "a", position_label: "Crucifix", assignee: "member", member_id: "u1", member_name: "Someone Else" })];
    expect(isDirty(now, base)).toBe(false);
  });

  it("is true when a label changed", () => {
    const now = [row({ id: "a", position_label: "Crucifix 2", assignee: "member", member_id: "u1", member_name: "Reyes" })];
    expect(isDirty(now, base)).toBe(true);
  });

  it("is true when a row was added", () => {
    expect(isDirty([...base, row({ id: "b", position_label: "Thurifer" })], base)).toBe(true);
  });

  it("is true when a row was removed", () => {
    expect(isDirty([], base)).toBe(true);
  });

  it("is true when rows were reordered", () => {
    const a = row({ id: "a", position_label: "Crucifix" });
    const b = row({ id: "b", position_label: "Thurifer" });
    expect(isDirty([b, a], [a, b])).toBe(true);
  });

  it("is true when a member was assigned", () => {
    expect(isDirty([row({ id: "a", position_label: "Crucifix" })], [row({ id: "a", position_label: "Crucifix", assignee: "member", member_id: "u1" })])).toBe(true);
  });

  it("is true when an assignee was cleared", () => {
    const cleared = withNoAssignee(base[0]);
    expect(isDirty([cleared], base)).toBe(true);
  });
});

// ======================================================================================
// Row editing
// ======================================================================================

describe("withMember", () => {
  it("sets the member and its display name", () => {
    const out = withMember(row({ id: "a", position_label: "Crucifix" }), { id: "u1", name: "Reyes, Ben" });
    expect(out.assignee).toBe("member");
    expect(out.member_name).toBe("Reyes, Ben");
  });

  it("drops any guest name", () => {
    const out = withMember(row({ id: "a", assignee: "guest", free_text: "Visitor" }), { id: "u1", name: "R" });
    expect(out.free_text).toBeNull();
  });
});

describe("withGuest", () => {
  it("keeps the typed name", () => {
    const out = withGuest(row({ id: "a", position_label: "Crucifix" }), "Visitor");
    expect(out.assignee).toBe("guest");
    expect(out.free_text).toBe("Visitor");
  });

  it("drops the member", () => {
    const out = withGuest(row({ id: "a", assignee: "member", member_id: "u1", member_name: "R" }), "Visitor");
    expect(out.member_id).toBeNull();
    expect(out.member_name).toBeNull();
  });

  it("does not trim yet, so the officer can keep typing", () => {
    expect(withGuest(row({ id: "a" }), "  ").free_text).toBe("  ");
  });
});

describe("withNoAssignee", () => {
  it("keeps the position", () => {
    const out = withNoAssignee(row({ id: "a", position_label: "Crucifix", assignee: "member", member_id: "u1" }));
    expect(out.position_label).toBe("Crucifix");
    expect(out.assignee).toBe("empty");
  });
});

describe("assigneeLabel", () => {
  it("reads the member's cached name", () => {
    expect(assigneeLabel(row({ id: "a", assignee: "member", member_id: "u1", member_name: "Reyes" }))).toBe("Reyes");
  });

  it("falls back to the id when no name was cached", () => {
    expect(assigneeLabel(row({ id: "a", assignee: "member", member_id: "u1" }))).toBe("u1");
  });

  it("reads the guest name", () => {
    expect(assigneeLabel(row({ id: "a", assignee: "guest", free_text: "Visitor" }))).toBe("Visitor");
  });

  it("is empty for an unassigned position", () => {
    expect(assigneeLabel(row({ id: "a", position_label: "Crucifix" }))).toBe("");
  });

  it("is empty for a guest name of only spaces", () => {
    expect(assigneeLabel(row({ id: "a", assignee: "guest", free_text: "  " }))).toBe("");
  });
});

// ======================================================================================
// List operations
// ======================================================================================

describe("moveEditorRow", () => {
  const list = [
    row({ id: "a", position_label: "A" }),
    row({ id: "b", position_label: "B" }),
    row({ id: "c", position_label: "C" }),
  ];

  it("moves a row down", () => {
    expect(moveEditorRow(list, 0, 2).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("moves a row up", () => {
    expect(moveEditorRow(list, 2, 0).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps the row object identity", () => {
    const moved = moveEditorRow(list, 0, 2);
    expect(moved[2]).toBe(list[0]);
  });

  it("returns the same list when the target is out of range", () => {
    expect(moveEditorRow(list, 0, 9)).toBe(list);
  });

  it("returns the same list for a no-op move", () => {
    expect(moveEditorRow(list, 1, 1)).toBe(list);
  });

  it("does not mutate the input", () => {
    const before = list.map((r) => r.id);
    moveEditorRow(list, 0, 2);
    expect(list.map((r) => r.id)).toEqual(before);
  });
});

describe("updateRow", () => {
  it("patches by id, not position", () => {
    const list = [row({ id: "a", position_label: "A" }), row({ id: "b", position_label: "B" })];
    const out = updateRow(list, "b", { position_label: "B2" });
    expect(out.map((r) => r.position_label)).toEqual(["A", "B2"]);
  });

  it("leaves the list alone for an unknown id", () => {
    const list = [row({ id: "a", position_label: "A" })];
    expect(updateRow(list, "zz", { position_label: "Z" })).toEqual(list);
  });
});

describe("insertRow", () => {
  it("inserts after the given row", () => {
    const list = [row({ id: "a" }), row({ id: "c" })];
    expect(insertRow(list, "a", row({ id: "b" })).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("appends when the anchor is missing", () => {
    const list = [row({ id: "a" })];
    expect(insertRow(list, "zz", row({ id: "b" })).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("appends for a null anchor", () => {
    expect(insertRow([], null, row({ id: "b" })).map((r) => r.id)).toEqual(["b"]);
  });
});

describe("removeRow", () => {
  it("removes by id", () => {
    const list = [row({ id: "a" }), row({ id: "b" })];
    expect(removeRow(list, "a").map((r) => r.id)).toEqual(["b"]);
  });

  it("is a no-op for an unknown id", () => {
    const list = [row({ id: "a" })];
    expect(removeRow(list, "zz")).toEqual(list);
  });
});

// ======================================================================================
// Small helpers
// ======================================================================================

describe("newRow", () => {
  it("starts empty", () => {
    const r = newRow("x");
    expect(isRealRow(r)).toBe(false);
    expect(r.assignee).toBe("empty");
  });
});

describe("rowPositionLabel", () => {
  it("trims and collapses", () => {
    expect(rowPositionLabel(row({ id: "a", position_label: "  Candle   1 " }))).toBe("Candle 1");
  });
});

describe("trimmedFreeText", () => {
  it("returns null for blank", () => {
    expect(trimmedFreeText("   ")).toBeNull();
    expect(trimmedFreeText(null)).toBeNull();
  });

  it("trims real text", () => {
    expect(trimmedFreeText("  Visitor ")).toBe("Visitor");
  });
});
