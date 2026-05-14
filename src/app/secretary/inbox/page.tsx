"use client";

import { useEffect, useState } from "react";
import { AnnouncementSelfService } from "@/components/AnnouncementSelfService";

type N = {
  id: string;
  from_role: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

export default function SecretaryInboxPage() {
  const [items, setItems] = useState<N[] | null>(null);

  async function load() {
    const res = await fetch("/api/notifications", { credentials: "same-origin" });
    const j = (await res.json()) as { notifications: N[] };
    setItems(j.notifications ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}/read`, { method: "POST", credentials: "same-origin" });
    load();
  }

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Inbox</h1>
      {items === null ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No messages.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={
                "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 " +
                (n.read_at ? "opacity-70" : "")
              }
            >
              <p className="font-medium">{n.title}</p>
              {n.body ? <p className="mt-1 text-sm text-[var(--muted)]">{n.body}</p> : null}
              <p className="mt-2 text-xs text-[var(--muted)]">From {n.from_role}</p>
              {!n.read_at ? (
                <button
                  type="button"
                  className="mt-3 min-h-10 text-sm font-medium text-[var(--accent)]"
                  onClick={() => markRead(n.id)}
                >
                  Mark read
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-[var(--muted)]">Message admin</h2>
        <SendForm onSent={load} />
      </div>
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-[var(--muted)]">Post announcement to members</h2>
        <AnnouncementSelfService />
      </div>
    </div>
  );
}

function SendForm({ onSent }: { onSent: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ title, body: body || undefined }),
      });
      setTitle("");
      setBody("");
      onSent();
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="mt-3 space-y-3">
      <input
        className="w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
        placeholder="Subject"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        className="min-h-24 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        placeholder="Message (optional)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <button
        type="submit"
        disabled={sending}
        className="min-h-12 w-full rounded-xl border border-[var(--border)] font-medium"
      >
        Send to admin
      </button>
    </form>
  );
}
