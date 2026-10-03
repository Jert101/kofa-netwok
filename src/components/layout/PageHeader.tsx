import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export function PageHeader({
  title,
  description,
  backHref,
  backLabel = "Back",
  actions,
}: {
  title: string;
  description?: string;
  backHref?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      {backHref ? (
        <Link
          href={backHref}
          className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--brand)]"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {backLabel}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--text)] sm:text-2xl">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
