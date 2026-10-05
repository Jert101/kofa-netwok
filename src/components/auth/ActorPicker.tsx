"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, UserRound, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { isApiResponse } from "@/lib/api/response";

export type ActorOption = { id: string; name: string };

type ActorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actor: ActorOption | null;
  /** Members may skip; staff get "Not now" instead. */
  skippable: boolean;
  onSelected?: (actor: ActorOption | null) => void;
};

/**
 * AUTH-4 "Who's using this device?". Self-declared only: the copy says so, and
 * nothing in the app treats it as proof of identity (D-1).
 */
export function ActorDialog({
  open,
  onOpenChange,
  actor,
  skippable,
  onSelected,
}: ActorDialogProps) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ActorOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/auth/actor/search?q=${encodeURIComponent(q)}`, {
        credentials: "same-origin",
      });
      const body: unknown = await res.json();
      if (isApiResponse<{ members: ActorOption[] }>(body) && body.ok) {
        setOptions(body.data.members);
      }
    } catch {
      setError("Can't reach the server.");
    }
  }, []);

  useEffect(() => {
    if (open) void load(query);
  }, [open, query, load]);

  async function choose(id: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/actor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ member_id: id }),
      });
      if (!res.ok) {
        const body: unknown = await res.json().catch(() => null);
        setError(
          isApiResponse(body) && !body.ok ? body.error.message : "Could not save that choice.",
        );
        return;
      }
      const selected = id === "" ? null : options.find((m) => m.id === id) ?? null;
      onOpenChange(false);
      if (onSelected) onSelected(selected);
      else router.refresh();
    } catch {
      setError("Can't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Who&apos;s using this device?</DialogTitle>
          <DialogDescription>
            This is only a note for the audit log. It does not sign you in as that person.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members"
          aria-label="Search members"
          autoFocus
        />

        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {options.length === 0 ? (
            <li className="px-2 py-6 text-center text-sm text-[var(--text-muted)]">
              No members found.
            </li>
          ) : (
            options.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void choose(m.id)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
                >
                  <Users aria-hidden className="size-4 shrink-0 text-[var(--text-muted)]" />
                  <span className="flex-1 truncate">{m.name}</span>
                  {actor?.id === m.id ? <Check aria-hidden className="size-4" /> : null}
                </button>
              </li>
            ))
          )}
        </ul>

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

        {/* Both branches need a way out. When the name is skippable the button submits "nobody"; when it
            is required it only steps aside, because the session is already valid and the caller has to
            decide where to send the user next. Leaving a dialog with no exit at all is what turned a
            wrong PIN into a dead end. */}
        <DialogFooter>
          {skippable ? (
            <Button variant="ghost" disabled={saving} onClick={() => void choose("")}>
              Skip
            </Button>
          ) : (
            <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
              Continue without a name
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Sidebar footer entry: shows the current person, or prompts for one. */
export function ActorPicker({ actor }: { actor: ActorOption | null }) {
  const [open, setOpen] = useState(false);
  const label = actor ? actor.name : "Who's using this device?";

  return (
    <>
      <SidebarMenuButton tooltip={label} className="min-h-11" onClick={() => setOpen(true)}>
        <UserRound aria-hidden />
        <span className="truncate">{label}</span>
      </SidebarMenuButton>
      <ActorDialog open={open} onOpenChange={setOpen} actor={actor} skippable />
    </>
  );
}
