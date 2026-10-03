import type { Metadata } from "next";
import { NotificationSettings } from "@/features/comms/NotificationSettings";

export const metadata: Metadata = { title: "Notifications | KofA AMS" };

export default function NotificationSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Notifications</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Push notifications are per device. Signing out or signing in on another device does not
          change this one. Everything you turn on here is also in the inbox inside the app.
        </p>
      </header>

      <NotificationSettings />
    </div>
  );
}
