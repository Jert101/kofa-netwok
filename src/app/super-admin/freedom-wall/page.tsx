import type { Metadata } from "next";
import { FreedomWallModeration } from "@/features/freedom-wall/ui/FreedomWall";

export const metadata: Metadata = { title: "Freedom Wall | KofA AMS" };

/**
 * The super admin's side of the wall.
 *
 * This page is where the anonymity has an exception in it, so it is worth
 * saying plainly what that exception is: one role, read-only with respect to
 * identity, able to hide or remove. Nothing here can turn the wall back into a
 * named feed for everybody else -- the public payload has no author field to
 * fill in.
 */
export default function SuperAdminFreedomWallPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Freedom Wall</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Moderation view. You are the only role that sees who wrote a post.
        </p>
      </header>

      <FreedomWallModeration />
    </div>
  );
}
