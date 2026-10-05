"use client";

import { useEffect, useState } from "react";
import { markReadLocally, refreshUnread } from "@/lib/comms/use-unread-count";

export type InboxItem = {
  id: string;
  from_role: string;
  to_role: string;
  title: string;
  body: string | null;
  /** COM-2/P4: the in-app destination. Null means the item is informational. */
  link: string | null;
  read_at: string | null;
  created_at: string;
};

function when(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * COM-2: the inbox itself, shared by admin, secretary and super admin.
 *
 * Reading an item is an action, not a route: opening it marks it read and follows the link, so the
 * badge and the list cannot disagree about what has been seen. The unread dot is drawn rather than
 * a colour change alone, because "slightly faded" is not a state anybody can count.
 */
export function InboxList() {
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [error, setError] = useState<string | null>(null);

  async function load(next: "all" | "unread" = filter) {
    const res = await fetch(
      next === "unread" ? "/api/notifications?unread=1" : "/api/notifications",
      { credentials: "same-origin", cache: "no-store" },
    );
    if (!res.ok) {
      setError("Could not load your inbox.");
      setItems([]);
      return;
    }
    const j = (await res.json()) as { notifications?: InboxItem[] };
    setItems(j.notifications ?? []);
  }

  useEffect(() => {
    void load(filter);
    // Reloading on filter change is the point: "Unread" is a query, not a client-side filter, so it
    // agrees with the count the badge is showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function open(item: InboxItem) {
    if (!item.read_at) {
      const previous = items;
      const stamped = new Date().toISOString();
      // Optimistic: mark it read so the dot clears without waiting on the network. This used to be
      // the whole story -- if the PATCH below failed, the server kept the item unread, the badge
      // had already been decremented, and the item flipped back to unread on the next load, which
      // looks exactly like the action un-did itself to the person who took it. So the update is now
      // rolled back when the save does not land.
      setItems((prev) =>
        prev?.map((n) => (n.id === item.id ? { ...n, read_at: stamped } : n)) ?? prev,
      );
      markReadLocally();
      try {
        const res = await fetch(`/api/notifications/${item.id}`, {
          method: "PATCH",
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(String(res.status));
        setError(null);
      } catch {
        setItems(previous);
        setError("That message could not be marked as read.");
      }
      refreshUnread();
    }
    if (item.link) window.location.assign(item.link);
  }

  async function markAllRead() {
    const res = await fetch("/api/notifications/read-all", {
      method: "POST",
      credentials: "same-origin",
    });
    if (!res.ok) {
      setError("Could not mark everything as read.");
      return;
    }
    setError(null);
    await load(filter);
    refreshUnread();
  }

  const unread = items?.filter((i) => !i.read_at).length ?? 0;

  return (
    <section aria-label="Inbox" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex overflow-hidden rounded-xl border border-[var(--border)]"
          role="group"
          aria-label="Filter messages"
        >
          {(["all", "unread"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={
                "min-h-10 px-3 text-sm font-medium capitalize " +
                (filter === f ? "bg-[var(--brand)] text-white" : "bg-[var(--surface)] text-[var(--text-muted)]")
              }
            >
              {f}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={markAllRead}
          disabled={unread === 0}
          className="min-h-10 rounded-xl border border-[var(--border)] px-3 text-sm font-medium disabled:opacity-40"
        >
          Mark all read{unread > 0 ? ` (${unread})` : ""}
        </button>
      </div>

      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}

      {items === null ? (
        <p className="text-sm text-[var(--text-muted)]">Loading messages...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          {filter === "unread" ? "Nothing unread." : "No messages yet."}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => void open(n)}
                className="flex w-full items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left"
              >
                <span
                  aria-hidden
                  className={
                    "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " +
                    (n.read_at ? "bg-transparent" : "bg-[var(--brand)]")
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className={"font-medium " + (n.read_at ? "text-[var(--text-muted)]" : "text-[var(--text)]")}>
                      {n.title}
                    </span>
                    <span className="text-xs text-[var(--text-muted)]">{when(n.created_at)}</span>
                  </span>
                  {n.body ? (
                    <span className="mt-1 block whitespace-pre-wrap text-sm text-[var(--text-muted)]">
                      {n.body}
                    </span>
                  ) : null}
                  <span className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <span>From {n.from_role}</span>
                    {n.read_at ? null : <span className="font-medium text-[var(--brand)]">Unread</span>}
                    {n.link ? <span>· Opens the page</span> : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}