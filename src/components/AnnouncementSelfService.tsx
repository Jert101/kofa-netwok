"use client";

import { useEffect, useState } from "react";

export type SelfServiceAnnouncement = {
  id: string;
  title: string;
  body: string;
  created_by: "admin" | "secretary" | "officer";
  created_at: string;
  delete_at: string | null;
};

export function AnnouncementSelfService() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deleteAt, setDeleteAt] = useState("");
  const [mine, setMine] = useState<SelfServiceAnnouncement[] | null>(null);
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
    const j = (await res.json()) as { announcements?: SelfServiceAnnouncement[] };
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
