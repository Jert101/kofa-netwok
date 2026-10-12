import type { Metadata } from "next";
import { FreedomWall } from "@/features/freedom-wall/ui/FreedomWall";

export const metadata: Metadata = { title: "Freedom Wall | KofA AMS" };

/**
 * The member's Freedom Wall.
 *
 * A page of its own rather than a card on the dashboard: a post is something
 * people come back to read, and the dashboard is a thing they glance at once.
 */
export default function MemberFreedomWallPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Freedom Wall</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          A place to say anything about the ministry. What you write here is shown without your name.
        </p>
      </header>

      <FreedomWall />
    </div>
  );
}
