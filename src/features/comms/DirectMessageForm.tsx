"use client";

import { useState } from "react";
import { messageOf, readEnvelope } from "@/lib/api/client";

/**
 * The officer-to-office note on the inbox page.
 *
 * Goes through `/api/notifications`, which now routes it into the event catalog as `direct_note`.
 * The author keeps their own title: "Question about February" tells the secretary what to open,
 * which a generic "Message from the parish office" does not.
 */
export function DirectMessageForm({
  recipientLabel,
}: {
  recipientLabel: string;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ title: title.trim(), body: body.trim() || undefined }),
      });
      // The route answers errors as an envelope (`{ ok: false, error: { code, message } }`), so
      // `j.error` is an object, not a string. Rendering it directly threw "Objects are not valid as a
      // React child". `messageOf` reads the real reason, and the catch covers a network failure,
      // which used to fail silently on this form.
      const env = await readEnvelope(res);
      if (!res.ok || !env || !env.ok) {
        setError(messageOf(env, "Could not send the message."));
        return;
      }
      setTitle("");
      setBody("");
      setMsg(`Sent to the ${recipientLabel}.`);
    } catch {
      setError("Can't reach the server. The message was not sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="mt-3 space-y-3">
      <label className="block">
        <span className="sr-only">Subject</span>
        <input
          className="w-full min-h-12 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3"
          placeholder="Subject"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
        />
      </label>
      <label className="block">
        <span className="sr-only">Message</span>
        <textarea
          className="min-h-24 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
          placeholder="Message (optional)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2000}
        />
      </label>
      {msg ? <p className="text-sm text-[var(--text-muted)]">{msg}</p> : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <button
        type="submit"
        disabled={busy || !title.trim()}
        className="min-h-12 w-full rounded-xl border border-[var(--border)] font-medium disabled:opacity-40 sm:w-auto sm:px-6"
      >
        {busy ? "Sending..." : `Send to ${recipientLabel}`}
      </button>
    </form>
  );
}
