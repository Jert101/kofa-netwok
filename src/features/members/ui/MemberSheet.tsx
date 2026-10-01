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
import { splitName } from "@/lib/members/normalize-name";
import type { MemberRow } from "@/features/members/member-query";

const NO_BATCH = "__none__";
const NO_GENDER = "__none__";

export type MemberForm = {
  first_name: string;
  middle_initial: string;
  last_name: string;
  date_of_birth: string;
  gender: string;
  contact_number: string;
  batch: string;
};

const EMPTY: MemberForm = {
  first_name: "",
  middle_initial: "",
  last_name: "",
  date_of_birth: "",
  gender: NO_GENDER,
  contact_number: "",
  batch: NO_BATCH,
};

export type MemberSheetProps = {
  /** null closes the sheet. */
  member: MemberRow | null;
  open: boolean;
  batches: string[];
  busy?: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: Record<string, unknown>) => void;
};

export function MemberSheet({
  member,
  open,
  batches,
  busy = false,
  error,
  onOpenChange,
  onSubmit,
}: MemberSheetProps) {
  const [form, setForm] = useState<MemberForm>(EMPTY);

  useEffect(() => {
    if (!open) return;
    if (!member) {
      setForm(EMPTY);
      return;
    }
    const parts = splitName(member.full_name);
    setForm({
      first_name: parts.firstName,
      middle_initial: parts.middleInitial ?? "",
      last_name: parts.lastName,
      date_of_birth: member.date_of_birth ?? "",
      gender: member.gender ?? NO_GENDER,
      contact_number: member.contact_number ?? "",
      batch: member.batch ?? NO_BATCH,
    });
  }, [open, member]);

  function submit() {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      return;
    }
    onSubmit({
      first_name: form.first_name.trim(),
      middle_initial: form.middle_initial.replace(".", "").trim().toUpperCase() || null,
      last_name: form.last_name.trim(),
      date_of_birth: form.date_of_birth || null,
      gender: form.gender === NO_GENDER ? null : form.gender,
      contact_number: form.contact_number.trim() || null,
      batch: form.batch === NO_BATCH ? null : form.batch,
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{member ? "Edit member" : "Add member"}</SheetTitle>
          <SheetDescription>
            {member
              ? "Changes are recorded in the audit log."
              : "New members can be added by hand or by importing a CSV."}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-4 px-4 pb-4">
          <div className="grid grid-cols-[1fr_4rem_1fr] gap-2">
            <div className="space-y-1">
              <Label htmlFor="m-first">First name</Label>
              <Input
                id="m-first"
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-mi">MI</Label>
              <Input
                id="m-mi"
                maxLength={1}
                className="text-center uppercase"
                value={form.middle_initial}
                onChange={(e) =>
                  setForm({ ...form, middle_initial: e.target.value.replace(".", "") })
                }
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-last">Last name</Label>
              <Input
                id="m-last"
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="m-dob">Date of birth</Label>
            <Input
              id="m-dob"
              type="date"
              value={form.date_of_birth}
              onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="m-gender">Gender</Label>
            <Select
              value={form.gender}
              onValueChange={(v) => setForm({ ...form, gender: v })}
            >
              <SelectTrigger id="m-gender">
                <SelectValue placeholder="Not given" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GENDER}>Not given</SelectItem>
                {GENDER_OPTIONS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>
                    {g.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="m-contact">Contact number</Label>
            <Input
              id="m-contact"
              type="tel"
              value={form.contact_number}
              onChange={(e) => setForm({ ...form, contact_number: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="m-batch">Batch</Label>
            <Select value={form.batch} onValueChange={(v) => setForm({ ...form, batch: v })}>
              <SelectTrigger id="m-batch">
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
            onClick={submit}
            disabled={busy || !form.first_name.trim() || !form.last_name.trim()}
          >
            {busy ? "Saving…" : member ? "Save changes" : "Add member"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
