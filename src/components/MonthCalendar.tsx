"use client";

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";

type Props = {
  month: Date;
  onMonthChange: (d: Date) => void;
  onSelectDate: (ymd: string) => void;
  indicatorDates?: string[];
  indicatorClassName?: string;
};

export function MonthCalendar({
  month,
  onMonthChange,
  onSelectDate,
  indicatorDates = [],
  indicatorClassName = "bg-[var(--accent)]",
}: Props) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start, end });
  const labels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const indicatorSet = new Set(indicatorDates);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-sm sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-xl bg-[var(--surface-2)] text-lg font-medium text-[var(--accent)]"
          onClick={() => onMonthChange(addMonths(month, -1))}
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-base font-semibold">{format(month, "MMMM yyyy")}</span>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-xl bg-[var(--surface-2)] text-lg font-medium text-[var(--accent)]"
          onClick={() => onMonthChange(addMonths(month, 1))}
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-[var(--muted)]">
        {labels.map((l) => (
          <div key={l} className="py-2">
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const ymd = format(d, "yyyy-MM-dd");
          const outside = !isSameMonth(d, month);
          const hasIndicator = !outside && indicatorSet.has(ymd);
          return (
            <button
              key={ymd}
              type="button"
              onClick={() => onSelectDate(ymd)}
              className={
                "relative min-h-11 rounded-xl text-sm font-medium transition active:scale-[0.97] sm:min-h-12 " +
                (outside
                  ? "text-[var(--muted)] opacity-50"
                  : "bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--accent-soft)]")
              }
            >
              <span>{format(d, "d")}</span>
              {hasIndicator ? (
                <span
                  className={`absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${indicatorClassName}`}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
