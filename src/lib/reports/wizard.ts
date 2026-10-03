/** RPT-2: session checklist selection, "low turnout" labelling and attendance counts. */

export type WizardSession = {
  id: string;
  session_date: string;
  weekday_label: string;
  mass_name: string;
  /** Present once the server has supplied counts; absent means "not yet counted". */
  attendance_count?: number | null;
};

export type WizardSelection = {
  selectedIds: string[];
  /** Median attendance across the month's listed sessions. */
  medianAttendance: number;
  /** Sessions below half the median. */
  lowTurnoutIds: Set<string>;
  totalAttendance: number;
};

/**
 * Median, not mean.
 *
 * A single very well attended day skews a mean enough to push the "low turnout" line above
 * sessions that are genuinely thin. The median describes the typical session, which is what
 * "this one looks unusually quiet compared to the rest of the month" means to a secretary.
 */
export function medianAttendance(sessions: WizardSession[]): number {
  const counts = sessions
    .map((s) => s.attendance_count)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    .sort((a, b) => a - b);
  if (counts.length === 0) return 0;
  const mid = Math.floor(counts.length / 2);
  // Even length: average the two middle values so the threshold is not pulled to one day.
  return counts.length % 2 === 0 ? (counts[mid - 1] + counts[mid]) / 2 : counts[mid];
}

/**
 * Sessions at or below half the median.
 *
 * `>=` on the threshold keeps an exactly-half session flagged: at half the median it is tied
 * for quietest, and the label exists to draw attention, not to rank.
 */
export function selectLowTurnout(sessions: WizardSession[]): Set<string> {
  const med = medianAttendance(sessions);
  if (med <= 0) return new Set();

  const out = new Set<string>();
  for (const s of sessions) {
    const n = s.attendance_count;
    if (typeof n === "number" && Number.isFinite(n) && n <= med / 2) out.add(s.id);
  }
  return out;
}

/** RPT-2 step 2 requires at least one session; empty selection blocks Generate. */
export function canProceedFromSessions(selectedCount: number): boolean {
  return selectedCount > 0;
}

export function computeSelection(sessions: WizardSession[], selectedIds: string[]): WizardSelection {
  const chosen = new Set(selectedIds);
  const included = sessions.filter((s) => chosen.has(s.id));
  return {
    selectedIds: included.map((s) => s.id),
    medianAttendance: medianAttendance(sessions),
    lowTurnoutIds: selectLowTurnout(sessions),
    totalAttendance: included.reduce(
      (sum, s) => sum + (typeof s.attendance_count === "number" ? s.attendance_count : 0),
      0,
    ),
  };
}

/**
 * RPT-2 step 3 warnings.
 *
 * Both are advisory. The grid is what gets generated regardless, so neither blocks the
 * Generate button — they exist so a secretary can notice unreviewed appeals or members who
 * would drop off the report before it is frozen.
 */
export type PreviewWarnings = {
  pendingAppeals: number;
  zeroAttendanceMembers: number;
  messages: string[];
};

export function buildPreviewWarnings(input: {
  pendingAppeals: number;
  zeroAttendanceMembers: number;
  selectedSessions: number;
}): PreviewWarnings {
  const messages: string[] = [];

  if (input.pendingAppeals > 0) {
    messages.push(
      `${input.pendingAppeals} appeal${input.pendingAppeals === 1 ? " is" : "s are"} still pending for this month.`,
    );
  }
  if (input.zeroAttendanceMembers > 0) {
    messages.push(
      `${input.zeroAttendanceMembers} active member${input.zeroAttendanceMembers === 1 ? " has" : "s have"} no attendance in the selected sessions.`,
    );
  }

  return {
    pendingAppeals: input.pendingAppeals,
    zeroAttendanceMembers: input.zeroAttendanceMembers,
    messages,
  };
}

/** Step 4 summary: what is about to be generated. */
export function summarizeConfirm(input: {
  monthLabel: string;
  selectedCount: number;
  totalSessionsInMonth: number;
  archiveAfterGenerate: boolean;
}): string[] {
  const lines = [
    `Month: ${input.monthLabel}`,
    `${input.selectedCount} of ${input.totalSessionsInMonth} Mass${
      input.totalSessionsInMonth === 1 ? "" : "es"
    } included as columns`,
  ];
  lines.push(
    input.archiveAfterGenerate
      ? "Attendance for this month will be moved to the archive."
      : "Live attendance stays in the app until you archive from Past reports.",
  );
  return lines;
}

/** Toggling one id, returning a new array. Used so the checkbox list has no state logic. */
export function toggleId(selectedIds: string[], id: string): string[] {
  return selectedIds.includes(id)
    ? selectedIds.filter((x) => x !== id)
    : [...selectedIds, id];
}