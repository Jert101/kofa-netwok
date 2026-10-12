"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  dataOf,
  messageOf,
  readEnvelope,
  type Envelope,
} from "@/lib/api/client";
import {
  BODY_MAX,
  type ModeratorPostView,
  type PostView,
} from "@/lib/freedom-wall/wall";

type Feed = {
  posts: PostView[];
  can_post: boolean;
  remaining_today: number;
  max_per_day: number;
};

type ModerationFeed = Omit<Feed, "posts"> & { posts: ModeratorPostView[] };

/** A wall post is shown exactly as it was written, so line breaks survive. */
function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * The Freedom Wall as the ministry reads it.
 *
 * There is no name on a post and no way for this component to grow one: the
 * payload it receives (`PostView`) has no author field, and the server builds it
 * with a function whose return type has nowhere to put one. Removing your own
 * post is offered because the button is driven by a boolean the server sent --
 * `can_delete`, true for your posts and the moderator's, which reveals nothing
 * about anybody else's. The admin role is sent `false` throughout: it removes
 * nothing from the wall.
 */
export function FreedomWall() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/freedom-wall", { credentials: "same-origin", cache: "no-store" });
      const env: Envelope<Feed> | null = await readEnvelope<Feed>(res);
      setFeed(dataOf(env));
      setError(env && !env.ok ? messageOf(env, "The Freedom Wall could not be loaded.") : null);
    } catch {
      setFeed(null);
      setError("The Freedom Wall could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/freedom-wall", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const env: Envelope<{ id: string }> | null = await readEnvelope<{ id: string }>(res);
      if (env && !env.ok) {
        setError(messageOf(env, "The post could not be saved."));
      } else {
        setDraft("");
        await load();
      }
    } catch {
      setError("The post could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/freedom-wall/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const env = await readEnvelope<unknown>(res);
      if (env && !env.ok) setError(messageOf(env, "The post could not be removed."));
      else await load();
    } catch {
      setError("The post could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  const remaining = feed?.remaining_today ?? 0;
  const overLimit = draft.trim().length > BODY_MAX;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--brand)]">Write something</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Say what is on your mind about the ministry. Your name is not shown with it.
        </p>
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          maxLength={BODY_MAX}
          placeholder="Anything at all."
          className="mt-3"
          aria-label="Your message"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className={`text-xs ${overLimit ? "text-[var(--danger-text)]" : "text-[var(--text-muted)]"}`}>
            {overLimit
              ? `${draft.trim().length} of ${BODY_MAX} characters`
              : `${draft.trim().length} of ${BODY_MAX}`}
          </p>
          <Button onClick={post} disabled={busy || !feed?.can_post || remaining === 0 || draft.trim().length === 0 || overLimit}>
            {busy ? "Posting..." : "Post"}
          </Button>
        </div>
        {feed && feed.can_post && remaining === 0 ? (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            You have written {feed.max_per_day} posts in the last day. The wall is still yours to read.
          </p>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--brand)]">The wall</h2>
        {feed === null ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">Loading the wall...</p>
        ) : feed.posts.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--text-muted)]">Nothing has been written yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {feed.posts.map((p) => (
              <li key={p.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{p.body}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-muted)]">Anonymous · {when(p.created_at)}</p>
                  {p.can_delete ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => remove(p.id)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The same wall for the super admin: hidden posts included, the writer named.
 *
 * The extra fields arrive from `GET /api/freedom-wall?moderation=1`, which is
 * refused for any other role. The two lists share a card so a hidden post cannot
 * quietly look different from a visible one in a way that matters.
 */
export function FreedomWallModeration() {
  const [feed, setFeed] = useState<ModerationFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/freedom-wall?moderation=1", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const env: Envelope<ModerationFeed> | null = await readEnvelope<ModerationFeed>(res);
      setFeed(dataOf(env));
      setError(env && !env.ok ? messageOf(env, "The Freedom Wall could not be loaded.") : null);
    } catch {
      setFeed(null);
      setError("The Freedom Wall could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, kind: "hide" | "restore" | "delete") {
    setBusy(true);
    try {
      const res = await fetch(`/api/freedom-wall/${id}`, {
        method: kind === "delete" ? "DELETE" : "PATCH",
        credentials: "same-origin",
        ...(kind === "delete" ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify({ hidden: kind === "hide" }) }),
      });
      const env = await readEnvelope<unknown>(res);
      if (env && !env.ok) setError(messageOf(env, "That did not work."));
      else await load();
    } catch {
      setError("That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--brand)]">Freedom Wall moderation</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Every post with the person who wrote it. Only you can see this page. Hiding a post keeps it and
          puts it back on the wall; removing it deletes it.
        </p>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        {feed === null ? (
          <p className="text-sm text-[var(--text-muted)]">Loading the wall...</p>
        ) : feed.posts.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">Nothing has been written yet.</p>
        ) : (
          <ul className="space-y-2">
            {feed.posts.map((p) => (
              <li
                key={p.id}
                className={`rounded-xl border p-3 ${
                  p.hidden
                    ? "border-[var(--danger-text)] bg-[var(--surface-2)]"
                    : "border-[var(--border)] bg-[var(--surface-2)]"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{p.body}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-[var(--text-muted)]">
                    {p.author_name} ({p.author_role}) · {when(p.created_at)}
                    {p.hidden ? " · hidden" : ""}
                  </p>
                  <div className="flex gap-2">
                    {p.hidden ? (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => act(p.id, "restore")}>
                        Restore
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => act(p.id, "hide")}>
                        Hide
                      </Button>
                    )}
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => act(p.id, "delete")}>
                      Remove
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
