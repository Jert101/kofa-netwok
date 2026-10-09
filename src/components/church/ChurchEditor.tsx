"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PhotoField } from "@/components/church/PhotoField";
import { initialsOf, type CouncilMember } from "@/lib/church/profile";

/**
 * Read an error out of a failed response.
 *
 * Two shapes, because the API is mid-standardisation: the envelope helpers answer `{ok:false, error:
 * {message}}` and a few older paths answer `{error: "text"}`. Handling only one means a real message is
 * swallowed and the officer is told "something went wrong" about a request that said exactly what was
 * wrong. Pure, and both shapes are checked rather than one being assumed.
 */
function errorMessageFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const { error } = body as { error?: unknown };
  if (typeof error === "string" && error.trim()) return error;
  if (typeof error === "object" && error !== null) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string" && message.trim()) return message;
  }
  return null;
}

/**
 * The super admin's editor for everything the landing page shows about the parish.
 *
 * Profile and council in one screen because they are one page: an officer publishing a new priest and a
 * new council together is doing one job, and splitting it across two screens means the parish is briefly
 * half-updated in public.
 *
 * Saves are per-row for the council and one-shot for the profile, on purpose. The council is a list that
 * grows and shrinks one seat at a time -- reordering or vacating a seat should not require touching the
 * biography, and a single Save over a list means one person's typo can block everyone's edit.
 */
