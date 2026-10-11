"use client";

import { ActorDialog } from "@/components/auth/ActorPicker";

/**
 * The member login gate's second half.
 *
 * The login dialog is the first half, but it is client state: after the PIN
 * step the session cookie is already set, so navigating straight to /member
 * skips the dialog entirely. The member layout renders this instead of the
 * shell when the session is a member's with no declared name, which closes
 * that hole. Picking a name refreshes the layout and the gate lifts.
 *
 * Only ever rendered for the member's own role (the layout decides that).
 * Admins browsing member pages are never sent here.
 */
export function MemberActorGate() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-2 bg-[var(--surface)] px-5 text-center">
      <p className="text-sm font-semibold">One more step</p>
      <p className="max-w-sm text-sm text-[var(--text-muted)]">
        Pick your name to continue to your attendance.
      </p>
      <ActorDialog open onOpenChange={() => {}} actor={null} skippable={false} locked />
    </div>
  );
}
