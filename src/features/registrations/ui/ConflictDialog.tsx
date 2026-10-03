"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isApiResponse } from "@/lib/api/response";

type Match = { id: string; full_name: string };

export type ConflictDialogProps = {
  open: boolean;
  message: string;
  memberName: string;
  /** The member the name is already taken by. Null when the id could not be read. */
  conflictMemberId?: string | null;
  onOpenChange: (open: boolean) => void;
  onEditName: () => void;
  onRejectAsDuplicate: () => void;
  /**
   * Called with the chosen member id once the application has been approved by
   * being linked. Omitted only where linking is not offered.
   */
  onLink?: (memberId: string) => Promise<void> | void;
};

/**
 * REG-6: approval stopped because an active member already holds the name.
 * Nothing was inserted. The admin picks which of the three ways out is true.
 */
export function ConflictDialog({
  open,
  message,
  memberName,
  conflictMemberId,
  onOpenChange,
  onEditName,
  onRejectAsDuplicate,
  onLink,
}: ConflictDialogProps) {
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [chosen, setChosen] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The member the conflict names is not looked up again when the dialog opens;
  // the name came with the conflict. The search exists so an admin who does not
  // agree can pick a different member.
  useEffect(() => {
    if (!open) {
      setMatches(null);
      setChosen("");
      setError(null);
      setBusy(false);
      return;
    }
    setChosen(conflictMemberId ?? "");

    if (!onLink) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/members/search?q=${encodeURIComponent(memberName)}&limit=10`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body: unknown = await res.json().catch(() => null);
      if (cancelled) return;
      if (isApiResponse<{ members: Match[] }>(body) && body.ok) {
        setMatches(body.data.members);
        return;
      }
      // This endpoint predates the standard envelope, so tolerate its raw shape.
      if (body && typeof body === "object" && "members" in body) {
        setMatches((body as { members: Match[] }).members);
        return;
      }
      setMatches([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, conflictMemberId, memberName, onLink]);

  const canLink = onLink !== undefined && (conflictMemberId ? true : (matches?.length ?? 0) > 0);
  const target = conflictMemberId || chosen;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>That name is already a member</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        <p className="text-sm text-[var(--text-muted)]">
          Nothing was saved. Choose how to handle {memberName}.
        </p>

        {canLink && matches ? (
          <div className="space-y-1.5">
            <Label htmlFor="conflict-member">Link this application to</Label>
            <Select value={target} onValueChange={setChosen}>
              <SelectTrigger id="conflict-member">
                <SelectValue placeholder="Choose a member…" />
              </SelectTrigger>
              <SelectContent>
                {matches.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-[var(--text-muted)]">
              Approves the application without creating a second member.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {canLink ? (
            <Button
              type="button"
              className="w-full"
              disabled={!target || busy}
              onClick={() => {
                if (!onLink || !target) return;
                setBusy(true);
                setError(null);
                void (async () => {
                  try {
                    await onLink(target);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Could not link the member.");
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {busy ? "Linking…" : "Link to this member"}
            </Button>
          ) : null}
          <Button type="button" variant="outline" className="w-full" onClick={onEditName}>
            Edit the name on this application
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={onRejectAsDuplicate}
          >
            Reject as a duplicate
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Leave it for now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
