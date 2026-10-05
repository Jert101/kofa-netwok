"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Last stop inside the app shell: anything a server component or a page render throws lands here
 * instead of Next's bare "Application error: a client-side exception has occurred".
 *
 * This deliberately does not print `error.message`. A render failure is frequently a database error
 * and the stack is not something to put in front of a parish volunteer; the digest stays in the
 * server log, where it belongs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Kept so the failure is at least traceable from the browser console during support calls.
    console.error("[app] render failed", error.digest ?? error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong on this page</h1>
      <p className="text-sm text-[var(--text-muted)]">
        This is a fault in the app, not something you did. Trying again often clears it.
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-[var(--text-muted)]">Reference: {error.digest}</p>
      ) : null}
      <Button type="button" onClick={reset}>
        <RotateCcw aria-hidden className="size-4" />
        Try again
      </Button>
    </main>
  );
}