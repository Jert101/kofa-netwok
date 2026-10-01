"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, KeyRound, LogOut, ShieldAlert } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isApiResponse } from "@/lib/api/response";
import { checkPin, checkPinConfirmation } from "@/lib/auth/pin-rules";
import { ROLE_LABEL } from "@/lib/nav/config";
import { ROLE_ORDER, type Role } from "@/lib/auth/roles";

type RoleStatus = {
  role: Role;
  hasPin: boolean;
  pinChangedAt: string | null;
  sessionsValidAfter: string | null;
  onDefaultPin: boolean;
};

type Status = {
  defaultPin: string;
  rolesOnDefaultPin: Role[];
  sharedHash: { roles: Role[] }[];
  pendingReports: number;
  roles: RoleStatus[];
};

const ROLE_ORDER_LIST: readonly Role[] = ROLE_ORDER;

function formatDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toLocaleDateString();
}

export function SecurityPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Role | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<Role | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/security/status", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body: unknown = await res.json();
      if (isApiResponse<Status>(body) && body.ok) {
        setStatus(body.data);
        setError(null);
      } else {
        setError("Could not load the security status.");
      }
    } catch {
      setError("Can't reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(role: Role) {
    setNotice(null);
    const res = await fetch("/api/admin/pins/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ role }),
    }).catch(() => null);
    if (res?.ok) {
      setNotice(`${ROLE_LABEL[role]} devices have been signed out.`);
      setConfirmRevoke(null);
      await load();
      router.refresh();
    } else {
      setNotice("Could not sign those devices out.");
    }
  }

  async function clearBlocks() {
    setNotice(null);
    const res = await fetch("/api/admin/pins/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ clearLoginBlocks: true }),
    }).catch(() => null);
    const body: unknown = res ? await res.json().catch(() => null) : null;
    if (res?.ok && isApiResponse<{ clearedLoginBlocks: number }>(body) && body.ok) {
      setNotice(`Cleared ${body.data.clearedLoginBlocks} login block record(s).`);
    } else {
      setNotice("Could not clear login blocks.");
    }
  }

  const roles = useMemo(
    () =>
      status
        ? ROLE_ORDER_LIST.map((r) => status.roles.find((x) => x.role === r)).filter(
            (x): x is RoleStatus => Boolean(x),
          )
        : [],
    [status],
  );

  if (loading) {
    return <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>;
  }

  if (error || !status) {
    return <p className="py-8 text-center text-sm text-[var(--danger)]">{error}</p>;
  }

  return (
    <div className="space-y-6">
      {status.rolesOnDefaultPin.length > 0 ? (
        <div
          role="alert"
          className="flex gap-3 rounded-2xl border border-[var(--danger)] bg-[var(--danger)]/10 p-4"
        >
          <ShieldAlert aria-hidden className="size-5 shrink-0 text-[var(--danger)]" />
          <div className="text-sm">
            <p className="font-semibold text-[var(--danger)]">Default PINs are still in use</p>
            <p className="mt-1 text-[var(--text)]">
              {status.rolesOnDefaultPin.map((r) => ROLE_LABEL[r]).join(", ")} still use{" "}
              {status.defaultPin}. Anyone who guesses it gets in. Change them now.
            </p>
          </div>
        </div>
      ) : null}

      {status.sharedHash.length > 0 ? (
        <div
          role="alert"
          className="flex gap-3 rounded-2xl border border-[var(--danger)] bg-[var(--danger)]/10 p-4"
        >
          <AlertTriangle aria-hidden className="size-5 shrink-0 text-[var(--danger)]" />
          <div className="text-sm">
            <p className="font-semibold text-[var(--danger)]">
              Two roles were given the same stored PIN
            </p>
            <ul className="mt-1 list-inside list-disc text-[var(--text)]">
              {status.sharedHash.map((d) => (
                <li key={d.roles.join("-")}>
                  {d.roles.map((r) => ROLE_LABEL[r]).join(" and ")}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[var(--muted)]">
              Their hashes are the same value, not two hashes of the same PIN, so one of these
              was copied rather than set through the app. Sign-in resolves roles in a fixed
              order, so the later one is hard to reach. Re-set both PINs.
            </p>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
          {notice}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((r) => (
          <Card key={r.role} className="border-[var(--border)] bg-[var(--surface)]">
            <CardHeader>
              <CardTitle className="text-base">
                {r.role === "super_admin" ? "Super admin (report approval)" : ROLE_LABEL[r.role]}
              </CardTitle>
              <CardDescription>
                {r.role === "super_admin"
                  ? "Setting a PIN turns on report approval. Clearing it turns approval off."
                  : `PIN last changed ${formatDate(r.pinChangedAt)}.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {r.onDefaultPin ? (
                <p className="text-sm font-medium text-[var(--danger)]">
                  Still using the default PIN {status.defaultPin}.
                </p>
              ) : null}
              {r.sessionsValidAfter ? (
                <p className="text-xs text-[var(--muted)]">
                  Sessions issued before {formatDate(r.sessionsValidAfter)} were signed out.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setEditing(r.role)}
                >
                  <KeyRound aria-hidden className="size-4" />
                  {r.hasPin ? "Change PIN" : "Set PIN"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => setConfirmRevoke(r.role)}
                >
                  <LogOut aria-hidden className="size-4" />
                  Sign out all devices
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-[var(--border)] bg-[var(--surface)]">
        <CardHeader>
          <CardTitle className="text-base">Shared device lockout</CardTitle>
          <CardDescription>
            Five wrong PINs blocks one client for 15 minutes. On a shared church wifi that can lock
            out everyone at once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void clearBlocks()}>
            Clear login blocks
          </Button>
        </CardContent>
      </Card>

      <ChangePinDialog
        role={editing}
        pendingReports={status.pendingReports}
        onClose={() => setEditing(null)}
        onSaved={async (message) => {
          setEditing(null);
          setNotice(message);
          await load();
          router.refresh();
        }}
      />

      <AlertDialog open={confirmRevoke !== null} onOpenChange={(o) => !o && setConfirmRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Sign out every {confirmRevoke ? ROLE_LABEL[confirmRevoke] : ""} device?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Everyone signed in as that role, including this device, will need the PIN again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRevoke && void revoke(confirmRevoke)}>
              Sign out all devices
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChangePinDialog({
  role,
  pendingReports,
  onClose,
  onSaved,
}: {
  role: Role | null;
  pendingReports: number;
  onClose: () => void;
  onSaved: (message: string) => void | Promise<void>;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (role) {
      setPin("");
      setConfirm("");
      setError(null);
    }
  }, [role]);

  const rule = pin.length > 0 ? checkPin(pin) : null;
  const confirmRule = confirm.length > 0 ? checkPinConfirmation(pin, confirm) : null;
  const canSubmit = pin.length > 0 && confirm.length > 0 && rule?.ok === true && confirmRule?.ok === true;

  async function save() {
    if (!role || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ role, pin, confirm }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(isApiResponse(body) && !body.ok ? body.error.message : "Could not update the PIN.");
        return;
      }
      await onSaved(
        `${ROLE_LABEL[role]} PIN updated. Other devices signed in as that role must sign in again.`,
      );
    } catch {
      setError("Can't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function clearSuperAdmin() {
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ role, pin: "", confirm: "" }),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        setError(isApiResponse(body) && !body.ok ? body.error.message : "Could not clear the PIN.");
        return;
      }
      await onSaved("Report approval is now off.");
    } catch {
      setError("Can't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={role !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {role === "super_admin" ? "Super admin PIN" : `${role ? ROLE_LABEL[role] : ""} PIN`}
          </DialogTitle>
          <DialogDescription>
            4 to 12 digits. Avoid repeated or sequential numbers, and do not reuse another
            role&apos;s PIN.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label htmlFor="new-pin" className="text-sm">
              <span className="text-[var(--muted)]">New PIN</span>
            </label>
            <Input
              id="new-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              className="mt-1 h-12"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 12))}
            />
            {rule ? (
              <p
                className={`mt-1 text-xs ${rule.ok ? "text-[var(--muted)]" : "text-[var(--danger)]"}`}
                aria-live="polite"
              >
                {rule.ok ? <Check aria-hidden className="mr-1 inline size-3" /> : null}
                {rule.ok ? "Looks fine." : rule.message}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="confirm-pin" className="text-sm">
              <span className="text-[var(--muted)]">Confirm PIN</span>
            </label>
            <Input
              id="confirm-pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              className="mt-1 h-12"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 12))}
            />
            {confirmRule && !confirmRule.ok ? (
              <p className="mt-1 text-xs text-[var(--danger)]" aria-live="polite">
                {confirmRule.message}
              </p>
            ) : null}
          </div>

          {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {role === "super_admin" ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void clearSuperAdmin()}
              className="text-[var(--danger)]"
            >
              Turn approval off
            </Button>
          ) : null}
          <div className="flex flex-1 justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!canSubmit || busy}>
              {busy ? "Saving…" : "Save PIN"}
            </Button>
          </div>
        </DialogFooter>

        {role === "super_admin" && pendingReports > 0 ? (
          <p className="text-xs text-[var(--muted)]">
            {pendingReports} report{pendingReports === 1 ? "" : "s"} awaiting approval. Approval cannot
            be turned off until {pendingReports === 1 ? "it is" : "they are"} resolved.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
