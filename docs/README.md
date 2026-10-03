# KOFA-AMS — Knights of the Altar Attendance Management System

**Version 1.0** · Status: Implemented (MVP complete) · Stack: Next.js 15 App Router + React 19 + Supabase

This is the single, complete system reference: product intent, role model, feature-by-feature requirements (FR-level), user flows, schema, API surface, and operational notes.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Goals, Success Metrics & Scope](#2-goals-success-metrics--scope)
3. [Users & Roles](#3-users--roles)
4. [Authentication & Access Control](#4-authentication--access-control)
5. [Functional Requirements — Feature by Feature](#5-functional-requirements--feature-by-feature)
6. [User Flows](#6-user-flows)
7. [Data Model](#7-data-model)
8. [API Surface](#8-api-surface)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Tech Stack & Architecture](#10-tech-stack--architecture)
11. [Cron / Scheduled Work](#11-cron--scheduled-work)
12. [Out of Scope (Post-MVP)](#12-out-of-scope-post-mvp)
13. [Deployment & Environment](#13-deployment--environment)
14. [Known Behaviors & Edge Cases](#14-known-behaviors--edge-cases)
15. [Repository Snapshot](#15-repository-snapshot)

---

## 1. Product Overview

### 1.1 Problem Statement

Parish altar-server groups (Knights of the Altar) track service attendance manually — paper sheets per Mass, monthly tallies typed into spreadsheets, and printed attendance grids submitted to the parish office. This is slow, error-prone, easy to lose, and gives members no visibility into their own service record. Coordinators also juggle liturgy assignments, announcements, dues/payments, and membership applications across disconnected tools (group chats, notebooks).

### 1.2 Solution

A mobile-first web application that digitizes the entire lifecycle:

> **Apply → Get approved → Serve at Mass → Get recorded → Appeal mistakes → Receive monthly report → Super admin signs off → Data archived.**

Plus supporting operations: liturgy scheduling with reusable templates, announcements with push notifications, dues tracking with installments, and insight dashboards (top servers, inactive members, birthdays).

### 1.3 Target Users

| Role | Description |
|---|---|
| **Admin / Moderator** | Runs the organization. Full control over members, registrations, masses, settings, and can bypass report schedules. |
| **Super Admin** | Independent signatory. Reviews generated monthly reports and formally approves or rejects them before they become official. |
| **Secretary** | Encodes attendance every Mass, reviews attendance appeals, co-owns reports within the allowed schedule window. |
| **Officer** | Plans liturgy assignments ahead of time, posts announcements. |
| **Treasurer** | Manages payment structures (dues), records and voids payments. |
| **Member (Altar Server)** | Serves at Mass; views their attendance record, submits appeals when missed, receives announcements/birthday greetings, pays dues. |

### 1.4 Design Principles

1. **Mobile-first** — primary usage is at the church, on phones, right after Mass.
2. **Shared-device friendly** — one PIN per _role_ (not per person); fast login on a shared tablet.
3. **Data safety over speed** — reports lock attendance data; archives are append-only; destructive actions are guarded.
4. **Accountability** — generated reports pass through an independent approver (super admin).
5. **Low-bandwidth tolerant** — minimal dependencies, server-rendered lists, small payloads.

---

## 2. Goals, Success Metrics & Scope

### 2.1 MVP Goals

- **G1** Replace paper attendance sheets entirely.
- **G2** Produce an official, printable monthly attendance PDF with zero manual tallying.
- **G3** Guarantee report integrity via a two-step generate→approve workflow.
- **G4** Let members self-serve corrections through appeals instead of verbal follow-ups.
- **G5** Give coordinators forward-planning tools (liturgy assignments, templates).
- **G6** Track dues without spreadsheets (structures, installments, voiding).

### 2.2 Success Metrics

| Metric | Target |
|---|---|
| Time to encode attendance for one Mass | < 60 seconds |
| Time from "generate" to signed-off monthly report | < 24 hours |
| Appeals resolved per session | 100% reviewed before month end |
| Paper forms eliminated | Registration + attendance + dues = 0 paper |

### 2.3 In Scope

All features listed in §5.

### 2.4 Out of Scope

See §12.

---

## 3. Users & Roles

### 3.1 Role Definitions

| Role | Route | Can do |
|---|---|---|
| `admin` | `/admin` | Everything: settings, PINs, members, registrations (approve/reject/bulk/edit/PDF), masses, reports (bypass schedule, previous-month backfill, archive toggle), payments view, inbox, batches, insight cards, announcements |
| `super_admin` | `/super-admin` | Sees pending monthly reports, previews the exact PDF, **approves** or **rejects** each one; sees approved history |
| `secretary` | `/secretary` | Daily driver: calendar, encode attendance per session, review appeals (incl. **Approve all**), generate reports inside the schedule window, inbox |
| `officer` | `/officer` | Calendar view, plan future liturgy assignments, use/save/load/delete liturgy templates, post announcements |
| `treasurer` | `/treasurer` | Create/edit payment structures (with batch/all scope, deadlines, installments), record payments, void payments, download per-structure status PDF |
| `member` | `/member` | Home (attendance history, birthdays), session detail (liturgy servers + full roster), submit attendance appeals, pay dues page |

### 3.2 Permission Matrix

| Action | Admin | Super Admin | Secretary | Officer | Treasurer | Member |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Change any role's PIN (incl. super admin) | ✅ | — | — | — | — | — |
| Approve/reject registration | ✅ | — | — | — | — | — |
| Encode/edit attendance | ✅¹ | — | ✅¹ | — | — | — |
| Submit appeal | — | — | — | — | — | ✅ |
| Review appeal (single / **Approve all**) | ✅ | — | ✅ | — | — | — |
| Generate monthly report (in window) | ✅² | — | ✅ | — | — | — |
| Bypass report schedule / backfill previous month | ✅ | — | — | — | — | — |
| **Approve/reject generated report** | — | ✅ | — | — | — | — |
| Download approved report PDF | ✅ | ✅ | ✅ | — | — | — |
| Archive month data | ✅ | — | — | — | — | — |
| Plan liturgy + templates | ✅ | — | — | ✅ | — | — |
| Post announcements | ✅ | — | ✅ | ✅ | — | — |
| Manage payment structures / payments | ✅³ | — | — | — | ✅ | — |
| Read inbox notifications | ✅ | ✅⁴ | ✅ | — | — | — |

¹ Locked once a report exists for that month (`guardReportNotGenerated`).
² Within the last-Sunday-after-8-PM window unless bypassing.
³ Admin has read access to treasurer data.
⁴ Receives report-pending and decision notifications.

---

## 4. Authentication & Access Control

### 4.1 Model — Role PINs (no user accounts)

- There are **no usernames, emails, or passwords**. Each role has one shared numeric PIN (4–12 chars).
- PINs are stored **bcrypt-hashed** in `system_settings` under keys `pin_admin_hash`, `pin_secretary_hash`, `pin_member_hash`, `pin_officer_hash`, `pin_treasurer_hash`, `pin_super_admin_hash`.
- Fresh installs seed all PINs to `1234`; admin is instructed (and expected) to change them immediately in Settings.

### 4.2 Login Flow

```txt
POST /api/auth/login { pin }
  → bcrypt.compare against each role hash (order: admin, secretary, member, officer, treasurer, super_admin)
  → on match: JWT { role } signed HS256 (jose), 7-day expiry
  → Set-Cookie kofa_session (httpOnly, sameSite=lax, secure in prod)
  → response { ok: true, role }
Client redirects to ROLE_PATH[role]
```

### 4.3 Session & Middleware

- Cookie name: `kofa_session`. Verified two ways:
  - **Node routes/API:** `verifySessionToken()` using `jose`.
  - **Edge middleware:** `verifySessionTokenEdge()` — dependency-free WebCrypto HMAC (identical algorithm) so middleware runs on the edge runtime.
- Middleware (`src/middleware.ts`) runs on every non-static route:
  - Skips `/login`, `/register`, `/_next`, static assets, `/api` (APIs self-guard).
  - `/` → redirect to the role's home, or `/login` when unauthenticated.
  - `/admin/*`, `/secretary/*`, `/member/*`, `/officer/*`, `/treasurer/*`, `/super-admin/*` → strict single-role checks; mismatch ⇒ redirect to `/login`.
  - Unknown paths ⇒ `/login`.
- **API authorization:** every API route independently calls `requireRole(cookieHeader, allowedRoles[])` which returns `{ ok: true, session }` or a ready 401 response. There is no global API middleware by design (defense in depth is per-route).

### 4.4 Feature Flag via Super Admin PIN

- If `pin_super_admin_hash` is set (non-empty), the **report approval workflow activates**:
  - New reports are created with `status = 'pending'`, archiving is deferred,
  - a notification is sent to `super_admin`,
  - non-approved PDFs are not downloadable by admin/secretary.
- If unset, reports behave legacy: instantly `approved`, archiving proceeds normally.

---

## 5. Functional Requirements — Feature by Feature

### 5.1 Registration Requests (Join Workflow)

**Actors:** Public applicant, Admin.
**Entry point:** `/register` (public).

- **FR-R1 Application form fields** — first name\*, last name\*, middle initial (optional), date of birth\*, gender (male/female)\*, contact number\*. **Correction vs. earlier spec: there is no batch field on the form today** — `src/app/register/page.tsx` has exactly 6 inputs and `POST /api/register`'s zod schema has no `batch` key, so `registration_requests.batch` is only ever set by the admin during review. No public batches endpoint exists either (`/api/admin/member-batches` is admin-only) — see decision **D-8** in `../new md/README.md`.
- **FR-R2 Submission** — creates `registration_requests` row with `status='pending'`, `reviewed_at=NULL`. Duplicate tolerance is allowed at this stage (dedupe happens on approval via unique active-name index).
- **FR-R3 Admin review UI** (`/admin/registrations`)
  - Tabs: Pending / Approved / Rejected.
  - Per row actions: **Approve**, **Reject**, **Edit** (correct typos before approving), **Change status** (e.g., rejected → pending again).
  - **Bulk approve / bulk reject** of all currently listed pending rows (confirmation required).
  - Export current tab to PDF (`GET /api/admin/registration-requests/pdf`).
- **FR-R4 Approval semantics** — approve ⇒ insert into `members` (`full_name` composed from parts, plus DOB/gender/contact/batch), set request `status='approved'`, `reviewed_at=now()`. Name conflicts with an existing active member surface as a DB unique-violation error shown to the admin. Reject ⇒ `status='rejected'`, `reviewed_at=now()`; reversible via Change status.

### 5.2 Member Directory & Batches

**Actor:** Admin.

- **FR-M1 Directory** (`/admin/members`)
  - Columns: Name, Batch, Gender, DOB, Contact, Active flag.
  - Filters: batch, gender, status (active/inactive), birth month (for birthday lists).
  - Inline toggle active/inactive (soft delete — records are never hard-deleted).
  - Add/edit member with validation; unique constraint on `lower(trim(full_name)) WHERE is_active`.
- **FR-M2 Batches** — CRUD year strings (e.g., `2025`) in `member_batches`. **Correction vs. earlier spec: batches are managed on the members page, not Settings** — the manager is the **Batches tab of `/admin/members`** (`src/app/admin/members/page.tsx`, `src/features/members/ui/BatchesPanel.tsx`), following decision **MEM-6** in `../new md/03-registration-members.md`. Years also tag members at registration/edit time and scope payment structures. Delete is blocked while anything still points at the year and names both: `2025 is used by 34 members and 1 payment structure.` (`batchInUseMessage` in `src/features/members/batches.ts`, checked against `members` **and** `payment_structures`, since a batch can be in use with nobody in it).
- **FR-M3 Members list PDF** (`GET /api/admin/members/pdf?batch&gender&status&birth_month`) — landscape A4, brand header (church name, title incl. applied filters, total count, generated timestamp). Columns: `#, Full name (Last, First M.), Date of Birth, Gender, Batch, Contact Number` — em-dash for blanks. A matching **CSV** export lives at `GET /api/admin/members/csv` and honours the same filters, including the search term.
- **FR-M4 Member profile** (`/admin/members/[id]`, admin only)
  - **Details** — name, date of birth, gender, contact, batch, status, deactivation info, with edit and deactivate actions inline.
  - **Attendance** — three-month rate, lifetime served, weekend streak, and last served. The rate's denominator is sessions *held* (at least one attendance record), not sessions scheduled; numerator is sessions this member attended. Live and archived tables are both read, so a member who served before archiving keeps their history.
  - **Sundays only** toggle filters the rate to Sundays; the streak is unaffected by it.
  - **Recent sessions** list, and a **payment summary** limited to the structures that actually apply to this member (scoped to everybody, plus their own batch) with voided payments excluded from both sides.
  - Metrics live in `src/lib/attendance/metrics.ts` as pure functions so the arithmetic is testable without a database; `GET /api/admin/members/[id]/stats` does the reading.
- **FR-M5 CSV import** (`POST /api/admin/members/import`, admin only, from **Import from file** on `/admin/members`)
  - Template download with headers `first_name,last_name,middle_initial,date_of_birth,gender,contact_number,batch`. Up to **500 rows** and **1 MB**; a longer file is truncated at 500 and says so.
  - Per-row rules use the **same Zod schema as registration** (`src/features/members/member-input.ts`), so a name the public form would reject cannot arrive by spreadsheet.
  - Dates accept **`YYYY-MM-DD`** and **`MM/DD/YYYY`**, nothing else. `MM/DD/YYYY` is month first, and a day-first value is refused rather than guessed: a birthday stored as the wrong date is the kind of mistake nobody notices for years. The file's own text is echoed back in the error report, so fixing a row does not mean remembering which format it started in.
  - Duplicates are matched by normalized name against **active members** and against **other rows in the same file**. Matches are reported, never imported silently.
  - Unknown batch years are created **only** if the admin ticks "Create missing batches"; until then the import button stays disabled.
  - Two phases on purpose: the browser draws the preview, then the server **re-parses and re-validates** before writing. The preview is a convenience, not a guarantee.
  - The insert is one Postgres function (`kofa_import_members`, migration 026) because the spec asks for a single transaction and the browser cannot hold one open across rows. A failure part-way cannot leave half a file on the roll.
  - Rows that did not land are downloadable as a corrected CSV, carrying the original values plus the line number and the reason.

### 5.3 Masses & Attendance Sessions

**Actors:** Admin (config), Secretary (daily ops).

- **FR-A1 Mass catalog** — admin defines recurring Mass types (name, e.g. _"5:30 AM Anticipated"_, optional `default_sunday` flag). Soft-deactivate only.
- **FR-A2 Sessions = one Mass on one date** — `attendance_sessions(session_date, mass_id)` unique per (date, mass). Created ad hoc by the secretary from the day view: pick date → pick mass → open roster.
- **FR-A3 Encoding attendance** — roster shows all active members with search; tap to mark present (insert `attendance_records`), tap again to remove. Free-text notes per session supported. Live counters: present count / total.
- **FR-A4 Session locking** — any write path (encode, edit, appeal submit, appeal approve) calls `guardReportNotGenerated(session_date)`:
  - If a `reports` row exists for that month (status ≠ `rejected`), respond `409` with a clear message.
  - Rejected reports unlock the month (report was voided).

### 5.4 Attendance Appeals

**Actors:** Member (submit), Admin/Secretary (review).

- **FR-AP1 Member submission** (on a session detail page, appeal card pinned to the **top** for clarity)
  - Search a member by name (server-search endpoint, debounced 180 ms).
  - Multi-select chips (up to 40 per appeal).
  - Names already on the roster **or** already having a pending appeal for that session are blocked client-side (`member_ids_cannot_appeal` from the session API) — tapping one opens a modal: _"Cannot appeal — already on the attendance list or has a pending appeal."_
  - Submit triggers a full-screen portal overlay (_"Recording attendance… do not leave this page"_), `beforeunload` guard while in flight, and Back button disabled via `aria-busy` state lift.
  - Result is a **modal dialog** (never silent):
    - Success (manual review): _"Appeal submitted — will be reviewed."_
    - Success (auto-approve mode): _"Appeal approved — attendance updated."_
    - Conflict (400): the server error is surfaced verbatim in a modal titled _"Appeal not submitted."_
- **FR-AP2 Review UI** (admin session page & secretary session page)
  - Lists pending items (deduped per member, newest first): name + submitted timestamp.
  - Per item: Approve / Reject buttons.
  - **Approve all (N)** button above the list for bulk resolution: while running, an overlay covers the whole appeals panel (blocks taps, prevents partial saves); server does one atomic pass (below), then roster + list refresh. Individual buttons disabled meanwhile.
- **FR-AP3 Approve semantics (single item)**
  1. Verify item still `pending`.
  2. Report-lock check on the session date.
  3. Upsert `attendance_records(session_id, member_id)` (ignore duplicates).
  4. Delete **all** pending items for that same member across every appeal of that session (cross-appeal dedupe).
  5. Prune parent `attendance_appeals` rows left with zero items.
  6. Fire push notification `notifyAttendanceSessionUpdated(sessionId)` (void-safe on serverless).
- **FR-AP4 Approve-all semantics** (`POST .../appeals/approve-all`)
  1. Role gate admin/secretary; session must exist; report-lock check once.
  2. Collect all pending items for the session; 400 if none.
  3. One upsert of all unique member_ids (ignoreDuplicates).
  4. Delete those items in one call; prune empty parents; single push notify.
  5. Respond `{ ok, approved_count }` → UI toast/modal _"All N pending appeals approved."_
- **FR-AP5 Reject semantics** — item row is deleted (design choice: resolved items never accumulate); empty parents pruned.
- **FR-AP6 Auto-approve mode** — setting `attendance_auto_approve_appeals=true` (Admin → Settings checkbox) makes POST appeals skip review entirely: directly upsert attendance and return `auto_approved: true`.

### 5.5 Monthly Attendance Report (the core deliverable)

**Actors:** Secretary/Admin (generate), **Super Admin (approve)**, Admin (archive controls).

- **FR-RP1 Eligibility gate** (`GET /api/reports/can-generate`)
  - Church-timezone aware (`report_timezone`, default `Asia/Manila`).
  - Window rule: **last Sunday of the target month, from 20:00 local** onwards (`canGenerateMonthlyReport`).
  - One report per `report_month` (unique index). Existing **pending** ⇒ reason _"A report for this month is pending approval."_; existing **approved** ⇒ _"already exists"_. A **rejected** report is auto-treated as absent (regeneration allowed; the old row is deleted at generate time).
  - Admin extras: `bypass_schedule` flag and previous-month backfill (`month_start` param) when the previous month has no non-rejected report.
- **FR-RP2 Column selection preview** — `GET /api/reports/month-sessions?month_start=YYYY-MM-DD` lists every session in the month that has ≥1 attendance record (weekday + weekend Masses alike), labeled `EEE, MMM d, yyyy · MassName`. Generator requires ≥1 selected session; validates all IDs belong to the month.
- **FR-RP3 Grid construction** (`weekend-grid.ts`) — columns grouped by calendar date (multi-Mass days share a group), stable ordering. Cell kinds: served / absent / not-scheduled. Remarks derived from served count over **included** sessions only.
- **FR-RP4 PDF rendering** (`pdf.ts`, jsPDF + autotable) — landscape A4/A3 auto-fit: rows = all active members (Last, First M.), column groups by date with Mass sub-labels, green/red cells, remarks column, totals footer, logo watermark if `public/logo.png` exists, header = church name/address/title + month label + generated-at in church TZ.
- **FR-RP5 Persistence & workflow states**

  ```txt
  INSERT reports {
    report_month, title, generated_by ('secretary'|'admin'),
    pdf_storage_path (base64 bytes inline), summary_json (v4 schema below),
    status: 'pending'  ← if super admin configured
          | 'approved' ← legacy/no-super-admin path
  }
  summary_json := {
    version: 4, format: 'selected_sessions_grid',
    data_archived: bool, churchName, churchAddress, reportTitle,
    monthLabel, monthStart, included_session_ids[], columnGroups[],
    totals { sessions_in_month, sessions_in_report, attendance, memberCount },
    memberSummary[ { name, remarks, servedInSelectedSessions } ]
  }
  ```

  - **Pending path:** archiving skipped regardless of toggle; notification `to_role='super_admin'` _"Monthly report pending approval"_.
  - **Legacy path:** archiving per admin toggle; peer notification admin↔secretary as before.
- **FR-RP6 Super admin review** (`/super-admin`, `/super-admin/reports`)
  - Dashboard tile with pending count.
  - Two sections: **Pending review** and **Approved** (each card: title, generator role, timestamp).
  - Actions per pending card: **View PDF** (streams the stored base64 with attachment headers) · **Approve** · **Reject**.
  - Server enforces transition `pending → approved|rejected` only (409 otherwise), stamps `reviewed_by='super_admin'`, `reviewed_at=now()`.
  - Decision notification pushed to the originating role (`generated_by`) with the month label.
- **FR-RP7 Visibility rules** — admin/secretary list (`GET /api/reports`) returns every report including `status`; the UI renders badges **Pending approval** / **Rejected**, replacing the download button with a status pill for non-approved rows. `GET /api/reports/[id]/pdf`: `super_admin` may fetch any; admin/secretary may fetch **approved only** (403 otherwise).
- **FR-RP8 Regeneration after rejection** — because rejected rows don't count as "existing," the month reopens: secretary/admin regenerate (fresh selection), the stale rejected row is deleted first, and a new pending report enters review.

### 5.6 Data Archiving & Report Locking

- **FR-AR1 Archive-at-generate (legacy/admin path)** — toggle (default ON, admin-only to disable): after PDF creation, copy the month's sessions + records into `attendance_sessions_archive` / `attendance_records_archive` (denormalized names preserved), stamp `report_id`, then delete live sessions (cascade removes records).
- **FR-AR2 Deferred archiving (approval path)** — when a report is `pending`, archiving is intentionally withheld. After approval, the admin may flip the per-report **Archive switch** in Past reports (`POST /api/reports/[id]/archive-data`, admin only, idempotent via `summary_json.data_archived` and existence probe).
- **FR-AR3 Locking recap** — live month data frozen once a non-rejected report exists, protecting the archived snapshot from divergence. Applies to: session create/update, record add/remove, appeal submit/approve.

### 5.7 Auxiliary Reports

| Report | Endpoint | Notes |
|---|---|---|
| Members list | `GET /api/admin/members/pdf` | §5.2 FR-M3 (landscape, 6 columns) |
| Top 20 servers | `GET /api/admin/top-servers/pdf` (+ JSON `/api/admin/top-servers`) | Ranked by attendance count merged from **live + archive** tables; card on admin home |
| Registration requests | `GET /api/admin/registration-requests/pdf` | Current tab snapshot |
| Payment status per structure | `GET /api/admin/payment-structures/[id]/pdf` | Per-member paid vs. due grid with installment breakdown; roles admin+treasurer |

### 5.8 Liturgy Planning (Assignments + Templates)

**Actors:** Officer (planner), Admin (also permitted).

- **FR-L1 Two editing modes** — **Planned** (future dates, `liturgy_planned` keyed by date+mass): pre-assign who serves what. **Session** (today/past actual session, `session_liturgy_servers` keyed by session_id): adjust on the day. On session creation, planned rows for that date/mass seed the session rows automatically.
- **FR-L2 Rows model** — ordered list (`sort_order`): `position_label` (e.g., Crucifix, Candle 1, Thurifer) + assignee = either a searched **member** (`member_id`) or **free text** (guest/name not in system). Add/remove/reorder rows inline; member picker uses debounced search.
- **FR-L3 Templates** (`liturgy_templates` + `liturgy_template_slots`, migration 021)
  - **Save as template:** name + current position labels (≥1 validated) → persists slot list; appears immediately in dropdown with slot count.
  - **Load template:** replaces the editor's rows with the template slots (members cleared, ready to assign); explicit confirmation message.
  - **Delete:** trash button beside the selected template (confirm dialog).
  - Ownership: `created_by` stores creating role; any officer/admin may reuse all templates (shared library).

### 5.9 Announcements

- Creators: admin, secretary, officer, and `system` (automated birthday posts — see §11).
- Fields: title, body, optional linkage remnants kept nullable for compatibility.
- **Auto-expiry:** `delete_at` timestamp (default horizon configurable at creation); cleanup handled lazily/cron side.
- Feed surfaces newest first on member home & relevant dashboards; deletion restricted to creator role/admin.

### 5.10 Notifications

**In-app inbox**

- `notifications(from_role, to_role, title, body, read_at)`; readers filter `to_role = session.role`.
- Emitters today: report generated (peer), report pending (→super_admin), report approved/rejected (→originator), registration outcomes (→admin), appeal activity (contextual).
- Inbox pages per role mark items read individually or in bulk; unread badge on nav.

**Web Push**

- `push_subscriptions(endpoint UNIQUE, p256dh, auth)`; service worker `sw.js` handles `push` + `notificationclick`.
- VAPID keys via env; `web-push` library server-side.
- `notifyAttendanceSessionUpdated(sessionId)` fans out to subscribed devices when rosters change (appeals approved etc.). Errors logged, never thrown (fire-and-forget `void`).

### 5.11 Payments

**Actor:** Treasurer (+read admin).

- **FR-P1 Structures** (`payment_structures`) — `name, amount>0, deadline?, installment_months>0?, is_active, for_all:boolean, batch?`. Scoping: `for_all=true` applies to everyone; else targets a specific `batch` (FK years list).
- **FR-P2 Recording payments** (`payments`) — pick structure → pick member (batch-aware suggestions honoring scope) → amount (defaults to structure amount, editable, >0) → `paid_at` date (default today) → optional notes. Running per-member totals computed on the fly (sum of non-voided payments vs. prorated expectation by installments/deadline).
- **FR-P3 Voiding** — soft flag `voided=true` (audit preserved; excluded from totals; irreversible in MVP UI).
- **FR-P4 Status PDF** — see §5.7 table.

### 5.12 Dashboards & Insight Cards

| Card | Where | Logic |
|---|---|---|
| **Inactive members** | Admin home | Zero attendance records in the **last 2 complete months** (live ∪ archive), excluding never-active members |
| **Top servers** | Admin home | Top 20 by lifetime count (live + archive), ties alphabetical |
| **Birthdays today** | Member home + system announcement | `date_of_birth` MM-DD matches today in church TZ |
| **Appeal indicators** | Secretary calendar | `month-indicators` returns `pending_appeals` per day, drawn as a red dot for secretary and admin only — members and officers cannot act on an appeal, so showing it to them is noise |
| **Report status strip** | Reports panel | Ready / Outside schedule / Pending approval / Already exists — driven by `can-generate` payload incl. `super_admin_configured` |
| **Payments summary** | Treasurer home | Collected this month, outstanding per structure |

### 5.13 System Settings & PIN Management

- Settings keys (single row per key): `church_name`, `church_address`, `report_title`, `report_timezone`, `attendance_auto_approve_appeals`, six `pin_*_hash` entries.
- Admin Settings page sections: Report header (church identity + TZ), Batch manager, Auto-approve toggle, **PIN management** grid (one form per role incl. Super Admin, labeled _"Super Admin (report approval)"_; 4–12 chars, confirm match, bcrypt(10)).
- Changing the super admin PIN **activates/deactivates** the approval workflow implicitly (presence of a hash).

---

## 6. User Flows

### Flow A — New member joins end-to-end

1. Applicant opens `/register`, fills 7 fields, submits → sees confirmation.
2. Admin → Registrations → Pending tab sees the row.
3. Admin taps **Edit** to fix a typo'd contact number, then **Approve**.
4. Row moves to Approved; new active member now appears in directory, attendance roster, and search everywhere.

### Flow B — Sunday attendance encoding + appeal

1. Secretary logs in with secretary PIN → Calendar → picks today → creates/selects session for the closing Mass.
2. Taps names as servers arrive (counter updates). Saves. Lock icon appears later once report exists.
3. Member "Juan" served but wasn't ticked. Juan opens the session on his phone → appeal card (top of page) → searches _"Juan Dela Cruz"_ → adds chip → **Submit appeal**.
4. Overlay spins ~1 s → success modal _"Appeal submitted."_
5. Secretary gets calendar highlight; opens session → Appeals panel → taps **Approve all (2)**.
6. Overlay _"Saving approved attendances…"_ blocks the panel; on completion both appeals vanish, roster shows Juan, push notification fires.

### Flow C — Month-end report with super admin sign-off

1. Last Sunday, 8:05 PM church time. Secretary → Reports → status pill **Ready to generate**.
2. Preview lists 9 Mass days; secretary unticks one low-turnout weekday, keeps 8 → **Generate report**.
3. Server builds PDF, saves `status='pending'`, notifies super_admin. Secretary's Past reports shows the row badge **Pending approval** (no download button).
4. Super admin logs in → dashboard shows **1 pending** → Reports → **View PDF** (reviews the grid) → **Approve**.
5. Secretary receives _"Report approved"_ notification; download button replaces badge; admin later flips the Archive switch → month data moves to archive, live tables cleared, month locked thereafter.

### Flow D — Rejection loop

1. Super admin spots a missing column (a session was unticked) → **Reject** with notification back.
2. Secretary's report row turns **Rejected**; `can-generate` flips back to Ready (rejected doesn't count).
3. Secretary regenerates including all 9 days → new **pending** report replaces the deleted rejected row → review resumes.

### Flow E — Dues collection

1. Treasurer creates structure _"Annual Dues ₱500"_ deadline Mar 31, installments 2, `for_all`.
2. Records partial payments per member as they come; accidentally records ₱500 twice for Juan → **Void** the second.
3. End of period: downloads the structure PDF → grid shows each member, paid Σ, remaining balance, installment progress → prints for the parish bookkeeper.

---

## 7. Data Model (Database Schema)

All tables RLS-enabled; only the server's **service-role key** operates (no client-side Supabase writes). Migrations are additive, numbered `001…026`. Note the one gap this reference used to carry: `payments` and `payment_structures` were created in 016 **without** RLS, and 026 closes it. There are no `CREATE POLICY` statements in the schema — RLS with zero policies denies `anon` and `authenticated` outright, and the service-role key bypasses it.

### Core

```txt
system_settings(key PK, value, updated_at)

members(id, full_name, is_active=true, date_of_birth?, gender? male|female,
        contact_number?, batch? →member_batches(year), created_at, updated_at)
  ↳ UNIQUE(lower(trim(full_name))) WHERE is_active

masses(id, name, default_sunday=false, is_active=true,
       sort_order int NOT NULL DEFAULT 0,      -- 027: catalog order = day-view order
       default_time time NULL)                -- 027: reminder only, no scheduling meaning

attendance_sessions(id, session_date, mass_id+'masses, notes?,
                    UNIQUE(session_date, mass_id))  -- 027 attendance_sessions_date_mass_key
attendance_records(id, session_id+'sessions CASCADE, member_id+'members,
                   UNIQUE(session_id, member_id),
                   source text NOT NULL DEFAULT 'encoded',   -- 027: encoded|appeal|appeal_auto|import
                   recorded_at timestamptz NOT NULL DEFAULT now(),
                   recorded_by_role text NULL)
```

### Reports & archive

```txt
reports(id, report_month UNIQUE, title, generated_by ∈{secretary,admin},
        pdf_storage_path TEXT(base64), summary_json JSONB,
        status ∈{pending,approved,rejected} DEFAULT 'approved',   -- 022
        reviewed_by ∈{super_admin}?, reviewed_at?,               -- 022
        created_at)
  ↳ INDEX(status, created_at DESC)

attendance_sessions_archive(id, session_date, mass_id, mass_name?, notes?,
                            archived_at, report_id?→reports SET NULL,
                            PK(id, archived_at))
attendance_records_archive(id, session_id, member_id, member_name?,
                           archived_at, report_id?, PK(id, archived_at))
```

### Appeals

```txt
attendance_appeals(id, session_id→sessions CASCADE,
                   submitted_by_role ∈{member}, submitted_at)
attendance_appeal_items(id, appeal_id→appeals CASCADE, member_id→members,
                   status ∈{pending,approved,rejected} DEFAULT 'pending',
                   reviewed_by_role?, reviewed_at?, created_at,
                   UNIQUE(appeal_id, member_id))
  ↳ convention: resolved items are DELETED, parents pruned when empty
```

### Liturgy

```txt
session_liturgy_servers(id, session_id→sessions CASCADE, position_label,
                        member_id?→members SET NULL, free_text?, sort_order=0)
liturgy_planned(id, session_date, mass_id→masses CASCADE, position_label,
                member_id?, free_text?, sort_order=0)
liturgy_templates(id, name, created_by, created_at)          -- 021
liturgy_template_slots(id, template_id→templates CASCADE,
                       position_label, sort_order=0)          -- 021
```

### Community & comms

```txt
announcements(id, title, body, created_by ∈{admin,secretary,officer,system},
              delete_at?, liturgy_* legacy nullables, created_at)

notifications(id, from_role ∈{admin,secretary,member,system,super_admin}, -- 022 widened
              to_role ∈{admin,secretary,super_admin},                    -- 022 widened
              title, body?, read_at?, created_at)
  ↳ INDEX(to_role, created_at DESC)

push_subscriptions(id, endpoint UNIQUE, p256dh, auth, created_at)
```

### Join flow & people meta

```txt
registration_requests(id, first_name, last_name, middle_initial?, date_of_birth,
                      gender ?{male,female}, contact_number,
                      status ?{pending,approved,rejected} DEFAULT 'pending',
                      batch?, reviewed_at?, created_at,
                      reference_code UNIQUE?,                -- 025
                      approved_member_id? → members(id),    -- 025
                      approval_created_member bool,          -- 025

member_batches(id, year UNIQUE, created_at)
```

`reference_code` is the code an applicant reads back at `/register/status` to follow their own request. `approved_member_id` remembers which member an approval produced, which is what makes un-approval safe: only a member this request *created* (`approval_created_member`) is removed, so un-approving a request that was merely **linked** to somebody already on the roll never touches that person. Old rows that predate 025 keep a null id and `false`, and un-approving them leaves the member alone.

### Money

```txt
payment_structures(id, name, amount NUMERIC(10,2)>0, deadline?, 
                   installment_months?>0, is_active=true,
                   for_all=true, batch?→member_batches)      -- 016/019
payments(id, member_id→members CASCADE,
         payment_structure_id→structures RESTRICT,
         amount_paid>0, paid_at DEFAULT CURRENT_DATE, notes?,
         created_by DEFAULT 'treasurer', voided=false)       -- 016/020
```

---

## 8. API Surface

Legend: 🔓 public · role list = `requireRole` allowlist.

### Auth

| Method | Path | Roles | Body → Response |
|---|---|---|---|
| POST | `/api/auth/login` | 🔓 | `{pin}` → `{ok, role}` + cookie |
| POST | `/api/auth/logout` | any | clears cookie |

### Registration

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/api/register` | 🔓 | create pending request |
| GET | `/api/admin/registration-requests?status=` | admin | list by tab |
| PATCH | `/api/admin/registration-requests/[id]` | admin | approve/reject/update/change-status |
| POST | `/api/admin/registration-requests/bulk` | admin | `{action, ids[]}` |
| GET | `/api/admin/registration-requests/pdf` | admin | tab snapshot PDF |

### Members & batches

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/api/members/search?q=&limit=` | admin, treasurer, secretary, officer, member(limited) | active members only; `limit` clamped, max 40 |
| GET/POST | `/api/admin/members` | admin | list honours `safeParseMemberQuery`; POST validates the sheet's snake_case body |
| PATCH | `/api/admin/members/[id]` | admin | edit / deactivate / reactivate; never hard-deletes |
| GET | `/api/admin/members/[id]/stats` | admin | profile metrics, recent sessions, applicable payment summary |
| POST | `/api/admin/members/import` | admin | `?mode=commit` writes; default is a dry preview |
| GET | `/api/admin/members/csv` | admin | filter-aware, including the search term |
| GET | `/api/admin/members/pdf` | admin | filter-aware, including the search term |
| GET/POST/DELETE | `/api/admin/member-batches` | admin | GET is open to treasurer; delete guard names members **and** payment structures |
| GET | `/api/admin/top-servers(.pdf)` | admin | |
| GET | `/api/admin/inactive-members` | admin | |

### Masses / sessions / attendance

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/api/masses`, `/api/masses/[id]` | member, secretary, officer (read); admin, officer (write) | catalog. GET returns all rows incl. inactive, ordered by `sort_order` then name, with `default_time`/`is_active`. PATCH accepts `{direction:"up"\|"down"}` to swap a Mass with its neighbour in place. POST assigns the next `sort_order` so new Masses go to the end rather than sorting into the middle by name |
| POST | `/api/attendance/sessions/weekend` | admin, secretary | ATT-2 manual "create this weekend's sessions"; same code as the cron. Returns `sunday`, `created[]`, `skipped[]`, `reason` (locked month or no Sunday Masses are answers, not failures) |
| GET/PATCH/DELETE | `/api/attendance/session/[id]` | mixed | GET returns roster, `locked`/`locked_reason`/`locked_message`, `is_future`/`future_message`, `month_label`/`month_start`/`month_end`. PATCH takes `notes` (notes-only path skips the future guard) or `member_ids` (replace roster, lock + future enforced). DELETE is **admin only** and requires the session to be empty; answers 409 with counts when it is not |
| POST | `/api/attendance/session/[id]/records/set` | admin, secretary | ATT-5 idempotent per-member changes plus bulk `mark_all`/`clear_all` (active members only). Idempotent so a retry cannot double-count |
| GET | `/api/attendance/by-day`, `/liturgy-planned`, `/liturgy-summary` | mixed | dashboard + planning reads. by-day merges live **and archived** attendance and orders sessions by Mass order |
| GET | `/api/attendance/month-indicators` | member, secretary, officer, admin | ATT-3 one flag per day with sessions: `sessions`, `held` (≥1 record, live or archived), `present`, `needs_encoding` (past day, sessions, nobody encoded), `pending_appeals` (secretary/admin only). Month `locked` reported once, fails closed if unreadable |
| GET | `/api/cron/sessions` | secret header | ATT-2 pre-creates the coming Sunday's sessions when `auto_create_sunday_sessions = 'true'`; idempotent via the unique `(session_date, mass_id)` key; skips locked months |

### Appeals

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/api/attendance/session/[id]/appeals` | member | submit; auto-approve branch |
| GET | `/api/attendance/session/[id]/appeals` | admin, secretary | pending deduped list |
| PATCH | `/api/attendance/appeals/[id]` | admin, secretary | approve/reject single |
| POST | `/api/attendance/session/[id]/appeals/approve-all` | admin, secretary | **bulk** |
| GET | `/api/attendance/appeals/month-indicators?month=` | secretary, admin | dates w/ pending |

### Reports

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/api/reports` | admin, secretary | list + status + data_archived |
| GET | `/api/reports/can-generate` | admin, secretary | gate payload |
| GET | `/api/reports/month-sessions` | admin, secretary | selectable columns |
| POST | `/api/reports/generate` | admin, secretary | body: session_ids, month_start?, bypass_schedule?, archive_data? |
| GET | `/api/reports/[id]/pdf` | admin, secretary(*approved only*), super_admin(any) | stream PDF |
| POST | `/api/reports/[id]/archive-data` | admin | idempotent archive |

### Super admin

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/api/super-admin/reports?status=pending\|approved` | super_admin | review queues |
| PATCH | `/api/super-admin/reports/[id]` | super_admin | `{action:'approve'\|'reject'}`; pending→X enforced |

### Liturgy

| Method | Path | Roles |
|---|---|---|
| GET/PUT | `/api/liturgy/planned?date=&mass_id=` | admin, officer |
| GET/PUT | `/api/liturgy/session/[id]` | admin, officer |
| GET/POST | `/api/officer/liturgy-templates` | officer, admin |
| GET/DELETE | `/api/officer/liturgy-templates/[id]` | officer, admin |

### Announcements / notifications / payments / settings

| Method | Path | Roles |
|---|---|---|
| GET/POST/DELETE | `/api/announcements*` | admin, secretary, officer (DELETE creator/admin) |
| GET/PATCH | `/api/notifications*` | role-scoped reader |
| POST | `/api/push/subscribe` | any logged-in |
| GET | `/api/push/vapid-key` | any logged-in |
| POST | `/api/push/unsubscribe` | any logged-in |
| GET/POST | `/api/treasurer/payment-structures*` | treasurer, admin(read) |
| GET/POST | `/api/treasurer/payments*` (+ void PATCH) | treasurer, admin(read) |
| GET | `/api/admin/payment-structures/[id]/pdf` | treasurer, admin |
| GET/PATCH | `/api/admin/settings` | admin |
| POST | `/api/admin/pins` | admin |

### Cron

| Method | Path | Notes |
|---|---|---|
| GET | `/api/cron/birthday` | secret header; see §11 |

---

## 9. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Security** | httpOnly SameSite=Lax cookies; HS256 JWT 7d; bcrypt cost 10; no secrets client-side; service-role key only in Node server; per-route role guards; SQL via parameterized Supabase client; Zod validation on every mutating endpoint. |
| **Privacy** | Minimal PII (name, DOB, gender, contact). No photos/IDs in MVP. PDFs transmitted over TLS with `Cache-Control: no-store`. |
| **Integrity** | Unique constraints (active names, session×member, month×report); state machines (request status, report status); report-lock guards; idempotent archive; append-only archives. |
| **Performance** | Debounced search (180 ms); paginated/limited queries (≤200 appeals, ≤40 appeal items, top-20 aggregates); PDF gen <3 s typical month (~50 members × ≤15 cols); edge middleware for route gating. |
| **Reliability** | Fire-and-forget push with try/catch; birthday cron resilient to partial failures; build passes `next build` with strict TS (zero `any` leaks in touched code). |
| **Usability** | Mobile thumb-reach nav (bottom bar); min touch target 44 px (`min-h-11/12`); optimistic counters with server refresh; blocking overlays wherever double-tap could corrupt data (submit appeal, approve all, save attendance). |
| **Accessibility** | Semantic landmarks (`section`, labelled dialogs `role="dialog" aria-modal`), `aria-busy` on saving containers, focusable modals with OK/backdrop dismissal. |
| **i18n/TZ** | Single church timezone setting drives schedule windows, "generated at", birthday matching (IANA via `date-fns-tz`). |
| **Browser support** | Evergreen mobile Safari/Chrome; service worker for push; no IE. |

---

## 10. Tech Stack & Architecture

```txt
Frontend   Next.js 15 App Router (RSC shells + client islands), React 19,
           Tailwind CSS v4 (@tailwindcss/postcss), CSS vars theming
           (--accent/--surface/--border/--danger), bottom-tab layouts per role
Backend    Next.js Route Handlers (Node runtime for PDF/push/bcrypt),
           Edge middleware for auth routing
DB         Supabase Postgres (RLS on; service-role server client singleton)
Auth       Custom role-PIN + jose JWT (node) / hand-rolled WebCrypto HMAC (edge)
PDF        jsPDF + jspdf-autotable (grid report, landscape A4/A3; aux lists)
Push       web-push (VAPID) + sw.js
Validation zod v4
Dates      date-fns + date-fns-tz
Hashing    bcryptjs
```

### Repository layout (abridged)

```txt
src/
  app/
    (role)/layout.tsx + pages…        # admin | secretary | officer | member | treasurer | super-admin
    api/**                            # route handlers per domain (§8)
    login/  register/
  components/                         # ReportsPanel, AttendanceAppealForm/Review,
                                      # LiturgyServerEditor, MonthCalendar, PwaHub,
                                      # RoleNav, ReceiptModal, TopServersCard, LogoutBar…
  features/
    attendance/
      ui/                            # ATT-3–9 shared screens: AttendanceCalendar,
                                      # MonthCalendar, DayView, SessionScreen (all four
                                      # roles), Roster, AddSession, CreateWeekendButton,
                                      # attendance-queue (ATT-6 offline retry)
      server/                        # create-session, roster-writes, load-roster,
                                      # create-weekend-sessions
  lib/
    auth/{roles,session,jwt-edge,pin-login,constants}
    api/guard.ts
    attendance/                       # attendance rules
    members/  push/  reports/  settings/
    supabase/admin.ts
  middleware.ts
supabase/migrations/001…027.sql + seeds/   # 023-027 authored, not yet applied
public/{logo.png, sw.js, manifest.json}
```

---

## 11. Cron Jobs / Scheduled Work

| Job | Schedule | Behavior |
|---|---|---|
| **Birthday greeter** | Daily **00:00 UTC (=08:00 PHT)** `GET /api/cron/birthday` (secret header) | Finds active members whose MM-DD equals today in church TZ → inserts `system` announcement + optional push; awaits the push promise (fixed from earlier fire-and-forget loss on serverless) and logs errors even in production |
| **Maintenance sweep** | Daily **00:00 UTC** `GET /api/cron/maintenance` (secret header) | AUTH-8. Deletes expired `login_attempts` and `audit_log` beyond the retention setting. Fails closed when `CRON_SECRET` is unset — skipping the check would leave a route that deletes history reachable by anyone guessing the URL |
| **Weekend sessions** | Weekly **Thursday 00:00 UTC** `GET /api/cron/sessions` (secret header) | ATT-2. Creates one session per active Mass with `default_sunday = true` for the coming Sunday, in parish TZ. Skipped entirely when the month is report-locked, when no Sunday Masses are set, or when `auto_create_sunday_sessions` is off (reports why rather than exiting silently). Idempotent, so a double fire is harmless. Fails closed when `CRON_SECRET` is unset |
| Announcement sweep | Lazy on read + optional daily hook | Deletes rows past `delete_at` |

Vercel Cron config in `vercel.json`; secret via `CRON_SECRET`. Both unattended jobs refuse to run when `CRON_SECRET` is missing and say so in the log, because a misconfigured environment is exactly when you least want a stranger running a destructive job.

---

## 12. Out of Scope (Post-MVP)

- Per-person accounts, password resets, OAuth/email login
- Email/SMS channels; WhatsApp/Telegram bots
- Photo upload (profile, event gallery); QR self check-in kiosk
- Offline-first attendance with sync queue
- Multi-parish / multi-organization tenancy; white-label theming UI
- Advanced analytics (trend charts, export XLSX, scheduled email digests)
- Financial ledger features (expenses, reports to donors, receipts numbering)
- Audit log UI (currently implicit via timestamps/roles)
- Localization (i18n) beyond English/Filipino-neutral copy

---

## 13. Deployment & Environment

**Host:** Vercel (Node runtime functions) + Supabase (Postgres + Storage).

```env
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=     # server-only
JWT_SECRET=                    # ≥16 chars
VAPID_PUBLIC_KEY=              # server-only, NOT NEXT_PUBLIC_ — the browser fetches it from /api/push/vapid-key
VAPID_PRIVATE_KEY=             # server-only
VAPID_SUBJECT=                 # mailto:you@example.com
CRON_SECRET=                   # sent as a header by the Vercel cron caller
IP_HASH_SALT=                  # optional; falls back to JWT_SECRET if unset
```

Only `NEXT_PUBLIC_SUPABASE_URL` reaches the browser. Everything else is server-only and must **not** be
prefixed with `NEXT_PUBLIC_`, or the value is inlined into the client bundle and readable by anyone who
opens devtools. `VAPID_PUBLIC_KEY` is the easy mistake here: it is not public config, the service worker
key is fetched at runtime from `/api/push/vapid-key` instead.

**Release checklist**

1. Apply migrations `001→034` in order (all idempotent `IF NOT EXISTS`/`ON CONFLICT`).
   - `001→034` are all applied to the live project as of this writing, verified by probing each
     migration's distinctive columns, tables and view through the service-role key. Re-run that probe
     after any fresh project or `db reset`, because a partially-migrated database fails at runtime in
     ways that look like bugs: a missing column surfaces as a 400 from PostgREST, not as a startup error.
   - 026 also enables RLS on `payments` and `payment_structures` (they were the only tables left without
     it) and adds the `member_id` indexes the member profile needs.
   - Storage is **not** unused: report PDFs moved from base64-in-database to a **private** `reports`
     bucket (decision D-4). `reports.pdf_storage_kind` is `inline` for legacy rows and `stored` for new
     ones, and both download paths must keep working.
2. Set env vars; deploy.
3. Sign in and confirm the default-PIN banner is gone. It appears while any of the six role PINs is still
   `1234`, and clears when the last one is rotated (Settings).
4. Fill Report header (church name/address/timezone), create batches, import/add members.
5. Configure Masses; subscribe a test device for push; dry-run: register→approve→session→appeal→approve-all→generate(bypass)→super-admin approve→download→archive.

---

## 14. Known Behaviors & Edge Cases

1. **Rejected reports unlock months** — deliberate: rejection voids the snapshot so attendance can be corrected and regenerated; archives tied to the deleted row are orphaned but harmless (`report_id` SET NULL).
2. **Approval feature flag** — deleting/clearing the super admin PIN silently returns the app to instant-approve reporting (useful for small chapters without a signatory).
3. **Cross-appeal dedupe** — approving one appeal item resolves the same member's duplicates across *other* submissions of that session (prevents double roster inserts racing).
4. **Bulk approve overlay scope** — overlay covers the appeals panel only; page navigation is still possible but pointless post-completion; individual buttons disabled meanwhile.
5. **Member search privacy** — search returns minimal fields; member role may search solely to file appeals (server still enforces cannot-appeal list).
6. **Timezone pitfalls avoided** — all schedule math uses the church TZ setting, never server-local; DOB comparisons use MM-DD strings, immune to year formatting.
7. **Base64-in-DB PDFs** — simple + transactional for MVP; known ceiling ~ a few hundred KB/report; move to object storage if months exceed ~200 members × 20 columns.
8. **Legacy reports** — pre-022 rows read as `status='approved'` via column default; UI badges only appear for explicitly `pending`/`rejected`.

---

## 15. Repository Snapshot

Verbatim file contents and listings, for writing exact commands and paths.

### 15.1 `package.json`

```json
{
  "name": "kofa-ams",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "seed:march": "node scripts/seed-march-weekends.mjs"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.100.1",
    "bcryptjs": "^3.0.3",
    "date-fns": "^4.1.0",
    "date-fns-tz": "^3.2.0",
    "jose": "^6.2.2",
    "jspdf": "^4.2.1",
    "jspdf-autotable": "^5.0.7",
    "next": "^15.5.14",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "web-push": "^3.6.7",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@eslint/eslintrc": "^3",
    "@tailwindcss/postcss": "^4",
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/web-push": "^3.6.4",
    "eslint": "^9",
    "eslint-config-next": "^15.5.14",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
```

### 15.2 `ls src src/app src/components`

```txt
src/app
src/components
src/lib
src/middleware.ts

src/app/admin
src/app/api
src/app/login
src/app/member
src/app/officer
src/app/register
src/app/secretary
src/app/super-admin
src/app/treasurer
src/app/apple-icon.png
src/app/favicon.ico
src/app/globals.css
src/app/icon.png
src/app/layout.tsx
src/app/page.tsx

src/components/AnnouncementSelfService.tsx
src/components/AnnouncementsFeed.tsx
src/components/AssignedServersSection.tsx
src/components/AttendanceAppealForm.tsx
src/components/AttendanceAppealsReview.tsx
src/components/ConfirmModal.tsx
src/components/InactiveMembersCard.tsx
src/components/LiturgyServerEditor.tsx
src/components/LogoutBar.tsx
src/components/OfficerCreateMassForm.tsx
src/components/PaymentLookup.tsx
src/components/PwaHub.tsx
src/components/ReceiptModal.tsx
src/components/RegisterPWA.tsx
src/components/ReportsPanel.tsx
src/components/RoleNav.tsx
src/components/TopServersCard.tsx
```

### 15.3 `src/app/globals.css` (60 lines, verbatim)

```css
@import "tailwindcss";

:root {
  color-scheme: light dark;
  --background: #fff8ef;
  --foreground: #2b120f;
  --surface: #ffffff;
  --surface-2: #fff2dc;
  --border: #e7c98d;
  --muted: #7a5c3d;
  --accent: #aa1f2a;
  --accent-soft: #ffe4b8;
  --danger: #8f0f1f;
  --success: #1a7f4b;
  --success-soft: #d9f2e4;
  --ring: #aa1f2a;
  --text: var(--foreground);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: ui-sans-serif, system-ui, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #2b0d0f;
    --foreground: #fff4dd;
    --surface: #3b1216;
    --surface-2: #55201f;
    --border: #9f6a27;
    --muted: #f3cf98;
    --accent: #f0bc62;
    --accent-soft: #7a281f;
    --danger: #ff8a8a;
    --success: #5fd39a;
    --success-soft: #14382a;
    --ring: #f0bc62;
    --text: var(--foreground);
  }
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-sans);
  min-height: 100dvh;
}

*:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
  border-radius: 0.25rem;
}

::selection {
  background: var(--accent-soft);
  color: var(--foreground);
}
```

### 15.4 `src/lib` (bonus — outside the requested `ls`)

```txt
lib/format-peso.ts
lib/api/guard.ts
lib/attendance/copy-planned-liturgy.ts
lib/attendance/liturgy-announcement.ts
lib/attendance/liturgy-slots.ts
lib/attendance/liturgy-summary.ts
lib/auth/constants.ts
lib/auth/jwt-edge.ts
lib/auth/pin-login.ts
lib/auth/roles.ts
lib/auth/session.ts
lib/members/name-format.ts
lib/push/attendance-notify.ts
lib/push/broadcast.ts
lib/push/liturgy-notify.ts
lib/push/vapid.ts
lib/reports/archive-month.ts
lib/reports/check-report-lock.ts
lib/reports/generate.ts
lib/reports/members-pdf.ts
lib/reports/payment-structures-pdf.ts
lib/reports/pdf.ts
lib/reports/registration-requests-pdf.ts
lib/reports/rules.ts
lib/reports/top-servers-data.ts
lib/reports/top-servers-pdf.ts
lib/reports/weekend-grid.ts
lib/settings/keys.ts
lib/settings/store.ts
lib/supabase/admin.ts
```

### 15.5 Repo root

```txt
.git  docs  public  scripts  src  supabase
.gitignore  README.md  eslint.config.mjs  kofa.png  next.config.ts
package-lock.json  package.json  postcss.config.mjs  tsconfig.json  vercel.json
```

Totals: 151 files under `src/` (~1.04 MB). The nested `kofa-netwok-master/` folder is the real git repo; the outer folder also holds `kofa-netwok-push-temp/` (untracked copy).

### 15.6 `find src/app -name "page.tsx" | sort`

35 route pages:

```txt
src/app/admin/day/[date]/page.tsx
src/app/admin/day/[date]/session/[id]/page.tsx
src/app/admin/inbox/page.tsx
src/app/admin/masses/page.tsx
src/app/admin/members/page.tsx
src/app/admin/page.tsx
src/app/admin/payments/page.tsx
src/app/admin/registrations/page.tsx
src/app/admin/reports/page.tsx
src/app/admin/settings/page.tsx
src/app/login/page.tsx
src/app/member/day/[date]/page.tsx
src/app/member/day/[date]/session/[id]/page.tsx
src/app/member/page.tsx
src/app/member/payments/page.tsx
src/app/officer/day/[date]/page.tsx
src/app/officer/day/[date]/plan/[massId]/page.tsx
src/app/officer/day/[date]/session/[id]/page.tsx
src/app/officer/inbox/page.tsx
src/app/officer/page.tsx
src/app/officer/payments/page.tsx
src/app/page.tsx
src/app/register/page.tsx
src/app/secretary/day/[date]/add/page.tsx
src/app/secretary/day/[date]/page.tsx
src/app/secretary/inbox/page.tsx
src/app/secretary/page.tsx
src/app/secretary/payments/page.tsx
src/app/secretary/reports/page.tsx
src/app/secretary/session/[id]/page.tsx
src/app/super-admin/page.tsx
src/app/super-admin/reports/page.tsx
src/app/treasurer/page.tsx
src/app/treasurer/payments/page.tsx
src/app/treasurer/payment-structures/page.tsx
```

### 15.7 shadcn/ui — NOT installed

Verified absent from this repo:

| Probe | Result |
|---|---|
| `components.json` (shadcn config) | does not exist |
| `src/components/ui/` (shadcn output dir) | does not exist |
| `src/lib/utils.ts` (`cn()` helper) | does not exist |
| `clsx` / `tailwind-merge` / `class-variance-authority` in `package.json` | not present |
| `@radix-ui/*` (shadcn primitives) | not present |
| `lucide-react` (shadcn icon set) | not present |
| subdirectories under `src/components` | none — flat, 19 `.tsx` files only |

Every component in `src/components` (see §15.2) is hand-written. Adding shadcn would require init + a new dependency set; the existing CSS-variable theming in `src/app/globals.css` (see §15.3) is the current design system.

### 15.8 Shared UI shell — `src/components/RoleNav.tsx` (44 lines, verbatim)

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function RoleNav({
  links,
}: {
  links: readonly { href: string; label: string }[];
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === pathname || (href !== "/" && pathname.startsWith(`${href}/`));

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]"
    >
      <div
        className="mx-auto grid w-full max-w-6xl gap-1 px-2 py-2"
        style={{ gridTemplateColumns: `repeat(${links.length}, minmax(0, 1fr))` }}
      >
        {links.map((l) => {
          const active = isActive(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`min-h-11 rounded-xl px-1 py-2 text-center text-xs font-medium leading-tight transition-colors sm:text-sm ${
                active
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--accent)]"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

### 15.9 All six role layouts (verbatim)

#### `src/app/admin/layout.tsx` (23 lines) — uses `RoleNav`, 8 items

```tsx
import { LogoutBar } from "@/components/LogoutBar";
import { RoleNav } from "@/components/RoleNav";

const links = [
  { href: "/admin", label: "Home" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/registrations", label: "Registrations" },
  { href: "/admin/payments", label: "Payments" },
  { href: "/admin/masses", label: "Masses" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/inbox", label: "Inbox" },
  { href: "/admin/settings", label: "Settings" },
] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <RoleNav links={links} />
    </div>
  );
}
```

#### `src/app/secretary/layout.tsx` (19 lines) — uses `RoleNav`, 4 items

```tsx
import { LogoutBar } from "@/components/LogoutBar";
import { RoleNav } from "@/components/RoleNav";

const links = [
  { href: "/secretary", label: "Calendar" },
  { href: "/secretary/inbox", label: "Inbox" },
  { href: "/secretary/payments", label: "Payments" },
  { href: "/secretary/reports", label: "Reports" },
] as const;

export default function SecretaryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <RoleNav links={links} />
    </div>
  );
}
```

#### `src/app/member/layout.tsx` (17 lines) — uses `RoleNav`, 2 items

```tsx
import { LogoutBar } from "@/components/LogoutBar";
import { RoleNav } from "@/components/RoleNav";

const links = [
  { href: "/member", label: "Home" },
  { href: "/member/payments", label: "Payments" },
] as const;

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <RoleNav links={links} />
    </div>
  );
}
```

#### `src/app/super-admin/layout.tsx` (17 lines) — uses `RoleNav`, 2 items

```tsx
import { LogoutBar } from "@/components/LogoutBar";
import { RoleNav } from "@/components/RoleNav";

const links = [
  { href: "/super-admin", label: "Dashboard" },
  { href: "/super-admin/reports", label: "Reports" },
] as const;

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <RoleNav links={links} />
    </div>
  );
}
```

#### `src/app/treasurer/layout.tsx` (30 lines) — **hand-rolled bottom nav, no `RoleNav`**

```tsx
import Link from "next/link";
import { LogoutBar } from "@/components/LogoutBar";

const links = [
  { href: "/treasurer", label: "Home" },
  { href: "/treasurer/payment-structures", label: "Payment Structures" },
  { href: "/treasurer/payments", label: "Payments" },
] as const;

export default function TreasurerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)] pb-24">
      <LogoutBar />
      <div className="mx-auto w-full max-w-6xl px-3 pt-3 sm:px-4">{children}</div>
      <nav className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-center gap-4 px-2 py-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="min-h-11 rounded-lg px-4 py-2 text-center text-sm font-medium leading-tight text-[var(--accent)]"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
```

#### `src/app/officer/layout.tsx` (24 lines) — **hand-rolled TOP nav, no `RoleNav`, no `pb-24`**

```tsx
import Link from "next/link";
import { LogoutBar } from "@/components/LogoutBar";

export default function OfficerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[var(--background)]">
      <LogoutBar />
      <nav className="border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
        <div className="mx-auto flex max-w-6xl gap-4 text-sm font-medium">
          <Link href="/officer" className="text-[var(--accent)]">
            Calendar
          </Link>
          <Link href="/officer/inbox" className="text-[var(--text)]">
            Announcements
          </Link>
          <Link href="/officer/payments" className="text-[var(--text)]">
            Payments
          </Link>
        </div>
      </nav>
      <div className="mx-auto w-full max-w-6xl px-3 pb-10 pt-3 sm:px-4">{children}</div>
    </div>
  );
}
```

### 15.10 Shell inconsistencies to resolve in the revamp

| Role | Nav source | Position | Items | Active state | Bottom padding |
|---|---|---|:-:|---|---|
| `admin` | `RoleNav` | bottom | 8 | computed (`usePathname`) | `pb-24` |
| `secretary` | `RoleNav` | bottom | 4 | computed | `pb-24` |
| `member` | `RoleNav` | bottom | 2 | computed | `pb-24` |
| `super_admin` | `RoleNav` | bottom | 2 | computed | `pb-24` |
| `treasurer` | inline | bottom | 3 | **none** (all links accent) | `pb-24` |
| `officer` | inline | **top** | 3 | **hardcoded** (`/officer` always accent) | `pb-10` |

Concrete issues:

1. **Two nav implementations.** Four roles use `RoleNav`; `officer` and `treasurer` duplicate the markup inline, so any nav restyle must be applied twice by hand.
2. **Admin overflows.** 8 links in one `grid-template-columns: repeat(8, 1fr)` row at `text-xs` on a phone — labels like "Registrations" will wrap or clip. Needs a different IA (overflow menu, "More" tab, or a top rail).
3. **No active state on two roles.** `treasurer` styles every link with `text-[var(--accent)]` (no distinction); `officer` hardcodes accent on `/officer` so it stays highlighted on every sub-page.
4. **Mixed nav placement.** `officer` uses a top nav, everyone else bottom — thumb-reach is inconsistent across roles.
5. **No shared header.** Every layout is only `LogoutBar` + content + nav. No page title, breadcrumb, or back affordance is provided by the shell; each page hand-rolls its own heading.
6. **Duplicated wrapper.** The same `min-h-dvh bg-[var(--background)] pb-24` + `mx-auto max-w-6xl px-3 pt-3 sm:px-4` block is copy-pasted in five of six layouts — a single `<RoleShell links={…}>` would collapse all of §15.9 into one line per role.
7. **Unreachable routes.** `/officer/day/[date]/plan/[massId]` and `/admin/day/[date]/…` are drill-downs with no nav entry (expected), but `admin/day/[date]/session/[id]` also duplicates `secretary/session/[id]` with separate markup.

---

## 16. Revamp Module Status

Build plan lives in [`../new md/`](../new%20md/README.md) — 12 modules, 5 phases. Tracked here so this reference stays current.

| # | Module | Status | Delivered so far |
|---|---|---|---|
| 00 | Conventions | **done (gates green)** | `src/lib/api/response.ts` — §2 envelope helpers. `tsc`, lint, build all pass. |
| 01 | Framework (shell, login, register, shared components) | **in progress** — slice 1 of 4 | Toolchain installed, shadcn initialised, token remap done. Awaiting nav IA decision. |
| 02 | Auth & security | **code complete**, migrations unapplied | Role PINs, sessions, guards, `logAudit()`. Migrations 022-024 authored; **not yet applied**. Known follow-ups: `pin-service.ts` compares bcrypt hashes directly, so two hashes of the same PIN can read as different; the maintenance cron runs destructive jobs when `CRON_SECRET` is unset. |
| 03 | Registration & members | **code complete**, migrations unapplied | Public form + review queue, member directory with filters/exports, Batches tab with a two-source delete guard, per-member profile, CSV import. Migrations 025-026 authored; **not yet applied**. Gates: `tsc`, lint, 243 tests, build all pass. |
| 04 | Masses & attendance | not started | — |
| 05 | Appeals | not started | — |
| 06 | Reports | not started | — |
| 07 | Liturgy | not started | — |
| 08 | Announcements & notifications | not started | — |
| 09 | Payments | not started | — |
| 10 | Dashboards & insights | not started | — |
| 11 | Settings & system | not started | — |

### 16.1 Module 00 groundwork

`src/lib/api/response.ts` implements the module 00 §2 response contract. Nothing imports it yet — it is additive, and per §2 shared routes keep their old shape until every caller moves.

```txt
success  { ok: true, data: T }
failure  { ok: false, error: { code, message, fields? } }
```

- `API_ERROR_CODES` / `ApiErrorCode` — the stable, machine-readable code set (`REPORT_LOCKED`, `PIN_IN_USE`, `RATE_LIMITED`, …). `statusForCode()` maps code → HTTP status so 400/401/403/404/409/429/503 stay consistent.
- Response helpers: `jsonOk`, `jsonError`, plus `badRequest`, `validationFailed`, `unauthenticated`, `forbidden`, `notFound`, `conflict`, `reportLocked`, `rateLimited`, `internalError`.
- Lists (§2): `parseListQuery` reads `page`, `pageSize` (default 25, **max 100**), `q`, `sort` (`field:asc|desc`, silently dropped if malformed). `listData` / `listOk` return `{ items, total, page, pageSize }` inside `data`; `toSupabaseRange` converts a page into a Supabase `from`/`to`.
- Validation: `zodFields(error)` flattens a zod error into `Record<string, string>` for the `fields` slot, keyed by dotted path (`contact_number`), falling back to `_form` for form-level issues.
- `isApiResponse(body)` narrows an unknown parsed body for clients.

### 16.2 Outstanding before module 01

Module 00 mandates a stack that was **not installed** in this repo (verified — see §15.7). Status after the module 01 slice 1 groundwork:

| Required by §00 | Needed for | Installed | Where |
|---|---|:-:|---|
| shadcn/ui (`components/ui/`) | §1, §5 | yes | 17 primitives in `src/components/ui/` (incl. `switch.tsx`, added for the profile's Sundays-only toggle) |
| TanStack Query (D-3) | §4 | yes | `@tanstack/react-query` — **provider not yet wired** |
| React Hook Form + zod resolver | §5 | yes | `@hookform/resolvers` — used by `ui/form.tsx` |
| TanStack Table | §5 | yes | `@tanstack/react-table` — unused until first table |
| Sonner | §5 | yes | `ui/sonner.tsx` — **`<Toaster />` not yet mounted** |
| Vitest / Playwright | §9 | no | module 01 tooling slice |
| `src/features/` structure | §1 | no | arrives with first feature module (03) |
| `logAudit()` helper | §8 | no | arrives with 023 in module 02 |

**D-3 adopted:** TanStack Query is now installed. §4's dependency is satisfied.

Primitives added: `alert-dialog`, `badge`, `button`, `card`, `dialog`, `dropdown-menu`, `form`, `input`, `label`, `select`, `separator`, `sheet`, `skeleton`, `sonner`, `table`, `textarea`.

Two dependencies the shadcn CLI did **not** add and had to be installed by hand: `class-variance-authority` (imported by `badge.tsx` and `button.tsx`) and `clsx` + `tailwind-merge` (required by the `cn()` helper).

### 16.3 Token remap — how the two layers coexist

`src/app/globals.css` now carries two layers, because the app's original tokens and shadcn's names collide on two names:

| Name | App layer (pre-existing) | shadcn layer (`@theme inline`) | Resolution |
|---|---|---|---|
| `--muted` | `#7a5c3d` — a **text** colour, used 236× | shadcn wants a **background** | App keeps `--muted`; shadcn's `bg-muted` maps to `--surface-2` instead |
| `--accent` | `#aa1f2a` — brand maroon, used 109× | shadcn wants a subtle hover bg | App keeps `--accent`; shadcn's `bg-accent` maps to `--surface-2`, and `text-accent-foreground` → `--accent` |
| everything else | — | — | shadcn name maps straight onto the app token |

**Why this is safe:** the app uses Tailwind *arbitrary-value* syntax only — `text-[var(--muted)]`, `bg-[var(--surface)]` — and **zero** named colour utilities (verified: 0 matches for `text-muted`, `bg-accent`, `bg-primary`, etc. across all of `src/`). So remapping shadcn's names cannot alter any existing element. Every one of the 236 `var(--muted)` and 128 `var(--surface)` call sites keeps its current colour.

Dark mode is unchanged: still one `@media (prefers-color-scheme: dark)` block redefining the app tokens, with the shadcn `@theme` layer following automatically because it is written as `var()` references. Tailwind v4's default `dark:` variant is also `prefers-color-scheme`, so it stays consistent with the existing behaviour.

**Known follow-up:** no `.dark` class and no `@custom-variant dark` yet, so a manual light/dark toggle (with localStorage persistence) is not possible until both are added. Left out deliberately rather than half-built.

### 16.4 Corrections found while reading the code

- **§5.1 FR-R1** — the public `/register` form has **no batch field** and `POST /api/register` accepts no `batch`. `registration_requests.batch` is only set by the admin at review time, and there is no public batches endpoint (resolves decision **D-8** toward adding `GET /api/public/batches`).
- `requireRole()` in `src/lib/api/guard.ts` still returns the legacy flat `{ error: "Unauthorized" }` body and returns **401 for both** "no session" and "wrong role" — §2 requires 401 vs **403** to be distinct. Scheduled for migration when its callers move.
