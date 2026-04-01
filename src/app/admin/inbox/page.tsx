"use client";

import { useEffect, useState } from "react";

type N = {
  id: string;
  from_role: string;
  title: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

type Announcement = {
  id: string;
  title: string;
  body: string;
  created_by: "admin" | "secretary";
  created_at: string;
  delete_at: string | null;
};

export default function AdminInboxPage() {
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
        <h2 className="text-sm font-semibold text-[var(--muted)]">Message secretary</h2>
        <SendForm onSent={load} />
      </div>
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-[var(--muted)]">Post announcement to members</h2>
        <AnnouncementForm />
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
        Send to secretary
      </button>
    </form>
  );
}

function AnnouncementForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deleteAt, setDeleteAt] = useState("");
  const [mine, setMine] = useState<Announcement[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editDeleteAt, setEditDeleteAt] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadMine() {
    const res = await fetch("/api/announcements?mine=1", { credentials: "same-origin" });
    if (!res.ok) {
      setMine([]);
      return;
    }
    const j = (await res.json()) as { announcements?: Announcement[] };
    setMine(j.announcements ?? []);
  }

  useEffect(() => {
    loadMine();
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setSending(true);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          title,
          body,
          delete_at: deleteAt ? new Date(deleteAt).toISOString() : undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setMsg(j.error ?? "Could not post announcement.");
        return;
      }
      setTitle("");
      setBody("");
      setDeleteAt("");
      setMsg("Announcement posted for members.");
      loadMine();
    } finally {
      setSending(false);
    }
  }

  async function removeAnnouncement(id: string) {
    const res = await fetch(`/api/announcements/${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      setMsg("Could not delete announcement.");
      return;
    }
    setMsg("Announcement deleted.");
    if (editingId === id) setEditingId(null);
    loadMine();
  }

  async function saveEdit(id: string) {
    const res = await fetch(`/api/announcements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        title: editTitle,
        body: editBody,
        delete_at: editDeleteAt ? new Date(editDeleteAt).toISOString() : null,
      }),
    });
    if (!res.ok) {
      setMsg("Could not update announcement.");
      return;
    }
    setMsg("Announcement updated.");
    setEditingId(null);
    loadMine();
  }

  return (
    <form onSubmit={send} className="mt-3 space-y-3">
      <input
        className="w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
        placeholder="Announcement title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <textarea
        className="min-h-24 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        placeholder="Announcement details"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        required
      />
      <label className="block">
        <span className="text-sm text-[var(--muted)]">Auto-delete on (optional)</span>
        <input
          type="datetime-local"
          className="mt-1 w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
          value={deleteAt}
          onChange={(e) => setDeleteAt(e.target.value)}
        />
      </label>
      {msg ? <p className="text-sm text-[var(--muted)]">{msg}</p> : null}
      <button
        type="submit"
        disabled={sending || !title.trim() || !body.trim()}
        className="min-h-12 w-full rounded-xl bg-[var(--accent)] font-medium text-white disabled:opacity-40"
      >
        {sending ? "Posting..." : "Post announcement"}
      </button>

      <div className="pt-2">
        <h3 className="text-sm font-semibold text-[var(--muted)]">Your posted announcements</h3>
        {mine === null ? (
          <p className="mt-2 text-sm text-[var(--muted)]">Loading...</p>
        ) : mine.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--muted)]">No announcements yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {mine.map((a) => (
              <li key={a.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                {editingId === a.id ? (
                  <div className="space-y-2">
                    <input
                      className="w-full min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                    />
                    <textarea
                      className="min-h-20 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                    />
                    <input
                      type="datetime-local"
                      className="w-full min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3"
                      value={editDeleteAt}
                      onChange={(e) => setEditDeleteAt(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="min-h-10 rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-white"
                        onClick={() => saveEdit(a.id)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm font-medium"
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="font-medium text-[var(--text)]">{a.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--muted)]">{a.body}</p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Delete on: {a.delete_at ? new Date(a.delete_at).toLocaleString() : "No auto-delete date"}
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className="min-h-10 rounded-lg border border-[var(--border)] px-3 text-sm font-medium"
                        onClick={() => {
                          setEditingId(a.id);
                          setEditTitle(a.title);
                          setEditBody(a.body);
                          setEditDeleteAt(a.delete_at ? a.delete_at.slice(0, 16) : "");
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="min-h-10 rounded-lg bg-[var(--danger)] px-3 text-sm font-medium text-white"
                        onClick={() => removeAnnouncement(a.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </form>
  );
}
