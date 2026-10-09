import type { Metadata } from "next";
import { ChurchEditor } from "@/components/church/ChurchEditor";

export const metadata: Metadata = { title: "Parish — Super Admin" };

/**
 * Where the landing page's content is written.
 *
 * Super admin only, because the middleware's `ROLE_REACH` already keeps the admin out of
 * `/super-admin` — the report-approval gate, and this page sits behind the same door. What it publishes is
 * named, permanent and visible to strangers, so it belongs with the role that owns the record rather than
 * with the admin who oversees the sacristy.
 */
export default function SuperAdminChurchPage() {
  return (
    <div className="space-y-6 pb-10">
      <header>
        <h1 className="text-lg font-semibold sm:text-xl">Parish</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          What the public landing page says about the parish: who leads it, the ministry&apos;s
          background, and the council. Everything here is visible to anyone who opens the front page, so
          nothing that should not be published belongs in these fields.
        </p>
      </header>

      <ChurchEditor />
    </div>
  );
}