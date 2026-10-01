import { CalendarDays, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { addMonths, format, startOfMonth } from "date-fns";
import { dayDot } from "@/lib/attendance/calendar-indicators";

const DOT_CLASS: Record<NonNullable<ReturnType<typeof dayDot>>, string> = {
  appeal: "bg-[var(--danger)]",
  needs_encoding: "bg-[var(--warning)]",
  recorded: "bg-[var(--success)]",
};

const DOT_TITLE: Record<NonNullable<ReturnType<typeof dayDot>>, string> = {
  appeal: "Appeals waiting",
  needs_encoding: "Needs encoding",
  recorded: "Attendance recorded",
};

export type MonthIndicator = {
  date: string;
  sessions: number;
  held: number;
  present: number;
  needs_encoding: boolean;
  pending_appeals: number;
};

export type CalendarProps = {
  month: string;
  today: string;
  locked: boolean;
  indicators: MonthIndicator[];
  /** Member and officer go to their own day view; admin and secretary share theirs. */
  buildDayHref: (date: string) => string;
  /** Month arrows. Omitted on screens where the month is fixed. */
  onMonthChange?: (month: string) => void;
  showAppeals?: boolean;
};

/**
 * ATT-3 month grid.
 *
 * Three ideas in each cell, kept to what fits on a phone: the date, a dot when anyone
 * was actually present, and a marker when something needs attention. The session count
 * is spoken rather than drawn — "3 sessions, 41 present" is a screen reader sentence,
 * where three separate glyphs would just be noise.
 *
 * The "needs encoding" dot is amber rather than red on purpose. A missed entry is
 * ordinary, not a fault, and it should not look like an error the secretary has to
 * resolve before she can leave the screen.
 */
export function MonthCalendar({
  month,
  today,
  locked,
  indicators,
  buildDayHref,
  onMonthChange,
  showAppeals = false,
}: CalendarProps) {
  const byDate = new Map(indicators.map((d) => [d.date, d]));
  const current = startOfMonth(new Date(`${month}-01T12:00:00`));
  const prevMonth = format(addMonths(current, -1), "yyyy-MM");
  const nextMonth = format(addMonths(current, 1), "yyyy-MM");

  // Built from noon rather than midnight: a local-midnight Date can land on the 30th in
  // some timezones, which would silently shift every column by one day.
  const first = new Date(current.getFullYear(), current.getMonth(), 1, 12);
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());

  const weeks: Date[] = [];
  for (let i = 0; i < 42; i += 1) {
    weeks.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i, 12));
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        {onMonthChange ? (
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMonthChange(prevMonth)}
            className="inline-flex size-11 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
        ) : (
          <span className="size-11" aria-hidden="true" />
        )}
        <p className="flex items-center gap-2 text-base font-semibold">
          <CalendarDays aria-hidden="true" className="size-4 text-[var(--muted)]" />
          {format(current, "MMMM yyyy")}
          {locked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">
              <Lock aria-hidden="true" className="size-3" />
              Closed
            </span>
          ) : null}
        </p>
        {onMonthChange ? (
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMonthChange(nextMonth)}
            className="inline-flex size-11 items-center justify-center rounded-xl text-[var(--muted)] hover:bg-[var(--surface-2)]"
          >
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
        ) : (
          <span className="size-11" aria-hidden="true" />
        )}
      </div>

      <div aria-hidden="true" className="grid grid-cols-7 gap-1 text-center text-xs text-[var(--muted)]">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <span key={d} className="py-1">
            {d.charAt(0)}
          </span>
        ))}
      </div>

      <ul className="grid grid-cols-7 gap-1">
        {weeks.map((day) => {
          const date = format(day, "yyyy-MM-dd");
          const inMonth = format(day, "yyyy-MM") === month;
          const info = byDate.get(date);
          const isToday = date === today;
          // Appeals are hidden from members and officers, so their dot is not drawn
          // either. Showing "someone is disputing a session" to a member who cannot act
          // on it is noise at best.
          const dot = info
            ? dayDot(
                { sessions: info.sessions, held: info.held },
                {
                  today,
                  date,
                  pendingAppeals: showAppeals ? info.pending_appeals : 0,
                },
              )
            : null;

          return (
            <li key={date}>
              <a
                href={inMonth ? buildDayHref(date) : undefined}
                aria-current={isToday ? "date" : undefined}
                className={[
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border p-1 text-sm",
                  inMonth ? "border-[var(--border)] bg-[var(--surface)]" : "border-transparent",
                  isToday ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "",
                  inMonth ? "hover:bg-[var(--surface-2)]" : "pointer-events-none opacity-40",
                ].join(" ")}
              >
                <span className={isToday ? "font-bold text-[var(--accent)]" : "font-medium"}>
                  {day.getDate()}
                </span>
                {inMonth && info ? (
                  <span className="flex items-center gap-1">
                    {dot ? (
                      <span
                        aria-hidden="true"
                        title={DOT_TITLE[dot]}
                        className={`size-1.5 rounded-full ${DOT_CLASS[dot]}`}
                      />
                    ) : null}
                    {locked ? (
                      <Lock aria-hidden="true" className="size-2.5 text-[var(--muted)]" />
                    ) : null}
                  </span>
                ) : null}
                {inMonth && info ? (
                  <span className="sr-only">
                    {info.sessions} session{info.sessions === 1 ? "" : "s"},{" "}
                    {info.present} present
                    {info.needs_encoding ? ", needs encoding" : ""}
                    {showAppeals && info.pending_appeals > 0
                      ? `, ${info.pending_appeals} appeal waiting`
                      : ""}
                    {locked ? ", month closed" : ""}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
