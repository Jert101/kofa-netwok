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
  DEACTIVATION_PRESETS,
  DEACTIVATION_REASON_MAX,
} from "@/features/members/deactivation";

const OTHER = "Other";

export type DeactivateDialogProps = {
  open: boolean;
  name: string;
  busy?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string, note: string) => void;
};

/**
 * MEM-3: a member is never deleted. Deactivation records when and why, so the
 * attendance history behind the record still makes sense later.
 */
export function DeactivateDialog({
  open,
  name,
  busy = false,
  error,
  onOpenChange,
  onConfirm,
}: DeactivateDialogProps) {
  const [reason, setReason] = useState<string>(DEACTIVATION_PRESETS[0]);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setReason(DEACTIVATION_PRESETS[0]);
      setNote("");
    }
  }, [open]);

  const isOther = reason === OTHER;
  const noteTooLong = note.trim().length > DEACTIVATION_REASON_MAX;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate {name}</DialogTitle>
          <DialogDescription>
            The record stays. It will not appear in rosters or attendance lists, and it
            can be reactivated later.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Reason</legend>
          {DEACTIVATION_PRESETS.map((preset) => (
            <label key={preset} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="radio"
                name="deactivation-reason"
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
          <Label htmlFor="deactivation-note">Note {isOther ? "" : "(optional)"}</Label>
          <Textarea
            id="deactivation-note"
            rows={2}
            value={note}
            placeholder={isOther ? "Explain what happened" : "Anything else worth remembering"}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={noteTooLong}
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || noteTooLong || (isOther && !note.trim())}
            onClick={() => onConfirm(reason, note.trim())}
          >
            {busy ? "Working…" : "Deactivate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
