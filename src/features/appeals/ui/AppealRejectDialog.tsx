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
import { Textarea } from "@/components/ui/textarea";
import {
  APPEAL_REJECT_PRESETS,
  APPEAL_REJECT_REASON_MAX,
} from "@/lib/appeals/reject-reasons";

export type AppealRejectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The member's name, so the dialog names who it is about. */
  memberName?: string;
  busy?: boolean;
  onConfirm: (reason: string, note: string) => void;
};

const OTHER = "Other";

/**
 * APL-5: a rejection always carries a reason the member can read.
 *
 * Built on the same Dialog/Button/Textarea primitives as the registration reject
 * dialog rather than a bespoke modal, so keyboard and focus behaviour match the rest of
 * the app. "Other" requires a written explanation, because "Other" alone is not a
 * reason anyone can act on.
 */
export function AppealRejectDialog({
  open,
  onOpenChange,
  memberName,
  busy = false,
  onConfirm,
}: AppealRejectDialogProps) {
  const [reason, setReason] = useState<string>(APPEAL_REJECT_PRESETS[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason(APPEAL_REJECT_PRESETS[0]);
      setNote("");
      setError(null);
    }
  }, [open]);

  const isOther = reason === OTHER;
  const noteTooLong = note.trim().length > APPEAL_REJECT_REASON_MAX;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject this appeal</DialogTitle>
          <DialogDescription>
            {memberName ? `${memberName} will see ` : "The member will see "}
            this reason when they check their attendance.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Reason</legend>
          {APPEAL_REJECT_PRESETS.map((preset) => (
            <label key={preset} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="radio"
                name="appeal-reject-reason"
                value={preset}
                checked={reason === preset}
                onChange={() => setReason(preset)}
                className="size-4 accent-[var(--brand)]"
              />
              {preset}
            </label>
          ))}
        </fieldset>

        <div className="space-y-1">
          <Label htmlFor="appeal-reject-note">{isOther ? "Reason" : "Note (optional)"}</Label>
          <Textarea
            id="appeal-reject-note"
            value={note}
            rows={2}
            placeholder={isOther ? "Explain what is needed" : "Anything else to add"}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={noteTooLong}
          />
          <p className="text-xs text-[var(--text-muted)]">
            {note.trim().length}/{APPEAL_REJECT_REASON_MAX}
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || noteTooLong || (isOther && !note.trim())}
            onClick={() => {
              if (isOther && !note.trim()) {
                setError("Write a reason of your own.");
                return;
              }
              onConfirm(reason, note.trim());
            }}
          >
            {busy ? "Working…" : "Reject appeal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
