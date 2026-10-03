"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Smartphone } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * The install button, and nothing else.
 *
 * This used to also enable and disable push. That has moved to `/notifications`, which is the one
 * place that answers "what will this phone tell me about" — including which topics are on and why a
 * browser is refusing. Leaving a second enable button here meant two screens that both claimed to
 * own the permission, and a device switched on here could not be configured anywhere.
 *
 * Install stays here because it is not a preference: it is a one-off action with no state worth
 * storing, and it is the thing people reach for when they ask what the "App" button does.
 */
export function PwaHub() {
  const [standalone, setStandalone] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installBusy, setInstallBusy] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  const onInstall = useCallback(async () => {
    if (!deferred) return;
    setInstallBusy(true);
    try {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      setStandalone(isStandalone());
    } finally {
      setInstallBusy(false);
    }
  }, [deferred]);

  const showInstallUi = !standalone && (Boolean(deferred) || isIos());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton tooltip="Install & notifications">
          <Smartphone aria-hidden className="size-4" />
          <span>App</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="w-[min(92vw,20rem)] rounded-2xl p-4">
        <p className="text-xs font-semibold text-[var(--brand)]">Install app</p>

        {showInstallUi ? (
          <div className="mt-2 space-y-2 border-t border-[var(--border)] pt-3">
            <p className="text-xs text-[var(--text-muted)]">
              Works offline and shows on your home screen. Allow notifications when prompted.
            </p>
            {deferred ? (
              <button
                type="button"
                disabled={installBusy}
                onClick={() => void onInstall()}
                className="min-h-10 w-full rounded-xl bg-[var(--brand)] text-sm font-medium text-white disabled:opacity-40"
              >
                {installBusy ? "Installing..." : "Install KofA AMS"}
              </button>
            ) : isIos() ? (
              <p className="text-xs text-[var(--text-muted)]">
                On iPhone or iPad: tap <strong>Share</strong>, then{" "}
                <strong>Add to Home Screen</strong>. Web push works once the app is opened from that
                icon (iOS 16.4 and later).
              </p>
            ) : (
              <p className="text-xs text-[var(--text-muted)]">
                Use your browser menu: look for &quot;Install app&quot;, &quot;Add to Home screen&quot;, or
                something close to that.
              </p>
            )}
          </div>
        ) : (
          <p className="mt-1 text-xs text-[var(--text-muted)]">Already installed on this device.</p>
        )}

        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          <p className="text-xs font-medium text-[var(--text)]">Notifications</p>
          <p className="text-xs text-[var(--text-muted)]">
            Turn push on or off, and choose what to hear about, in Notifications settings.
          </p>
          <SidebarMenuButton asChild tooltip="Notification settings" className="min-h-10">
            <Link href="/notifications">
              <Bell aria-hidden className="size-4" />
              <span>Open notification settings</span>
            </Link>
          </SidebarMenuButton>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}