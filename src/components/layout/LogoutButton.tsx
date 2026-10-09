"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SidebarMenuButton } from "@/components/ui/sidebar";

export function LogoutButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function logout() {
    setLoading(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      // `/`, not `/login`. Signing out used to drop somebody onto the sign-in form with nothing to
      // read and no way back, which reads as being told off. The landing page is public now, so it is
      // where a signed-out visitor belongs -- and it carries the sign-in link, so this is one tap
      // rather than two when they meant to switch accounts.
      //
      // The `refresh()` after it is not decoration: it drops the router cache, which would otherwise
      // be free to serve a copy of `/` rendered while a session was still live.
      router.replace("/");
      router.refresh();
    } catch {
      setLoading(false);
      setOpen(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <SidebarMenuButton tooltip="Log out" className="min-h-11">
          <LogOut aria-hidden />
          <span>Log out</span>
        </SidebarMenuButton>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Log out?</AlertDialogTitle>
          <AlertDialogDescription>
            You will need your PIN to sign in again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={logout}
            disabled={loading}
            className="bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90"
          >
            {loading ? "Logging out…" : "Log out"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
