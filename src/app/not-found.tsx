import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found · KofA AMS" };

/**
 * Rendered for any path no route claims.
 *
 * This only ever appears for URLs that genuinely do not exist. Middleware used to redirect unknown
 * paths to `/login`, which made a mistyped link and a stale bookmark look identical to being signed
 * out, and answered a "does this page exist" question with a 200. The middleware now hands unmatched
 * paths straight to Next.js so this file can say what actually happened.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="font-mono text-sm text-[var(--text-muted)]">404</p>
      <h1 className="text-xl font-semibold">That page isn&apos;t here</h1>
      <p className="text-sm text-[var(--text-muted)]">
        The link may be out of date, or the address may have a typo in it. Nothing is wrong with your
        account.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/">Go to the start</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}