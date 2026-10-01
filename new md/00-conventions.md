# 00 — Conventions

Rules every module follows. If a module doc conflicts with this file, this file wins unless the module doc says why.

## 1. Folder structure

Group code by feature, not by file type. Route files stay thin.

```txt
src/
  app/
    (role folders)/…            # pages: fetch, compose, render. No business rules here.
    api/…                       # route handlers: guard, validate, call feature server code, respond
  features/
    <module>/
      components/               # UI for this module only
      hooks/                    # client hooks (queries, mutations)
      schemas.ts                # Zod schemas shared by client and server
      server/                   # server-only code: queries, rules, RPC wrappers
      types.ts
  components/
    ui/                         # shadcn output. Do not hand-edit except for theme fixes.
    layout/                     # AppShell, MobileTabBar, PageHeader
    shared/                     # DataTable, EmptyState, ConfirmDialog, BlockingOverlay, StatusBadge
  lib/                          # cross-cutting: auth, api, audit, settings, supabase, dates
```

Module names in `features/`: `auth`, `members`, `registrations`, `attendance`, `appeals`, `reports`, `liturgy`, `comms`, `payments`, `insights`, `settings`.

## 2. API conventions

Success and error responses share one shape. Helpers live in `src/lib/api/response.ts`.

```ts
// success
{ ok: true, data: T }
// failure
{ ok: false, error: { code: string, message: string, fields?: Record<string, string> } }
```

- `message` is safe to show to the user. It says what went wrong and what to do.
- `code` is stable and machine-readable (`REPORT_LOCKED`, `PIN_IN_USE`, `RATE_LIMITED`).
- HTTP status stays meaningful: 400 validation, 401 not signed in, 403 wrong role, 404 missing, 409 conflict or locked, 429 throttled.
- Every route calls `requireRole()` first, then validates with Zod, then acts. Public routes are marked and throttled.
- Lists accept `page`, `pageSize` (max 100), `q`, `sort` (`field:asc|desc`) and return `{ items, total, page, pageSize }` inside `data`.
- Migrate a route to the new shape in the same change as the screen that calls it. Shared routes used by many screens (`/api/members/search`) keep their old shape until every caller is moved.

## 3. Validation

- One Zod schema per input, exported from the feature's `schemas.ts`.
- The form and the route handler import the same schema.
- Trim strings. Normalize names (collapse spaces) and phone numbers before validation.

## 4. Data access and client state

- Server components and route handlers use the service-role Supabase client only (`lib/supabase/admin.ts`). No client-side Supabase writes.
- Interactive screens use TanStack Query (decision D-3). Query keys: `[module, entity, params]`.
- After a mutation, invalidate the smallest set of keys that changed. Do not refetch the whole page.
- Multi-step writes that must not partially succeed go in a Postgres function (RPC), not several client calls.

## 5. UI conventions

- Components: shadcn/ui. Forms: React Hook Form with the Zod resolver. Tables: shadcn Table with TanStack Table. Toasts: Sonner.
- **Feedback**: success and minor errors are toasts. Blocking problems and destructive confirmations use a dialog. Never fail silently.
- **Destructive actions** use `AlertDialog` with a button that names the action ("Void payment"), not "OK".
- **Blocking overlay** (`BlockingOverlay`) wraps only multi-write actions where a double tap could corrupt data: approve all, generate report, replace roster. It also sets `aria-busy` and a `beforeunload` guard while in flight.
- **Touch targets** are at least 44 px high.
- **Copy**: sentence case, active voice, buttons say what happens ("Save changes", "Approve all 4"). Errors say what happened and how to fix it. Do not apologize in errors.
- **States**: every list and card has a skeleton (loading), an empty state with a next action, and an error state with retry.
- **Dark mode** and 375 px width are checked for every screen before it merges.
- **Accessibility**: labelled inputs, visible focus, dialogs trap focus, status changes announced with `aria-live`, color is never the only signal (badges also carry text).

## 6. Dates and time

- All schedule math uses church time from `lib/settings`. Never use server-local time.
- `session_date`, `paid_at`, `date_of_birth` are calendar dates (no time). Compare birthdays by `MM-DD` strings.
- Timestamps are stored as UTC `timestamptz` and shown in church time.
- Put date rules in pure functions taking `now` as a parameter so tests can control it.

## 7. Migrations

- Additive and idempotent (`IF NOT EXISTS`, `ON CONFLICT`). Numbered after `022`.
- One migration file per module, listed below. A module that needs a second change adds a lettered file (`025b_…`).
- Never drop a column with data in the same release that stops using it.

| No. | Module | Contents |
|---|---|---|
| 023 | 02 Auth & security | `audit_log` |
| 024 | 02 Auth & security | `login_attempts` |
| 025 | 03 Registration & members | registration reference codes and reasons, member deactivation fields |
| 026 | 04 Masses & attendance | mass ordering and default time, record source and timestamps |
| 027 | 05 Appeals | appeal history fields and `expired` status, atomic approve function |
| 028 | 06 Reports | review note, partial unique month index, storage kind |
| 029 | 07 Liturgy | `liturgy_positions` |
| 030 | 08 Announcements & notifications | audience, pinning, dedupe key, notification links, push targeting |
| 031 | 09 Payments | void reason and audit fields, indexes |
| 032 | 10 Dashboards | union views and indexes |
| 033 | 11 Settings & system | `cron_runs` |

## 8. Audit logging

- Call `logAudit({ action, entityType, entityId, meta })` from the route handler after the change succeeds. It never throws; a logging failure must not fail the request.
- Action names are `noun_verb` in snake case: `member_deactivated`, `report_approved`.
- `meta` holds counts and ids, never PINs, hashes or full personal details.
- The full action list is in [02-auth-security.md](02-auth-security.md).

## 9. Testing

Three layers. Tooling is set up in module 01.

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Vitest | Pure rules: report window, lock guard, proration, insight metrics, name normalization, PIN rules |
| API | Vitest + route handler calls against a test Supabase project | Role guards, validation errors, state transitions |
| End to end | Playwright at 375 px and 1280 px | One smoke flow per module, listed in each module's QA checklist |

Every module doc lists the unit tests that must exist. A rule without a test is not done.

## 10. Definition of done (every module)

- All acceptance criteria pass.
- Unit tests for the module's rules pass. The Playwright smoke flow passes.
- `npm run lint` and `npm run build` pass with no TypeScript errors.
- Checked at 375 px and 1280 px, light and dark, keyboard only.
- Role guards verified: each forbidden role gets 403 from the API and a redirect from the page.
- Audit entries appear for every listed action.
- Old pages, components and routes replaced by this module are deleted.
- System reference `docs/README.md` updated for changed routes, API and schema.
- Migration applied to a copy of production data without errors.

## 11. Release checklist per module

1. Apply the migration to staging. Run it twice to confirm idempotency.
2. Deploy. Run the Playwright smoke flow against staging.
3. Have one real user per affected role try the main task on a phone.
4. Deploy to production. Watch logs for one day.
5. Delete the old code path.
