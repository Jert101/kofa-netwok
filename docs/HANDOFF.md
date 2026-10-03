# KOFA-AMS — Deployment & Manual QA Handoff

Everything needed to take Modules 01–11 from this worktree to a live parish, plus the manual QA pass
that the module docs deliberately deferred. Nothing here is committed yet; nothing is deployed.

- **What the app is:** [`../README.md`](README.md)
- **How it was built:** [`../new md/README.md`](../new%20md/README.md) and the per-module docs

Every module's §12 says "deferred to final handoff". This file is that handoff. Sections 1–4 are
sequenced and blocking; section 5 is the manual pass.

---

## 1. Where things actually stand

Measured on this worktree, not asserted:

| Gate | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit` | clean |
| Lint | `npm run lint` | clean |
| Unit tests | `npx vitest run` | **1218 passed / 55 files** |
| DB embeds | `npm run check:embeds` | **27 embeds, all resolve** — added after three features were broken by this |
| Production build | `npm run build` | clean, all routes compiled |
| End-to-end | `npm run e2e` | **42 passed** (21 flows × 375px + 1280px); four regression tests added since, awaiting re-run |

Infrastructure, verified against the live Supabase project:

| Item | Status |
|---|---|
| Migrations `001→034` | all applied — 18/18 probes found their columns, tables and view |
| `reports` storage bucket | exists, **private**, service-role round trip verified (upload/download/delete) |
| `CRON_SECRET` | set in `.env.local` only — **not yet in Vercel** |

### What has never been done

- **Visual QA.** Not one page has been looked at by a human. The automated suite proves pages render,
  navigation works, sessions persist and themes toggle. It cannot tell you a table is unreadable, a
  button is under a thumb, or a chart is the wrong shape. Section 5 is the only thing that covers this,
  and it is the reason this document exists.
- **Deployment.** No commit, no push, no Vercel project touched.
- **Real devices.** The e2e suite is Chromium-only, at emulated widths. Real iOS Safari is untested —
  it matters because push on iOS requires the Home Screen (module 08).

### Two bugs the suite caught that are worth knowing about

Both were invisible to `tsc`, lint, and all 1209 unit tests. They are recorded because the *shape* of
each failure recurs:

1. **Every PIN was rejected.** `pin-login.ts` read settings through `getSetting`, which validates
   against the registry, and `validateSetting` rejects every `exposed: false` key. All six PIN hashes came
   back `""`. Login was completely broken for every role. Now reads via `getAllInternalSettings()`.
   Guarded by `src/lib/auth/pin-login.test.ts`.
2. **Half the e2e suite failed on phone only.** Below `md` the sidebar is a Radix `Sheet`, and a closed
   `Sheet` *unmounts* its content. Nav links were absent from the DOM, so tests failed with "element(s)
   not found" — which reads like a missing feature, not a closed drawer. Now handled by `openSidebar()`.

### Two more, found by `npm run dev` rather than by any test

Both were found by opening the app and clicking around. Neither gate in §1 could have caught them, which
is the argument for doing that before deploying rather than after.

3. **`/admin/appeals` rendered the error boundary** (and `/secretary/appeals` with it). Both server
   components passed `dayHref={(date) => ...}` — a function — into `AppealsQueuePage`, which is a client
   component. React cannot serialize a function across the server/client boundary. It threw *"Functions
   cannot be passed directly to Client Components"* and **still answered 200**, so the shell, the
   sidebar and the session all looked fine. Fixed by passing `dayPath="/admin/day"` as a string and
   building the href inside the component. Guarded by an e2e test asserting the heading, because
   "the page loaded" is not evidence the page worked.
4. **`/icon.png` and `/apple-icon.png` returned 500 on every page load.** The same images existed in both
   `public/` and `src/app/`, and Next.js treats that as a conflict. The `public/` copies were
   byte-identical duplicates (verified by hash), so they were deleted; `src/app/` is the canonical
   metadata location and already serves both paths, which is what `public/manifest.json` references.

### Three found by clicking around again — the same shape, twice over

These are the most important entries in this document, because all three shared one root cause and it is
a shape that will recur unless it is checked for deliberately.

5. **Six screens rendered permanently empty, with no error anywhere.** `jsonOk()` wraps success as
   `{ ok: true, data: … }`, but callers cast the parsed body to the fields they wanted and read them off
   the top level. `body.masses` was `undefined`, `?? []` swallowed it, and the Masses catalog came up
   empty — which read to the user as *"my Masses were deleted"*, while `POST /api/masses` answered **200**
   and the rows were in the database the whole time. Same defect in the day view, the add-session Mass
   picker, the liturgy copy-from dialog, the announcement batch suggestions, the appeals queue and the
   treasurer's batch list. Reading an error's text had the mirror problem: the message is at
   `error.message`, so `j.error` handed an **object** to a string field, which renders as
   `[object Object]` and throws *"Objects are not valid as a React child"* if it reaches a child.
6. **Creating an attendance session reported failure for sessions that were really created.**
   `AddSession` read the new id from the top level of the same envelope, so `res.ok && body?.id` was
   always false and the secretary saw *"Could not create the session"* on a successful write. Retrying
   created a second Mass for the same date. The 409 *"already exists"* path was broken the same way, so
   the id in `error.fields.existing_session_id` was never found either.
7. **Every attendance session screen returned 500 with an empty body, for every role.**
   `loadRoster` asked PostgREST to embed `attendance_sessions_archive!inner(session_date)`, which cannot
   work: `attendance_records_archive.session_id` has **no foreign key**, because the archive is keyed on
   `(id, archived_at)` and `id` alone is not unique there. PostgREST answered `PGRST200`, `loadRoster`
   threw, and nothing caught it — so the page said *"Could not load this session"* and attendance could
   not be recorded at all. `tsc`, lint and all 1218 unit tests were green throughout, because none of
   them perform a real `fetch` and none of them touch the archive tables. Fixed by reading
   `v_attendance_all` (migration 033 already joins the archive correctly in SQL), and the handler now
   catches roster failures with a real message instead of an empty 500.

### A second shape, which broke three more features — the PostgREST embed

Reporting the appeals queue as empty and the red pending-appeal dot as missing turned out to be two
bugs, and both were embeds naming a relationship that cannot exist. The archive one in entry 7 was
already the third instance, so the pattern was finally worth naming:

8. **The per-session appeals panel said "No pending appeals for this Mass" for a Mass that had one.**
   `pendingItemsForSession` selected `attendance_appeals!inner(..., members!inner(full_name))`. An
   appeal header is *per Mass* and carries only a note; the member lives on the appeal **item**. The
   embed was therefore impossible, the query threw `PGRST200`, and the panel rendered its empty state —
   which reads as "nothing to do" rather than "something broke". The member's note was missing from the
   payload entirely, so the reviewer could see *that* someone disagreed but never *why*.
9. **The calendar showed no red dot and no session counts, on every role's home page.**
   `AttendanceCalendar` read `/api/attendance/month-indicators` as a flat body, but the route answers
   `{ ok: true, data: … }` — the envelope defect from entry 5, tenth occurrence. `data.indicators` was
   `undefined`, `?? []` swallowed it, and the calendar rendered *nothing*. `today` and `locked` were
   undefined too, so the highlight and the report-lock banner were silently dead on `/secretary`,
   `/admin`, `/member` and `/officer` alike. The route had been reporting `pending_appeals: 1` the
   whole time.
10. **Every payments route failed, and voiding a payment always said "Could not load that payment."**
    `/api/admin/payments`, `/api/treasurer/payments/csv` and `/api/treasurer/payments/[id]/void` all
    embedded a bare `members(full_name)`. `payments` has **three** foreign keys to `members` —
    `member_id`, `recorded_by_member_id`, `voided_by_member_id` — so the embed was ambiguous and
    PostgREST answered `PGRST201`. Fixed by naming the constraint: `members!payments_member_id_fkey`.

**An embed is a string, so nothing but the database can tell you it is wrong.** `tsc` sees `string`,
lint sees nothing, and a unit test can only assert on the string that was built, never on whether the
schema can satisfy it. Three features were dead for this reason and all three looked *healthy* — a 200,
an empty list, or a generic error. So the audit is now a script rather than a habit:

    npm run check:embeds

It finds every `.from("table") … .select("…")` pair in `src/`, replays each one against PostgREST with
`limit=1`, and exits non-zero on anything the database cannot satisfy. Selects built at runtime are
reported as unchecked rather than pretending coverage is total. Run it before deploying, and after any
migration that adds or renames a foreign key — renaming one is enough to silently break every embed
that used the old name.

**The generalisable lesson, and the reason §5 exists.** All of the above failed *silently and
successfully*: 200s or uninformative errors, a healthy shell, and no failing gate. So before deploying,
click through the app rather than trusting §1 — and if a screen comes up empty, check the response shape
and the server log before assuming the data is missing.

Three durable guards now exist for these classes, all listed in §1 or §4:

- `src/lib/api/client.ts` — `readEnvelope` / `dataOf` / `messageOf` / `fieldOf`, with
  `src/lib/api/client.test.ts`. Use these instead of hand-casting a parsed body. It returns `null` for a
  body with no `ok` flag, so the routes that legitimately return bare `NextResponse.json` (several under
  `attendance/session/[id]`) are not accidentally wrapped.
- `npm run check:embeds` — replays every embed in `src/` against the live database. This is the only
  check that can catch an embed naming a relationship that does not exist, and it caught three.
- Two health-page checks — **Schema this build needs** and **Attendance read path** — which would have
  caught entries 5, 6 and 7 before a single person opened the app.

---

## 2. Before you deploy — three blocking items

### 2.1 Rotate `CRON_SECRET`

**This is blocking.** The current value was pasted into a chat log. Treat it as public. Rotate it in
both places, and they must match.

Generate a new one (this form works on Windows PowerShell 5.1; the static
`[System.Security.Cryptography.RandomNumberGenerator]::GetBytes()` overload does not exist there):

```powershell
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$newSecret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
Write-Output $newSecret
```

Then:

1. Put it in `.env.local` as `CRON_SECRET=` (that file is gitignored via `.env*`, confirmed).
2. Put the **same** value in Vercel → Project → Settings → Environment Variables → `CRON_SECRET`, for
   **all three** environments (Production, Preview, Development).
3. Redeploy. Vercel only picks up env changes on a new deployment.

If the two differ, every cron request returns 401 and all five scheduled jobs silently do nothing.

### 2.2 Confirm the other env vars are in Vercel

`.env.local` has these keys. Verify each exists in Vercel:

| Key | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | the only one that reaches the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | bypasses RLS — never commit, never paste |
| `JWT_SECRET` | yes | signs the login cookie, 16+ chars |
| `VAPID_PUBLIC_KEY` | for push | **not** `NEXT_PUBLIC_`-prefixed |
| `VAPID_PRIVATE_KEY` | for push | server-only |
| `VAPID_SUBJECT` | for push | `mailto:you@example.com` |
| `CRON_SECRET` | yes | see 2.1 |
| `IP_HASH_SALT` | optional | falls back to `JWT_SECRET` |

`VAPID_PUBLIC_KEY` is the one that goes wrong. It is **server-only** — the service worker key is fetched
at runtime from `/api/push/vapid-key`. Prefixing it with `NEXT_PUBLIC_` inlines it into the client bundle,
which is at best pointless and at worst ships the key to every visitor.

### 2.3 Commit

Nothing is committed. `git status` shows around 216 changed and untracked paths, including all of
Module 07–11 source, migrations `028–034`, `e2e/`, `playwright.config.ts`, `scripts/check-embeds.mjs`,
`docs/HANDOFF.md`, and the whole `src/lib/{system,insights,payments,comms}/` trees.

Before committing, run the embed check once more. It needs only `.env.local` and the network, and it is
the last chance to catch a query that cannot run:

```powershell
npm run check:embeds
```

`Every embed resolves.` is the pass condition. A non-zero exit lists the exact `.from()` / `.select()`
pair together with the error PostgREST returned.

Then confirm the ignore rules are doing their job — `test-results/` and
`supabase/.temp/` must **not** appear:

```powershell
git status --porcelain | Select-String "test-results|playwright-report|\.temp"
```

Empty output is the pass condition. `.env*` is already ignored, so no secret can be committed by
accident. Then branch, commit, push, open a PR.

---

## 3. Deploy

1. **Migrations first.** They are already applied, but if you ever point at a *fresh* Supabase project,
   run `001→034` in order in the SQL Editor **before** the first deploy. Order matters and the SQL
   Editor commits between statements — never wrap them in a transaction with `ON COMMIT DROP`, or
   everything evaporates at once.
   - The SQL Editor's error message omits the failing statement. Click **Details** for the `LINE n`
     pointer before suspecting the statement immediately above it.
2. **Deploy.** Vercel → Deployments → Redeploy. Or push to the production branch.
3. **Check the crons registered.** `vercel.json` declares five schedules:

   | Path | Schedule (UTC) |
   |---|---|
   | `/api/cron/birthday` | `0 0 * * *` |
   | `/api/cron/maintenance` | `0 0 * * *` |
   | `/api/cron/sessions` | `0 0 * * 4` (Thursdays) |
   | `/api/cron/liturgy-reminders` | `0 10 * * *` |
   | `/api/cron/sweep` | `30 0 * * *` |

   Hobby plans cap cron frequency; if a deploy warns about it, the schedules still register but may be
   throttled. Verify each one returns 200 from the Vercel cron log after its first fire.

---

## 4. Verify the deployment

In this order, because each step assumes the previous one worked.

1. **Health page.** Sign in as admin → `/admin/settings/system`. It lists one card per subsystem.
   Expect **"Everything looks healthy"**. Anything else names the failing check and gives a hint.
   - The Reports bucket card may legitimately read as empty — the bucket exists and is reachable, it
     just has no files until the first report is generated. Empty is not broken.
   - `CRON_SECRET` sits near the top, the bucket near the bottom.
   - **The six cron cards read as errors until each job has actually fired once.** That is correct on a
     fresh deployment and resolves on its own within the interval. Do not go hunting for a cron problem
     because of it.
   - Two checks are worth reading by name, because they are the ones that catch problems the rest of the
     page cannot see. **Schema this build needs** probes every table and view the code queries, which
     replaces the old `schema_migrations` check — that table does not exist (Supabase keeps its ledger
     outside the exposed schema, and migrations applied in the SQL Editor leave no readable trace), so it
     reported a permanent amber that meant nothing. **Attendance read path** loads a real roster, which
     is the only check that notices when a query a secretary depends on can no longer run.
2. **Sign in as each of the six roles.** Each lands on its own home. Staff are asked "Who's using this
   device?" first — that is AUTH-4 working, not a bug. `member` skips it.
3. **Deep link while signed out.** Open `/admin` in a private window. You must be redirected to
   `/login`. A 404 or an error page here means the route guards are broken.
4. **Regression check.** If you have the PINs in a shell:
   ```powershell
   $env:E2E_PIN_ADMIN="..."; $env:E2E_PIN_SECRETARY="..."   # etc.
   $env:E2E_BASE_URL="https://your-app.vercel.app"
   npm run e2e
   ```
   `E2E_BASE_URL` makes Playwright skip the local build and test the deployment instead. The PINs are
   session-only env vars, never `.env.local`, so they never land in a file.

---

## 5. Manual QA

### 5.1 How to run this properly

Four dimensions. A defect in any one of them is a real defect; the automated suite covers none of them.

- **Width.** 375px (phone — most use is on a phone, right after Mass) and 1280px (desktop).
  On phone the sidebar is a closed drawer: **tap the ☰ "Open menu" first**, or the nav appears to be
  missing entirely. This is the single most common false alarm below.
- **Theme.** Light and dark, via the theme switch in the sidebar footer. Check both at both widths.
- **Role.** Six roles. Sensitive figures are enforced in the API, not hidden in the UI, so you can test
  access control by URL as well as by navigation.
- **Print.** Reports and liturgy sheets and payment receipts are meant to be printed. Use the browser's
  print preview at A4, not just the screen.

Keep two browsers side by side (or a phone and a laptop). Several checks are specifically about two
sessions disagreeing, which a single browser cannot express.

### 5.2 Cross-cutting

- [ ] Every page in every role at 375px and 1280px, light and dark. Nothing overflows horizontally, no
      text collides with an icon, no tap target under ~44px.
- [ ] The phone drawer opens, traps focus, and closes on Escape and on backdrop tap.
- [ ] Every form: loading, empty and error states. Submit something invalid and confirm the error is
      legible and does not clear your input.
- [ ] Deep-link every route while signed out, and while signed in as the *wrong* role. The wrong role must
      be refused — this is the check that catches a layout guard that renders before it authorizes.
- [ ] Print preview (A4) for: monthly report, liturgy sheet, payment receipt.
- [ ] Hard-refresh on every page. A hydration warning shows in the console; the theme one is silenced by
      `suppressHydrationWarning` on `<html>` and is expected.

### 5.3 Auth & security (module 02)

- [ ] Sign in as each role. Staff get the "Who's using this device?" dialog with **no Skip**; `member`
      does not. This asymmetry is the spec, and it is what the e2e suite now asserts explicitly.
- [ ] Wrong PIN five times. Confirm the block, and that it lifts after the window — **15 minutes**, not
      one. `retryAfterSeconds` counts from the oldest in-window failure. A correct PIN does **not**
      bypass it. Separately, 30 failures/hour from anywhere adds a 2-second delay; that is a delay, not a
      lockout.
- [ ] `/admin/audit` — perform one action from each area and find every one of them.
- [ ] Registration rate limit: POST `/register` in a loop. It is limited.

### 5.4 Registration & members (module 03)

- [ ] Register on a phone, copy the reference code, check status from another browser.
- [ ] Approve → reject → back to pending → approve again.
- [ ] Import a file with 3 good rows, 1 duplicate, 1 bad date, 1 unknown batch. Only the good rows land;
      each bad row says why.
- [ ] Open the profile of a member whose month was archived. History is complete.
- [ ] Deactivate someone who is on a planned liturgy. The planner still opens.

### 5.5 Masses & attendance (module 04)

- [ ] Two phones on the same session, marking different people. Refresh both — the counts agree.
- [ ] Airplane mode mid-encoding, then reconnect.
- [ ] Generate a report, return to that month's session: read-only. Reject the report as super admin: the
      month is editable again.
- [ ] Open a session as each role and confirm exactly what is editable.
- [ ] Rotate the phone. Search and the counter stay usable.

### 5.6 Appeals (module 05)

- [ ] Member submits an appeal → secretary approves → the member's page updates.
- [ ] **Open the Mass from the queue and confirm the appeal is listed there with the member's note
      visible.** This is the path that was broken: the panel reported "No pending appeals for this Mass"
      for a Mass that had one, because the query threw rather than returning nothing.
- [ ] **Confirm a red dot appears on the calendar for a date with a pending appeal**, on the secretary
      home page *and* the admin one. The dot's data was being discarded before it reached the calendar.
- [ ] Approve-all with 10 items while a second reviewer rejects one. The result is consistent.
- [ ] Enable auto-approve, submit. The record appears with source `appeal_auto`.
- [ ] Lock the month and try every action in the module.
- [ ] Phone: the appeal form and the result dialog are usable one-handed.

### 5.7 Reports (module 06)

- [ ] With a super admin PIN: generate → pending → reject with a reason → regenerate → approve →
      download → archive.
- [ ] With no super admin PIN: the report is approved at once.
- [ ] Generate with a pending appeal, as secretary and as admin.
- [ ] Open the review view on a phone.
- [ ] Download an **old (inline)** and a **new (stored)** PDF. Both must open. `pdf_storage_kind` is the
      discriminator — this is decision D-4 and both paths have to keep working.
- [ ] Print the monthly report at A4 and confirm nothing is clipped or orphaned.

### 5.8 Liturgy (module 07)

- [ ] Plan next Sunday for two Masses, copy Mass 1 into Mass 2, edit, save.
- [ ] Create the session on the day; rows were seeded from the plan.
- [ ] Reorder on a phone using touch.
- [ ] Print the sheet and check the layout.
- [ ] Sign in as a member; find a name in upcoming assignments.
- [ ] Two browsers on one Mass: the second save wins and **says it overwrote the first**. Module 07 is
      last-save-wins by design and returns a stale status rather than a 409 — it must tell you, not
      silently discard.
- [ ] Rename a template to another template's name differing only in case. It must be rejected.

### 5.9 Announcements & notifications (module 08)

- [ ] Two browsers, super admin and secretary. Generate a report. **Only the super admin** is notified.
- [ ] Post to Everyone and to one batch. Check what a member in a *different* batch sees.
- [ ] Block notifications at the browser level, then open the settings page — it must degrade gracefully.
- [ ] iOS Safari before and after adding to Home Screen. Push on iOS requires the Home Screen; this is
      the one thing the Chromium-only suite cannot check.
- [ ] Run the sweep and confirm expired items vanish.

### 5.10 Payments (module 09)

- [ ] **Treasurer/admin: list payments, download CSV, and void a payment.** Voiding and listing both
      broke because the `payments→members` embed was ambiguous (three FKs) and has been disambiguated.
- [ ] Flow E end to end: create a structure, take partial payments, hit an accidental duplicate, void
      it, print the PDF.
- [ ] Try to edit a payment amount after the fact. It must be refused; corrections go through void.
- [ ] Sign in as secretary and as member and search someone's balance. Per **D-9**, only treasurer and
      admin see all peso balances; everyone else sees structure names and a paid-up flag with no amount.
      Enforced in the API — so also try it by URL, not just by looking at the page.
- [ ] Phone: record three payments in a row, quickly.
- [ ] Confirm `amountDueByDate()` proration on an installment structure. `balance()` deliberately keeps
      the **old flat formula** — that was decision D-7, and the two are not the same thing.

### 5.11 Dashboards & insights (module 10)

- [ ] Compare three dashboard numbers against a manual count.
- [ ] Archive a month and reload. Nothing changes — archived data is a historical snapshot.
- [ ] Every dashboard at 375px in dark mode. Charts are hand-rolled SVG, so check the strokes and labels
      are legible at that size rather than assuming a chart library handled it.
- [ ] Empty database: every card has a sensible empty state, not a zero or a spinner forever.

### 5.12 Settings & system (module 11)

- [ ] Change the church name, generate a report preview, confirm the header changed.
- [ ] Break `CRON_SECRET` on staging; confirm the health page reports it. **Then fix it.**
- [ ] `/admin/settings/backup` — download a backup and open two of the CSVs in a spreadsheet.
- [ ] Change the timezone; confirm the report window display changes. All schedule math uses this
      setting, never server-local.

---

## 6. If something fails

| Symptom | Cause |
|---|---|
| Every PIN rejected, "That PIN isn't right." | Settings read through `getSetting`, which drops `exposed: false` keys. Use `getAllInternalSettings()`. Guarded by `pin-login.test.ts`. |
| Nav looks empty on a phone | The drawer is closed. Tap ☰ "Open menu". Not a bug. |
| Sign-in "does nothing", URL stays `/login` | The AUTH-4 actor dialog is unanswered. It renders on `/login` itself. |
| `TypeError: routesManifest.dataRoutes is not iterable` | `npm run dev` (Turbopack) wrote a `.next` that `next start` cannot read. Build before starting, or `rm -r .next`. |
| Cron returns 401 | `CRON_SECRET` differs between `.env.local` and Vercel, or Vercel has not been redeployed since rotating. |
| PostgREST 400 "column … does not exist" | A migration is missing. See §3.1 — it fails at runtime, not at startup. |
| Suite fails with 429s | Wrong PINs. Wait out the full 15-minute window; a minute changes nothing. |
| `member` passes, all other roles time out | The actor step (see row 3), or the drawer on phone. |
| A page shows an error boundary but the response was **200** | A function was passed from a server component into a client one. Pass a string and build the value inside the client component. |
| `/icon.png` or `/apple-icon.png` returns 500 | The same image exists in both `public/` and `src/app/`, which Next.js treats as a conflict. Keep only `src/app/`. |

---

## 7. Not done, and deliberately so

Per the modules' "Out of scope" sections: restore-from-backup, multi-parish, logo upload, UI theme
editing, per-person accounts or 2FA, email/SMS, WebKit and Firefox engines, and real-device CI. The
last one is the real gap in automated coverage — the suite runs Chromium only, on the judgement that a
parish app's failures are layout and wiring failures rather than engine-specific ones.