import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]",
  success: "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]",
  warning: "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]",
  danger: "border-[var(--danger)] bg-[var(--danger)] text-white",
  info: "border-[var(--border)] bg-[var(--surface)] text-[var(--brand)]",
};

export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