export function ChurchEditor() {
  const [priest, setPriest] = useState("");
  const [headline, setHeadline] = useState("");
  const [about, setAbout] = useState("");
  const [priestPhoto, setPriestPhoto] = useState<string | null>(null);
  const [council, setCouncil] = useState<CouncilMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [profileBusy, setProfileBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * The new-member form.
   *
   * It asks for the name *before* the row exists, because the API refuses a nameless member and this
   * used to create one anyway: "Add a member" posted `name: ""`, was answered with 400, and the refusal
   * was reported as a blanket "Could not add a council member". A blank row was never a state worth
   * reaching -- it is unpublishable, so it can only ever be a mistake -- and now it cannot be created.
   */
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newOffice, setNewOffice] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/church", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error();
      const body = (await res.json()) as {
        data?: {
          priest_name: string | null;
          headline: string | null;
          about: string | null;
          photo_url?: string | null;
          council: CouncilMember[];
        };
      };
      const d = body.data;
      setPriest(d?.priest_name ?? "");
      setHeadline(d?.headline ?? "");
      setAbout(d?.about ?? "");
      setPriestPhoto(d?.photo_url ?? null);
      // Inactive members are filtered out of the public read, so this list is "who is on the council
      // now". Vacating somebody removes them here; the row survives in the database for the seat.
      setCouncil(d?.council ?? []);
    } catch {
      setError("Could not load the parish profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveProfile = async () => {
    setProfileBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/church", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priest_name: priest,
          headline: headline,
          about: about,
          photo_url: priestPhoto,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) {
        setError(errorMessageFrom(body) ?? "Could not save the profile.");
        return;
      }
      setNotice("Saved. The landing page shows it now.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setProfileBusy(false);
    }
  };

  /**
   * Clear the priest's photograph.
   *
   * A separate PUT rather than folded into the profile Save, so removing a picture is one click instead of
   * "clear the field, then remember to press Save" -- and the landing page stops showing it immediately
   * rather than after the next visit that happens to hit Save.
   */
  const patchPriestPhoto = async (next: string | null) => {
    // Captured before anything changes, because it is what a refusal has to put back.
    const previous = priestPhoto;
    setPriestPhoto(next);
    setRowBusy("priest-photo");
    setError(null);
    try {
      const res = await fetch("/api/church", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priest_name: priest,
          headline: headline,
          about: about,
          photo_url: next,
        }),
      });
      if (!res.ok) {
        setPriestPhoto(previous);
        setError("Could not remove the photograph.");
        return;
      }
      setNotice("Photograph removed.");
    } catch {
      setPriestPhoto(previous);
      setError("Could not reach the server.");
    } finally {
      setRowBusy(null);
    }
  };

  const addMember = async (name: string, office: string) => {
    setRowBusy("new");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/church/council", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, office, bio: "" }),
      });
      const body = (await res.json().catch(() => ({}))) as unknown;
      const member = (body as { data?: { member?: CouncilMember } } | undefined)?.data?.member;
      if (!res.ok || !member) {
        // The server's own words. This used to say "Could not add a council member" and nothing else,
        // which is the one answer that helps nobody: a refused name and a database that has not had
        // its migration applied look identical from here.
        setError(errorMessageFrom(body) ?? "Could not add a council member.");
        return false;
      }
      setCouncil((prev) => [...prev, member]);
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setRowBusy(null);
    }
  };

  const patchMember = async (id: string, patch: Partial<CouncilMember>) => {
    setRowBusy(id);
    setError(null);
    setNotice(null);
    // Optimistic, then reverted from the response. A list that snaps back a second after a click reads
    // as the page ignoring you, which is worse than a brief lag.
    const before = council;
    setCouncil((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    try {
      const res = await fetch(`/api/church/council/${encodeURIComponent(id)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown;
        setCouncil(before);
        setError(errorMessageFrom(body) ?? "Could not save that change.");
        return;
      }
    } catch {
      setCouncil(before);
      setError("Could not reach the server.");
    } finally {
      setRowBusy(null);
    }
  };

  const removeMember = async (id: string, name: string) => {
    if (!window.confirm(`Remove ${name} from the council? This deletes the row, rather than marking them as having left.`)) {
      return;
    }
    setRowBusy(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/church/council/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as unknown;
        setError(errorMessageFrom(body) ?? "Could not remove that council member.");
        return;
      }
      setCouncil((prev) => prev.filter((m) => m.id !== id));
      setNotice(`Removed ${name}.`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRowBusy(null);
    }
  };

  if (loading) return <p className="text-sm text-[var(--text-muted)]">Loading the parish profile…</p>;

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="rounded-xl border border-[var(--danger)] p-3 text-sm text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-[var(--text-muted)]">
          {notice}
        </p>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-medium">The parish</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Shown at the top of the public landing page. Anything left blank simply does not appear — the
          page never shows an empty heading.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Headline</span>
            <input
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={200}
              placeholder="e.g. Serving the altar since 1952"
              className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
            />
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              The big line. Leave blank to use the app&apos;s own description.
            </span>
          </label>

          <div>
            <span className="text-sm font-medium">Parish priest</span>
            <input
              value={priest}
              onChange={(e) => setPriest(e.target.value)}
              maxLength={160}
              placeholder="e.g. Fr. John Santos"
              aria-label="Parish priest"
              className="mt-1 min-h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
            />
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              Free text — the parish priest does not need an account here. Clear it if the post is vacant.
            </span>
            {/* Uploads as soon as it is chosen rather than waiting for the Save below, so a photograph
                is never lost because the name was not filled in. */}
            <div className="mt-3">
              <PhotoField
                photoUrl={priestPhoto}
                personName={priest}
                scope="priest"
                size="lg"
                onUploaded={(url) => {
                  setPriestPhoto(url);
                  setNotice("Photograph uploaded.");
                }}
                onRemoved={() => void patchPriestPhoto(null)}
              />
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-medium">About the ministry</span>
            <textarea
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              maxLength={4000}
              rows={8}
              placeholder="The ministry's background, its history, who it serves…"
              className="mt-1 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-base"
            />
            <span className="mt-1 block text-xs text-[var(--text-muted)]">
              Leave a blank line between paragraphs.
            </span>
          </label>

          <Button onClick={() => void saveProfile()} disabled={profileBusy}>
            {profileBusy ? "Saving…" : "Save the parish"}
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">Council</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Each row saves as you leave it. Names are published to anyone who opens the landing page.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAddingNew(true);
              setNewName("");
              setNewOffice("");
            }}
            disabled={addingNew}
          >
            <Plus aria-hidden />
            Add a member
          </Button>
        </div>

        {addingNew ? (
          <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (required)"
                aria-label="Name of the new council member"
                // The whole point of the form: without a name there is nothing to save.
                autoFocus
                className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
              />
              <input
                value={newOffice}
                onChange={(e) => setNewOffice(e.target.value)}
                placeholder="Office, e.g. Council President (optional)"
                aria-label="Office of the new council member"
                className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
              />
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                disabled={newName.trim().length === 0 || rowBusy === "new"}
                onClick={() => {
                  void addMember(newName.trim(), newOffice.trim()).then((ok) => {
                    // Kept open on failure so the name is not lost and retyped; closed on success.
                    if (ok) setAddingNew(false);
                  });
                }}
              >
                {rowBusy === "new" ? "Adding…" : "Add to the council"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAddingNew(false)}
                disabled={rowBusy === "new"}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {council.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            No council listed. The landing page omits the section entirely rather than showing an empty one.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {council.map((m) => (
              <li key={m.id} className="rounded-xl border border-[var(--border)] p-3">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-xs font-semibold text-[var(--brand-text)]"
                  >
                    {m.name.trim() ? initialsOf(m.name) : "?"}
                  </span>
                  <input
                    value={m.name}
                    onChange={(e) =>
                      setCouncil((prev) => prev.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)))
                    }
                    onBlur={(e) => {
                      const next = e.target.value.trim();
                      // Saving an empty name is refused by the API, so do not send it. An untouched
                      // field must not fire a change either, or leaving the page nags.
                      if (next === m.name.trim() || next.length === 0) return;
                      void patchMember(m.id, { name: next });
                    }}
                    placeholder="Name"
                    aria-label={`Name of ${m.name || "this council member"}`}
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-base"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void removeMember(m.id, m.name || "this member")}
                    disabled={rowBusy === m.id}
                    aria-label={`Remove ${m.name || "this council member"}`}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>

                <div className="flex items-center gap-3">
              <PhotoField
                photoUrl={m.photo_url ?? null}
                personName={m.name}
                scope="council"
                memberId={m.id}
                onUploaded={(url) => {
                  setCouncil((prev) => prev.map((x) => (x.id === m.id ? { ...x, photo_url: url } : x)));
                  setNotice("Photograph uploaded.");
                }}
                onRemoved={() => void patchMember(m.id, { photo_url: "" })}
              />
            </div>

            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input
                    value={m.office ?? ""}
                    onChange={(e) =>
                      setCouncil((prev) => prev.map((x) => (x.id === m.id ? { ...x, office: e.target.value } : x)))
                    }
                    onBlur={(e) => {
                      if ((e.target.value ?? "") === (m.office ?? "")) return;
                      void patchMember(m.id, { office: e.target.value });
                    }}
                    placeholder="Office, e.g. Council President"
                    aria-label={`Office of ${m.name || "this council member"}`}
                    className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                  />
                  <input
                    value={m.bio ?? ""}
                    onChange={(e) =>
                      setCouncil((prev) => prev.map((x) => (x.id === m.id ? { ...x, bio: e.target.value } : x)))
                    }
                    onBlur={(e) => {
                      if ((e.target.value ?? "") === (m.bio ?? "")) return;
                      void patchMember(m.id, { bio: e.target.value });
                    }}
                    placeholder="One line about them (optional)"
                    aria-label={`Note about ${m.name || "this council member"}`}
                    className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}