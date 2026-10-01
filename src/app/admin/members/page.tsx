"use client";

import { useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BatchesPanel } from "@/features/members/ui/BatchesPanel";
import { ImportMembersDialog } from "@/features/members/ui/ImportMembersDialog";
import { MemberDirectory } from "@/features/members/ui/MemberDirectory";

type Tab = "members" | "batches";

export default function AdminMembersPage() {
  const [tab, setTab] = useState<Tab>("members");
  // A member is remounted rather than refetched, so batches changing and a member
  // being imported both need a bump to make the change show up.
  const [membersVersion, setMembersVersion] = useState(0);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Members"
          className="flex gap-1 border-b border-[var(--border)]"
        >
          {(
            [
              { key: "members", label: "Members" },
              { key: "batches", label: "Batches" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px min-h-11 border-b-2 px-4 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "members" ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Upload aria-hidden /> Import from file
          </Button>
        ) : null}
      </div>

      {tab === "members" ? (
        <MemberDirectory key={membersVersion} />
      ) : (
        <BatchesPanel onChanged={() => setMembersVersion((v) => v + 1)} />
      )}

      <ImportMembersDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => setMembersVersion((v) => v + 1)}
      />
    </div>
  );
}
