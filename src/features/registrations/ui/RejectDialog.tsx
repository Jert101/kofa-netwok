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
import { REJECT_PRESETS, REJECT_REASON_MAX } from "@/features/registrations/reject-reasons";

export type RejectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How many applications the reason will apply to. */
  count: number;
  busy?: boolean;
  /** Pre-selected reason, used by "Reject as duplicate". */
  initialReason?: string;
  onConfirm: (reason: string, note: string) => void;
};

const OTHER = "Other";

/**
 * REG-5: a rejection always carries a reason, because the applicant sees it on
 * their status page. A preset alone is enough; a note is optional.
 */
export function RejectDialog({
  open,
  onOpenChange,
  count,
  busy = false,
  initialReason,
  onConfirm,
}: RejectDialogProps) {
  const [reason, setReason] = useState(initialReason ?? REJECT_PRESETS[0]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason(initialReason ?? REJECT_PRESETS[0]);
      setNote("");
      setError(null);
    }
  }, [open, initialReason]);

  const isOther = reason === OTHER;
  const noteTooLong = note.trim().length > REJECT_REASON_MAX;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {count === 1 ? "Reject this application" : `Reject ${count} applications`}
          </DialogTitle>
          <DialogDescription>
            The applicant sees this reason on their status page.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Reason</legend>
          {REJECT_PRESETS.map((preset) => (
            <label key={preset} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="radio"
                name="reject-reason"
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
          <Label htmlFor="reject-note">
            Note {isOther ? "" : "(optional)"}
          </Label>
          <Textarea
            id="reject-note"
            value={note}
            rows={2}
            placeholder={isOther ? "Explain what is needed" : "Anything else to add"}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={noteTooLong}
          />
          <p className="text-xs text-[var(--text-muted)]">
            {note.trim().length}/{REJECT_REASON_MAX}
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
            {busy
              ? "Working…"
              : count === 1
                ? "Reject application"
                : `Reject ${count} applications`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
