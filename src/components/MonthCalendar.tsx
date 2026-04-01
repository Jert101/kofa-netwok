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
};

export function MonthCalendar({ month, onMonthChange, onSelectDate }: Props) {
  const start = startOfWeek(startOfMonth(month), { weekStartsOn: 0 });
  const end = endOfWeek(endOfMonth(month), { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start, end });
  const labels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

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
          return (
            <button
              key={ymd}
              type="button"
              onClick={() => onSelectDate(ymd)}
              className={
                "min-h-11 rounded-xl text-sm font-medium transition active:scale-[0.97] sm:min-h-12 " +
                (outside
                  ? "text-[var(--muted)] opacity-50"
                  : "bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--accent-soft)]")
              }
            >
              {format(d, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
