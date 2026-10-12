import type { Metadata } from "next";
import { FreedomWall } from "@/features/freedom-wall/ui/FreedomWall";

export const metadata: Metadata = { title: "Freedom Wall | KofA AMS" };

export default function OfficerFreedomWallPage() {
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
