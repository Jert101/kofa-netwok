"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";

/**
 * Route-segment validation for the day and session screens.
 *
 * These pages used to check their own params and call `router.replace` from the render body, which is a
 * navigation performed as a side effect of rendering: React can re-run it, and it returned `null` on the
 * way out, so a mistyped URL produced a blank content area with no explanation. The session pages were
 * worse -- they interpolated `params.id` straight into a fetch URL and built a "back" link out of
 * whatever `params.date` happened to contain.
 *
 * Validating once, here, means every screen agrees on what a usable segment is and answers a bad URL
 * the same way: say what is wrong, offer the way back.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shape *and* calendar: `2026-02-31` parses in the regex sense but is not a day that exists. */
export function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

function segment(params: ReturnType<typeof useParams>, key: string): string {
  const raw = params?.[key];
  return Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? "");
}

/** The `[date]` segment, or `null` when it is not a real calendar date. */
export function useDayParam(): string | null {
  const params = useParams();
  return useMemo(() => {
    const value = segment(params, "date");
    return isRealIsoDate(value) ? value : null;
  }, [params]);
}

/** The `[id]` segment, or `null` when it is not a uuid. */
export function useSessionIdParam(): string | null {
  const params = useParams();
  return useMemo(() => {
    const value = segment(params, "id");
    return isUuid(value) ? value : null;
  }, [params]);
}

/** Shown instead of a screen whose URL segment made no sense. */
export function BadRouteParamNotice({
  what,
  homeHref,
  homeLabel,
}: {
  what: string;
  homeHref: string;
  homeLabel: string;
}) {
  return (
    <div role="alert" className="rounded-2xl border border-dashed border-[var(--border)] p-6 text-center">
      <h1 className="text-lg font-semibold">That link is not valid</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--text-muted)]">
        The {what} in the address is not something this page can open. It may have been shortened or
        mistyped.
      </p>
      <Button asChild variant="outline" className="mt-4 min-h-11">
        <Link href={homeHref}>{homeLabel}</Link>
      </Button>
    </div>
  );
}