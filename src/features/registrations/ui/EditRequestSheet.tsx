"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GENDER_OPTIONS } from "@/features/registrations/schemas";
import type { RegistrationRequest } from "@/features/registrations/ui/types";

const NO_BATCH = "__none__";

type Form = {
  first_name: string;
  middle_initial: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  contact_number: string;
  batch: string;
};

export type EditRequestSheetProps = {
  request: RegistrationRequest | null;
  batches: string[];
  busy?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (values: Record<string, unknown>) => void;
};

/**
 * REG-4: an approved application is a member, so editing it here would edit
 * something that is not what the page says it is. The server refuses it too.
 */
export function EditRequestSheet({
  request,
  batches,
  busy = false,
  onOpenChange,
  onSave,
}: EditRequestSheetProps) {
  const [form, setForm] = useState<Form>({
    first_name: "",
    middle_initial: "",
    last_name: "",
    date_of_birth: "",
    gender: "",
    contact_number: "",
    batch: NO_BATCH,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!request) return;
    setForm({
      first_name: request.first_name,
      middle_initial: request.middle_initial ?? "",
      last_name: request.last_name,
      date_of_birth: request.date_of_birth ?? "",
      gender: request.gender ?? "",
      contact_number: request.contact_number ?? "",
      batch: request.batch ?? NO_BATCH,
    });
    setError(null);
  }, [request]);

  const open = request !== null;

  function submit() {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setError("A first and last name are both needed.");
      return;
    }
    onSave({
      first_name: form.first_name.trim(),
      middle_initial: form.middle_initial.replace(".", "").trim().toUpperCase(),
      last_name: form.last_name.trim(),
      date_of_birth: form.date_of_birth || null,
      gender: form.gender || null,
      contact_number: form.contact_number.trim() || null,
      batch: form.batch === NO_BATCH ? null : form.batch,
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit application</SheetTitle>
          <SheetDescription>
            {request?.reference_code
              ? `Reference ${request.reference_code}`
              : "Changes are recorded in the audit log."}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 px-4 pb-4">
          <div className="grid grid-cols-[1fr_4rem_1fr] gap-2">
            <div className="space-y-1">
              <Label htmlFor="edit-first">First name</Label>
              <Input
                id="edit-first"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-mi">MI</Label>
              <Input
                id="edit-mi"
                maxLength={1}
                className="text-center uppercase"
                value={form.middle_initial}
                onChange={(e) =>
                  setForm({ ...form, middle_initial: e.target.value.replace(".", "") })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="edit-last">Last name</Label>
              <Input
                id="edit-last"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-dob">Date of birth</Label>
            <Input
              id="edit-dob"
              type="date"
              value={form.date_of_birth}
              onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-gender">Gender</Label>
            <Select
              value={form.gender}
              onValueChange={(v) => setForm({ ...form, gender: v === NO_BATCH ? "" : v })}
            >
              <SelectTrigger id="edit-gender">
                <SelectValue placeholder="Not given" />
              </SelectTrigger>
              <SelectContent>
                {GENDER_OPTIONS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-contact">Contact number</Label>
            <Input
              id="edit-contact"
              type="tel"
              value={form.contact_number}
              onChange={(e) => setForm({ ...form, contact_number: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="edit-batch">Batch</Label>
            <Select value={form.batch} onValueChange={(v) => setForm({ ...form, batch: v })}>
              <SelectTrigger id="edit-batch">
                <SelectValue placeholder="No batch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_BATCH}>No batch</SelectItem>
                {batches.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}
        </div>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
