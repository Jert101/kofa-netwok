# Knights of the Altar Attendance Management System (KOFA‑AMS)
## Minimum Viable Product (MVP) — Detailed Specification

Version 1.0 · Status: Implemented (MVP complete) · Stack: Next.js 15 (App Router) + React 19 + Supabase

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Goals, Success Metrics & Scope](#2-goals-success-metrics--scope)
3. [Users & Roles](#3-users--roles)
4. [Authentication & Access Control](#4-authentication--access-control)
5. [Functional Requirements — Feature by Feature](#5-functional-requirements--feature-by-feature)
   - 5.1 Registration Requests (Join Workflow)
   - 5.2 Member Directory & Batches
   - 5.3 Masses & Attendance Sessions
   - 5.4 Attendance Appeals
   - 5.5 Monthly Attendance Report (Generate → Approve → Download)
   - 5.6 Data Archiving & Report Locking
   - 5.7 Auxiliary Reports (Members PDF, Top Servers, Registrations PDF, Payment Status PDF)
   - 5.8 Liturgy Planning (Assignments + Templates)
   - 5.9 Announcements
   - 5.10 Notifications (In‑App Inbox + Web Push)
   - 5.11 Payments (Structures, Recording, Voiding)
   - 5.12 Dashboards & Insight Cards
   - 5.13 System Settings & PIN Management
6. [User Flows (Step‑by‑Step)](#6-user-flows-step-by-step)
7. [Data Model (Database Schema)](#7-data-model-database-schema)
8. [API Surface](#8-api-surface)
9. [Non‑Functional Requirements](#9-non-functional-requirements)
10. [Tech Stack & Architecture](#10-tech-stack--architecture)
11. [Cron Jobs / Scheduled Work](#11-cron-jobs--scheduled-work)
12. [Out of Scope (Post‑MVP)](#12-out-of-scope-post-mvp)
13. [Deployment & Environment](#13-deployment--environment)
14. [Known Behaviors & Edge Cases](#14-known-behaviors--edge-cases)

---

## 1. Product Overview

### 1.1 Problem Statement
Parish altar‑server groups (Knights of the Altar) track service attendance manually — paper sheets per Mass, monthly tallies typed into spreadsheets, and printed attendance grids submitted to the parish office. This is slow, error‑prone, easy to lose, and gives members no visibility into their own service record. Coordinators also juggle liturgy assignments, announcements, dues/payments, and membership applications across disconnected tools (group chats, notebooks).

### 1.2 Solution
KOFA‑AMS is a mobile‑first web application that digitizes the entire lifecycle:

> **Apply → Get approved → Serve at Mass → Get recorded → Appeal mistakes → Receive monthly report → Super admin signs off → Data archived.**

Plus supporting operations: liturgy scheduling with reusable templates, announcements with push notifications, dues tracking with installments, and insight dashboards (top servers, inactive members, birthdays).

### 1.3 Target Users
| User | Description |
|---|---|
| **Admin / Moderator** | Runs the organization. Full control over members, registrations, masses, settings, and can bypass report schedules. |
| **Super Admin** | Independent signatory. Reviews generated monthly reports and formally approves or rejects them before they become official. |
| **Secretary** | Encodes attendance every Mass, reviews attendance appeals, co‑owns reports within the allowed schedule window. |
| **Officer** | Plans liturgy assignments ahead of time, posts announcements. |
| **Treasurer** | Manages payment structures (dues), records and voids payments. |
| **Member (Altar Server)** | Serves at Mass; views their attendance record, submits appeals when missed, receives announcements/birthday greetings, pays dues. |

### 1.4 Design Principles
1. **Mobile‑first** — primary usage is at the church, on phones, right after Mass.
2. **Shared‑device friendly** — one PIN per *role* (not per person); fast login on a shared tablet.
3. **Data safety over speed** — reports lock attendance data; archives are append‑only; destructive actions are guarded.
4. **Accountability** — generated reports pass through an independent approver (super admin).
5. **Low‑bandwidth tolerant** — minimal dependencies, server‑rendered lists, small payloads.

---

## 2. Goals, Success Metrics & Scope

### 2.1 MVP Goals
- G1: Replace paper attendance sheets entirely.
- G2: Produce an official, printable monthly attendance PDF with zero manual tallying.
- G3: Guarantee report integrity via a two‑step generate→approve workflow.
- G4: Let members self‑serve corrections through appeals instead of verbal follow‑ups.
- G5: Give coordinators forward‑planning tools (liturgy assignments, templates).
- G6: Track dues without spreadsheets (structures, installments, voiding).

### 2.2 Success Metrics
| Metric | Target |
|---|---|
| Time to encode attendance for one Mass | < 60 seconds |
| Time from "generate" to signed‑off monthly report | < 24 hours |
| Appeals resolved per session | 100% reviewed before month end |
| Paper forms eliminated | Registration + attendance + dues = 0 paper |

### 2.3 In Scope (MVP)
All features listed in §5.

### 2.4 Out of Scope (see §12)
Per‑member accounts/passwords, email/SMS, photo uploads, biometrics, multi‑parish tenancy, offline mode.

---

## 3. Users & Roles

### 3.1 Role Definitions
| Role | Route | Can do |
|---|---|---|
| `admin` | `/admin` | Everything: settings, PINs, members, registrations (approve/reject/bulk/edit/PDF), masses, reports (bypass schedule, previous‑month backfill, archive toggle), payments view, inbox, batches, insight cards, announcements |
| `super_admin` | `/super-admin` | Sees pending monthly reports, previews the exact PDF, **approves** or **rejects** each one; sees approved history |
| `secretary` | `/secretary` | Daily driver: calendar, encode attendance per session, review appeals (incl. **Approve all**), generate reports inside the schedule window, inbox |
| `officer` | `/officer` | Calendar view, plan future liturgy assignments, use/save/load/delete liturgy templates, post announcements |
| `treasurer` | `/treasurer` | Create/edit payment structures (with batch/all scope, deadlines, installments), record payments, void payments, download per‑structure status PDF |
| `member` | `/member` | Home (attendance history, birthdays), session detail (liturgy servers + full roster), submit attendance appeals, pay dues page |

### 3.2 Permission Matrix (key actions)
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
² Within the last‑Sunday‑after‑8 PM window unless bypassing.
³ Admin has read access to treasurer data.
⁴ Receives report‑pending and decision notifications.

---

## 4. Authentication & Access Control

### 4.1 Model — Role PINs (no user accounts)
- There are **no usernames, emails, or passwords**. Each role has one shared numeric PIN (4–12 chars).
- PINs are stored **bcrypt‑hashed** in `system_settings` under keys `pin_admin_hash`, `pin_secretary_hash`, `pin_member_hash`, `pin_officer_hash`, `pin_treasurer_hash`, `pin_super_admin_hash`.
- Fresh installs seed all PINs to `1234`; admin is instructed (and expected) to change them immediately in Settings.

### 4.2 Login Flow
```
POST /api/auth/login { pin }
  → bcrypt.compare against each role hash (order: admin, secretary, member, officer, treasurer, super_admin)
  → on match: JWT { role } signed HS256 (jose), 7-day expiry
  → Set-Cookie kofa_session (httpOnly, sameSite=lax, secure in prod)
  → response { ok: true, role }
Client redirects to ROLE_PATH[role]
```

### 4.3 Session & Middleware
- Cookie name: `kofa_session`. Verified two ways:
  - **Node routes/API**: `verifySessionToken()` using `jose`.
  - **Edge middleware**: `verifySessionTokenEdge()` — dependency‑free WebCrypto HMAC (identical algorithm) so middleware runs on the edge runtime.
- Middleware (`src/middleware.ts`) runs on every non‑static route:
  - Skips `/login`, `/register`, `/_next`, static assets, `/api` (APIs self‑guard).
  - `/` → redirect to the role's home, or `/login` when unauthenticated.
  - `/admin/*`, `/secretary/*`, `/member/*`, `/officer/*`, `/treasurer/*`, `/super-admin/*` → strict single‑role checks; mismatch ⇒ redirect to `/login`.
  - Unknown paths ⇒ `/login`.
- **API authorization**: every API route independently calls `requireRole(cookieHeader, allowedRoles[])` which returns `{ ok: true, session }` or a ready 401 response. There is no global API middleware by design (defense in depth is per‑route).

### 4.4 Feature Flag via Super Admin PIN
- If `pin_super_admin_hash` is set (non‑empty), the **report approval workflow activates**:
  - New reports are created with `status = 'pending'`, archiving is deferred,
  - a notification is sent to `super_admin`,
  - non‑approved PDFs are not downloadable by admin/secretary.
- If unset, reports behave legacy: instantly `approved`, archiving proceeds normally.

---

## 5. Functional Requirements — Feature by Feature

### 5.1 Registration Requests (Join Workflow)
**Actors:** Public applicant, Admin.
**Entry point:** `/register` (public).

**FR‑R1 Application form fields**
- First name*, Last name*, Middle initial (optional), Date of birth*, Gender (male/female)*, Contact number*, Batch (optional dropdown fed from `member_batches`).

**FR‑R2 Submission**
- Creates `registration_requests` row with `status='pending'`, `reviewed_at=NULL`.
- Duplicate tolerance is allowed at this stage (dedupe happens on approval via unique active-name index).

**FR‑R3 Admin review UI** (`/admin/registrations`)
- Tabs: Pending / Approved / Rejected.
- Per row actions: **Approve**, **Reject**, **Edit** (correct typos before approving), **Change status** (e.g., rejected → pending again).
- **Bulk approve / bulk reject** of all currently listed pending rows (confirmation required).
- Export current tab to PDF (`GET /api/admin/registration-requests/pdf`).

**FR‑R4 Approval semantics**
- Approve ⇒ insert into `members` (full_name composed from parts, plus DOB/gender/contact/batch), set request `status='approved'`, `reviewed_at=now()`.
- Name conflicts with an existing active member surface as a DB unique‑violation error shown to the admin.
- Reject ⇒ `status='rejected'`, `reviewed_at=now()`; reversible via Change status.

### 5.2 Member Directory & Batches
**Actor:** Admin.

**FR‑M1 Directory** (`/admin/members`)
- Columns: Name, Batch, Gender, DOB, Contact, Active flag.
- Filters: batch, gender, status (active/inactive), birth month (for birthday lists).
- Inline toggle active/inactive (soft delete — records are never hard‑deleted).
- Add/edit member with validation; unique constraint on `lower(trim(full_name)) WHERE is_active`.

**FR‑M2 Batches**
- CRUD year strings (e.g., `2025`) in `member_batches` (Settings page).
- Used to tag members at registration/edit time and to scope payment structures.

**FR‑M3 Members list PDF** (`GET /api/admin/members/pdf?batch&gender&status&birth_month`)
- Landscape A4, brand header (church name, title incl. applied filters, total count, generated timestamp).
- Columns: `#, Full name (Last, First M.), Date of Birth, Gender, Batch, Contact Number` — em‑dash for blanks.

### 5.3 Masses & Attendance Sessions
**Actors:** Admin (config), Secretary (daily ops).

**FR‑A1 Mass catalog**
- Admin defines recurring Mass types (name, e.g. *"5:30 AM Anticipated"*, optional `default_sunday` flag). Soft‑deactivate only.

**FR‑A2 Sessions = one Mass on one date**
- `attendance_sessions(session_date, mass_id)` — unique per (date, mass).
- Created ad hoc by the secretary from the day view: pick date → pick mass → open roster.

**FR‑A3 Encoding attendance**
- Roster shows all active members with search; tap to mark present (insert `attendance_records`), tap again to remove.
- Free‑text notes per session supported.
- Live counters: present count / total.

**FR‑A4 Session locking**
- Any write path (encode, edit, appeal submit, appeal approve) calls `guardReportNotGenerated(session_date)`:
  - If a `reports` row exists for that month (status ≠ `rejected`), respond `409` with a clear message.
  - Rejected reports unlock the month (report was voided).

### 5.4 Attendance Appeals
**Actors:** Member (submit), Admin/Secretary (review).

**FR‑AP1 Member submission** (on a session detail page, appeal card pinned to the **top** for clarity)
- Search a member by name (server‑search endpoint, debounced 180 ms).
- Multi‑select chips (up to 40 per appeal).
- Names already on the roster **or** already having a pending appeal for that session are blocked client‑side (`member_ids_cannot_appeal` from the session API) — tapping one opens a modal: *"Cannot appeal — already on the attendance list or has a pending appeal."*
- Submit triggers a full‑screen portal overlay (*"Recording attendance… do not leave this page"*), `beforeunload` guard while in flight, and Back button disabled via `aria-busy` state lift.
- Result is a **modal dialog** (never silent):
  - Success (manual review): *"Appeal submitted — will be reviewed."*
  - Success (auto‑approve mode): *"Appeal approved — attendance updated."*
  - Conflict (400): the server error is surfaced verbatim in a modal titled *"Appeal not submitted."*

**FR‑AP2 Review UI** (admin session page & secretary session page)
- Lists pending items (deduped per member, newest first): name + submitted timestamp.
- Per item: Approve / Reject buttons.
- **Approve all (N)** button above the list for bulk resolution:
  - While running, an overlay covers the whole appeals panel (blocks taps, prevents partial saves),
  - server does one atomic pass (below), then roster + list refresh.
- Individual buttons are disabled during bulk run.

**FR‑AP3 Approve semantics (single item)**
1. Verify item still `pending`.
2. Report‑lock check on the session date.
3. Upsert `attendance_records(session_id, member_id)` (ignore duplicates).
4. Delete **all** pending items for that same member across every appeal of that session (cross‑appeal dedupe).
5. Prune parent `attendance_appeals` rows left with zero items.
6. Fire push notification `notifyAttendanceSessionUpdated(sessionId)` (void‑safe on serverless).

**FR‑AP4 Approve‑all semantics** (`POST .../appeals/approve-all`)
1. Role gate admin/secretary; session must exist; report‑lock check once.
2. Collect all pending items for the session; 400 if none.
3. One upsert of all unique member_ids (ignoreDuplicates).
4. Delete those items in one call; prune empty parents; single push notify.
5. Respond `{ ok, approved_count }` → UI toast/modal *"All N pending appeals approved."*

**FR‑AP5 Reject semantics**
- Item row is deleted (design choice: resolved items never accumulate); empty parents pruned.

**FR‑AP6 Auto‑approve mode**
- Setting `attendance_auto_approve_appeals=true` (Admin → Settings checkbox) makes POST appeals skip review entirely: directly upsert attendance and return `auto_approved: true`.

### 5.5 Monthly Attendance Report (the core deliverable)
**Actors:** Secretary/Admin (generate), **Super Admin (approve)**, Admin (archive controls).

**FR‑RP1 Eligibility gate** (`GET /api/reports/can-generate`)
- Church‑timezone aware (`report_timezone`, default `Asia/Manila`).
- Window rule: **last Sunday of the target month, from 20:00 local** onwards (`canGenerateMonthlyReport`).
- One report per `report_month` (unique index). Existing **pending** ⇒ reason *"A report for this month is pending approval."*; existing **approved** ⇒ *"already exists"*. A **rejected** report is auto‑treated as absent (regeneration allowed; the old row is deleted at generate time).
- Admin extras: `bypass_schedule` flag and previous‑month backfill (`month_start` param) when the previous month has no non‑rejected report.

**FR‑RP2 Column selection preview**
- `GET /api/reports/month-sessions?month_start=YYYY-MM-DD` lists every session in the month that has ≥1 attendance record (weekday + weekend Masses alike), labeled `EEE, MMM d, yyyy · MassName`.
- Generator requires ≥1 selected session; validates all IDs belong to the month.

**FR‑RP3 Grid construction** (`weekend-grid.ts`)
- Columns grouped by calendar date (multi‑Mass days share a group), stable ordering.
- Cell kinds: served / absent / not‑scheduled.
- Remarks derived from served count over **included** sessions only.

**FR‑RP4 PDF rendering** (`pdf.ts`, jsPDF + autotable)
- Landscape A4/A3 auto‑fit: rows = all active members (Last, First M.), column groups by date with Mass sub‑labels, green/red cells, remarks column, totals footer, logo watermark if `public/logo.png` exists, header = church name/address/title + month label + generated‑at in church TZ.

**FR‑RP5 Persistence & workflow states**
```
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
- **Pending path:** archiving skipped regardless of toggle; notification `to_role='super_admin'` *"Monthly report pending approval"*.
- **Legacy path:** archiving per admin toggle; peer notification admin↔secretary as before.

**FR‑RP6 Super admin review** (`/super-admin`, `/super-admin/reports`)
- Dashboard tile with pending count.
- Two sections: **Pending review** and **Approved** (each card: title, generator role, timestamp).
- Actions per pending card: **View PDF** (streams the stored base64 with attachment headers) · **Approve** · **Reject**.
- Server enforces transition `pending → approved|rejected` only (409 otherwise), stamps `reviewed_by='super_admin'`, `reviewed_at=now()`.
- Decision notification pushed to the originating role (`generated_by`) with the month label.

**FR‑RP7 Visibility rules**
- Admin/Secretary list (`GET /api/reports`) returns every report including `status`; the UI renders badges **Pending approval** / **Rejected**, replacing the download button with a status pill for non‑approved rows.
- `GET /api/reports/[id]/pdf`: `super_admin` may fetch any; admin/secretary may fetch **approved only** (403 otherwise).

**FR‑RP8 Regeneration after rejection**
- Because rejected rows don't count as "existing," the month reopens: secretary/admin regenerate (fresh selection), the stale rejected row is deleted first, and a new pending report enters review.

### 5.6 Data Archiving & Report Locking
**FR‑AR1 Archive‑at‑generate (legacy/admin path)**
- Toggle (default ON, admin‑only to disable): after PDF creation, copy the month's sessions + records into `attendance_sessions_archive` / `attendance_records_archive` (denormalized names preserved), stamp `report_id`, then delete live sessions (cascade removes records).

**FR‑AR2 Deferred archiving (approval path)**
- When a report is `pending`, archiving is intentionally withheld. After approval, the admin may flip the per‑report **Archive switch** in Past reports (`POST /api/reports/[id]/archive-data`, admin only, idempotent via `summary_json.data_archived` and existence probe).

**FR‑AR3 Locking recap**
- Live month data frozen once a non‑rejected report exists — protects the archived snapshot from divergence. Applies to: session create/update, record add/remove, appeal submit/approve.

### 5.7 Auxiliary Reports
| Report | Endpoint | Notes |
|---|---|---|
| Members list | `GET /api/admin/members/pdf` | §5.2 FR‑M3 (landscape, 6 columns) |
| Top 20 servers | `GET /api/admin/top-servers/pdf` (+ JSON `/api/admin/top-servers`) | Ranked by attendance count merged from **live + archive** tables; card on admin home |
| Registration requests | `GET /api/admin/registration-requests/pdf` | Current tab snapshot |
| Payment status per structure | `GET /api/admin/payment-structures/[id]/pdf` | Per‑member paid vs. due grid with installment breakdown; roles admin+treasurer |

### 5.8 Liturgy Planning (Assignments + Templates)
**Actors:** Officer (planner), Admin (also permitted).

**FR‑L1 Two editing modes**
- **Planned** (future dates, `liturgy_planned` keyed by date+mass): pre‑assign who serves what.
- **Session** (today/past actual session, `session_liturgy_servers` keyed by session_id): adjust on the day.
- On session creation, planned rows for that date/mass seed the session rows automatically.

**FR‑L2 Rows model**
- Ordered list (`sort_order`): `position_label` (e.g., Crucifix, Candle 1, Thurifer) + assignee = either a searched **member** (`member_id`) or **free text** (guest/name not in system).
- Add/remove/reorder rows inline; member picker uses debounced search.

**FR‑L3 Templates** (`liturgy_templates` + `liturgy_template_slots`, migration 021)
- **Save as template:** name + current position labels (≥1 validated) → persists slot list; appears immediately in dropdown with slot count.
- **Load template:** replaces the editor's rows with the template slots (members cleared, ready to assign); explicit confirmation message.
- **Delete:** trash button beside the selected template (confirm dialog).
- Ownership: `created_by` stores creating role; any officer/admin may reuse all templates (shared library).

### 5.9 Announcements
- Creators: admin, secretary, officer, and `system` (automated birthday posts — see §11).
- Fields: title, body, optional linkage remnants kept nullable for compatibility.
- **Auto‑expiry:** `delete_at` timestamp (default horizon configurable at creation); cleanup handled lazily/cron side.
- Feed surfaces newest first on member home & relevant dashboards; deletion restricted to creator role/admin.

### 5.10 Notifications
**In‑app inbox**
- `notifications(from_role, to_role, title, body, read_at)`; readers filter `to_role = session.role`.
- Emitters today: report generated (peer), report pending (→super_admin), report approved/rejected (→originator), registration outcomes (→admin), appeal activity (contextual).
- Inbox pages per role mark items read individually or in bulk; unread badge on nav.

**Web Push**
- `push_subscriptions(endpoint UNIQUE, p256dh, auth)`; service worker `sw.js` handles `push` + `notificationclick`.
- VAPID keys via env; `web-push` library server‑side.
- `notifyAttendanceSessionUpdated(sessionId)` fans out to subscribed devices when rosters change (appeals approved etc.). Errors logged, never thrown (fire‑and‑forget `void`).

### 5.11 Payments
**Actor:** Treasurer (+read admin).

**FR‑P1 Structures** (`payment_structures`)
- `name, amount>0, deadline?, installment_months>0?, is_active, for_all:boolean, batch? `
- Scoping: `for_all=true` applies to everyone; else targets a specific `batch` (FK years list).

**FR‑P2 Recording payments** (`payments`)
- Pick structure → pick member (batch‑aware suggestions honoring scope) → amount (defaults to structure amount, editable, >0) → `paid_at` date (default today) → optional notes.
- Running per‑member totals computed on the fly (sum of non‑voided payments vs. prorated expectation by installments/deadline).

**FR‑P3 Voiding**
- Soft flag `voided=true` (audit preserved; excluded from totals; irreversible in MVP UI).

**FR‑P4 Status PDF** — see §5.7 table.

### 5.12 Dashboards & Insight Cards
| Card | Where | Logic |
|---|---|---|
| **Inactive members** | Admin home | Zero attendance records in the **last 2 complete months** (live ∪ archive), excluding never‑active members |
| **Top servers** | Admin home | Top 20 by lifetime count (live + archive), ties alphabetical |
| **Birthdays today** | Member home + system announcement | `date_of_birth` MM‑DD matches today in church TZ |
| **Appeal indicators** | Secretary calendar | Dates with pending appeal items highlighted via `month-indicators` endpoint |
| **Report status strip** | Reports panel | Ready / Outside schedule / Pending approval / Already exists — driven by `can-generate` payload incl. `super_admin_configured` |
| **Payments summary** | Treasurer home | Collected this month, outstanding per structure |

### 5.13 System Settings & PIN Management
- Settings keys (single row per key): `church_name`, `church_address`, `report_title`, `report_timezone`, `attendance_auto_approve_appeals`, six `pin_*_hash` entries.
- Admin Settings page sections: Report header (church identity + TZ), Batch manager, Auto‑approve toggle, **PIN management** grid (one form per role incl. Super Admin, labeled *"Super Admin (report approval)"*; 4–12 chars, confirm match, bcrypt(10)).
- Changing the super admin PIN **activates/deactivates** the approval workflow implicitly (presence of a hash).

---

## 6. User Flows (Step‑by‑Step)

### Flow A — New member joins end‑to‑end
1. Applicant opens `/register`, fills 7 fields, submits → sees confirmation.
2. Admin → Registrations → Pending tab sees the row.
3. Admin taps **Edit** to fix a typo'd contact number, then **Approve**.
4. Row moves to Approved; new active member now appears in directory, attendance roster, and search everywhere.

### Flow B — Sunday attendance encoding + appeal
1. Secretary logs in with secretary PIN → Calendar → picks today → creates/selects session for the closing Mass.
2. Taps names as servers arrive (counter updates). Saves. Lock icon appears later once report exists.
3. Member "Juan" served but wasn't ticked. Juan opens the session on his phone → appeal card (top of page) → searches *"Juan Dela Cruz"* → adds chip → **Submit appeal**.
4. Overlay spins ~1 s → success modal *"Appeal submitted."*
5. Secretary gets calendar highlight; opens session → Appeals panel → taps **Approve all (2)**.
6. Overlay *"Saving approved attendances…"* blocks the panel; on completion both appeals vanish, roster shows Juan, push notification fires.

### Flow C — Month‑end report with super admin sign‑off
1. Last Sunday, 8:05 PM church time. Secretary → Reports → status pill **Ready to generate**.
2. Preview lists 9 Mass days; secretary unticks one low‑turnout weekday, keeps 8 → **Generate report**.
3. Server builds PDF, saves `status='pending'`, notifies super_admin. Secretary's Past reports shows the row badge **Pending approval** (no download button).
4. Super admin logs in → dashboard shows **1 pending** → Reports → **View PDF** (reviews the grid) → **Approve**.
5. Secretary receives *"Report approved"* notification; download button replaces badge; admin later flips the Archive switch → month data moves to archive, live tables cleared, month locked thereafter.

### Flow D — Rejection loop
1. Super admin spots a missing column (a session was unticked) → **Reject** with notification back.
2. Secretary's report row turns **Rejected**; `can-generate` flips back to Ready (rejected doesn't count).
3. Secretary regenerates including all 9 days → new **pending** report replaces the deleted rejected row → review resumes.

### Flow E — Dues collection
1. Treasurer creates structure *"Annual Dues ₱500"* deadline Mar 31, installments 2, `for_all`.
2. Records partial payments per member as they come; accidentally records ₱500 twice for Juan → **Void** the second.
3. End of period: downloads the structure PDF → grid shows each member, paid Σ, remaining balance, installment progress → prints for the parish bookkeeper.

---

## 7. Data Model (Database Schema)

All tables RLS‑enabled; only the server's **service‑role key** operates (no client‑side Supabase writes). Migrations are additive, numbered `001…022`.

### Core
```txt
system_settings(key PK, value, updated_at)

members(id, full_name, is_active=true, date_of_birth?, gender? male|female,
        contact_number?, batch? →member_batches(year), created_at, updated_at)
  ↳ UNIQUE(lower(trim(full_name))) WHERE is_active

masses(id, name, default_sunday=false, is_active=true)

attendance_sessions(id, session_date, mass_id→masses, notes?)
attendance_records(id, session_id→sessions CASCADE, member_id→members,
                   UNIQUE(session_id, member_id))
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
                      gender ∈{male,female}, contact_number,
                      status ∈{pending,approved,rejected} DEFAULT 'pending',
                      batch?, reviewed_at?, created_at)

member_batches(id, year UNIQUE, created_at)
```

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
| PATCH | `/api/admin/registration-requests/[id]` | admin | approve/reject/update/change‑status |
| POST | `/api/admin/registration-requests/bulk` | admin | `{action, ids[]}` |
| GET | `/api/admin/registration-requests/pdf` | admin | tab snapshot PDF |

### Members & batches
| Method | Path | Roles |
|---|---|---|
| GET | `/api/members/search?q=` | admin, secretary, officer, member(limited) |
| GET/POST/PATCH | `/api/admin/members*` | admin |
| GET | `/api/admin/members/pdf` | admin |
| GET/POST/DELETE | `/api/admin/member-batches` | admin |
| GET | `/api/admin/top-servers(.pdf)` | admin |
| GET | `/api/admin/inactive-members` | admin |

### Masses / sessions / attendance
| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST | `/api/masses*` | admin | catalog CRUD |
| GET/POST | `/api/attendance/sessions*` | admin, secretary | create/find by date |
| GET/PATCH | `/api/attendance/session/[id]` | mixed | detail incl. `member_ids_cannot_appeal`, liturgy lines |
| PUT | `/api/attendance/session/[id]/records` | admin, secretary | replace roster (report‑locked) |

### Appeals
| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/api/attendance/session/[id]/appeals` | member | submit; auto‑approve branch |
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
| GET/PATCH | `/api/notifications` | role‑scoped reader |
| POST | `/api/push/subscribe` | any logged‑in |
| GET/POST | `/api/treasurer/payment-structures*` | treasurer, admin(read) |
| GET/POST | `/api/treasurer/payments*` (+ void PATCH) | treasurer, admin(read) |
| GET | `/api/admin/payment-structures/[id]/pdf` | treasurer, admin |
| GET/PATCH | `/api/admin/settings` | admin |
| POST | `/api/admin/pins` | admin |

---

## 9. Non‑Functional Requirements

| Category | Requirement |
|---|---|
| **Security** | httpOnly SameSite=Lax cookies; HS256 JWT 7d; bcrypt cost 10; no secrets client‑side; service‑role key only in Node server; per‑route role guards; SQL via parameterized Supabase client; Zod validation on every mutating endpoint. |
| **Privacy** | Minimal PII (name, DOB, gender, contact). No photos/IDs in MVP. PDFs transmitted over TLS with `Cache-Control: no-store`. |
| **Integrity** | Unique constraints (active names, session×member, month×report); state machines (request status, report status); report‑lock guards; idempotent archive; append‑only archives. |
| **Performance** | Debounced search (180 ms); paginated/limited queries (≤200 appeals, ≤40 appeal items, top‑20 aggregates); PDF gen <3 s typical month (~50 members × ≤15 cols); edge middleware for route gating. |
| **Reliability** | Fire‑and‑forget push with try/catch; birthday cron resilient to partial failures; build passes `next build` with strict TS (zero `any` leaks in touched code). |
| **Usability** | Mobile thumb‑reach nav (bottom bar); min touch target 44 px (`min-h-11/12`); optimistic counters with server refresh; blocking overlays wherever double‑tap could corrupt data (submit appeal, approve all, save attendance). |
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
    login/ register/
  components/                         # ReportsPanel, AttendanceAppealForm/Review,
                                      # LiturgyServerEditor, cards, LogoutBar…
  lib/
    auth/{roles,session,jwt-edge,pin-login,constants}
    api/guard.ts
    reports/{rules,weekend-grid,pdf,generate,archive-month,check-report-lock,
             members-pdf,top-servers-*}
    push/attendance-notify.ts
    settings/{keys,store}.ts
    supabase/admin.ts
  middleware.ts
supabase/migrations/001…022.sql
public/{logo.png, sw.js}
```

---

## 11. Cron Jobs / Scheduled Work

| Job | Schedule | Behavior |
|---|---|---|
| **Birthday greeter** | Daily **00:00 UTC (=08:00 PHT)** `GET /api/cron/birthday` (secret header) | Finds active members whose MM‑DD equals today in church TZ → inserts `system` announcement + optional push; awaits the push promise (fixed from earlier fire‑and‑forget loss on serverless) and logs errors even in production |
| Announcement sweep | Lazy on read + optional daily hook | Deletes rows past `delete_at` |

*(Vercel Cron config in `vercel.json`; secret via `CRON_SECRET`.)*

---

## 12. Out of Scope (Post‑MVP)

- Per‑person accounts, password resets, OAuth/email login
- Email/SMS channels; WhatsApp/Telegram bots
- Photo upload (profile, event gallery); QR self check‑in kiosk
- Offline‑first attendance with sync queue
- Multi‑parish / multi‑organization tenancy; white‑label theming UI
- Advanced analytics (trend charts, export XLSX, scheduled email digests)
- Financial ledger features (expenses, reports to donors, receipts numbering)
- Audit log UI (currently implicit via timestamps/roles)
- Localization (i18n) beyond English/Filipino‑neutral copy

---

## 13. Deployment & Environment

**Host:** Vercel (Node runtime functions) + Supabase (Postgres + storage unused in MVP).

```env
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=     # server-only
JWT_SECRET=                    # ≥16 chars
VAPID_PUBLIC_KEY= / VAPID_PRIVATE_KEY= / NEXT_PUBLIC_VAPID_PUBLIC_KEY=
CRON_SECRET=
```

**Release checklist**
1. Apply migrations `001→022` in order (all idempotent `IF NOT EXISTS`/`ON CONFLICT`).
2. Set env vars; deploy.
3. Log in with seeded `1234` admin PIN → **immediately rotate all six PINs** (Settings).
4. Fill Report header (church name/address/timezone), create batches, import/add members.
5. Configure Masses; subscribe a test device for push; dry‑run: register→approve→session→appeal→approve‑all→generate(bypass)→super-admin approve→download→archive.

---

## 14. Known Behaviors & Edge Cases

1. **Rejected reports unlock months** — deliberate: rejection voids the snapshot so attendance can be corrected and regenerated; archives tied to the deleted row are orphaned but harmless (`report_id` SET NULL).
2. **Approval feature flag** — deleting/clearing the super admin PIN silently returns the app to instant‑approve reporting (useful for small chapters without a signatory).
3. **Cross‑appeal dedupe** — approving one appeal item resolves the same member's duplicates across *other* submissions of that session (prevents double roster inserts racing).
4. **Bulk approve overlay scope** — overlay covers the appeals panel only; page navigation is still possible but pointless post‑completion; individual buttons disabled meanwhile.
5. **Member search privacy** — search returns minimal fields; member role may search solely to file appeals (server still enforces cannot‑appeal list).
6. **Timezone pitfalls avoided** — all schedule math uses the church TZ setting, never server‑local; DOB comparisons use MM‑DD strings, immune to year formatting.
7. **Base64‑in‑DB PDFs** — simple + transactional for MVP; known ceiling ~ a few hundred KB/report; move to object storage if months exceed ~200 members × 20 columns.
8. **Legacy reports** — pre‑022 rows read as `status='approved'` via column default; UI badges only appear for explicitly `pending`/`rejected`.
