# 09 — Payments

**Status:** Code complete. Proration, edit rules, duplicate guard, void, ledger, overdue, exports and the limited lookup are built and covered by 108 unit tests. Manual QA (section 12) not yet run.
**Roles:** treasurer (manage), admin (read), other roles (limited lookup, see decision D-9)
**Depends on:** 03
**Size:** M
**Migration:** 032 (module 08 took 031)

## 1. Purpose

Track dues without spreadsheets, and make the treasurer's day easier: safer recording, clear balances per member, an overdue view, and exports for the parish bookkeeper.

## 2. Current behavior

(repo `README.md` §5.11)
- **Structures** (`payment_structures`): name, amount, optional deadline, optional installment months, active flag, and scope (`for_all`, or one batch).
- **Payments**: choose structure, then member (batch-aware), amount (defaults to the structure amount), date (defaults to today), notes. Running totals per member are the sum of non-voided payments compared to a prorated expectation from installments and deadline.
- **Void**: soft flag, excluded from totals, irreversible in the UI.
- Per-structure status PDF with paid, due and installment progress. Roles admin and treasurer.
- Treasurer pages: home, payments, payment structures. There are also `payments` pages for admin, secretary, officer and member.
- Components: `PaymentLookup`, `ReceiptModal`.

## 3. Problems found

| # | Problem |
|---|---|
| P1 | Accidental double entries are easy (Flow E). The fix is a void, after the fact. |
| P2 | Voiding needs no reason and records nobody. |
| P3 | Editing a structure after payments exist can silently change what everyone owes. |
| P4 | No overdue list. The treasurer has to scan the PDF. |
| P5 | No per-member ledger. |
| P6 | Payments pages exist for four other roles with unclear rules. Any member may be able to look up anyone's balance. |
| P7 | The proration formula lives inside code paths and is not tested. |
| P8 | Only a PDF export. |

## 4. Target scope

| ID | Item | Type |
|---|---|---|
| PAY-1 | Structures table with safe editing rules | Change |
| PAY-2 | Record payment with balances and duplicate guard | Change |
| PAY-3 | Void with reason | Change |
| PAY-4 | Member ledger | New |
| PAY-5 | Treasurer dashboard and overdue list | New |
| PAY-6 | Exports | Change |
| PAY-7 | One limited lookup page for non-treasurer roles | Change |
| PAY-8 | Tested proration function | New |

### PAY-1 Structures

- Table: name, amount, deadline, installments, scope, active, collected, outstanding.
- Create and edit in a sheet. Fields as in the schema. Scope is a switch: Everyone or one batch.
- **Edit rules once any payment exists:** name, deadline and active can change. Amount, scope and installments are locked, with the message "Payments already exist. Create a new structure to change the amount." This protects balances.
- Deactivating hides a structure from the payment form but keeps history.

### PAY-2 Record payment

- A sheet with four steps in one view: structure, member, amount and date, notes.
- The member picker respects scope and shows each person's **remaining balance** next to the name.
- The amount defaults to the amount currently due for that member (the next installment or the remaining balance), not always the full structure amount. It stays editable and must be greater than zero.
- Date defaults to today in church time.
- **Duplicate guard:** if the same member, structure and amount were recorded within the last 10 minutes, show "This looks like a duplicate of a payment recorded at 9:41 AM. Record anyway?"
- After saving: the receipt modal, with a clear **Record another** button that keeps the structure selected.

### PAY-3 Void

- **Void payment** needs a reason (presets: Entered by mistake, Duplicate, Wrong member, Other) and records who, when and why.
- Voided rows stay in the list, greyed out with the reason, and are excluded from totals. Still irreversible in the UI.
- Only the treasurer can void. Admin cannot.

### PAY-4 Member ledger

`/treasurer/members/[id]`:
- One block per structure: due, paid, remaining, and an installment schedule showing each installment as Paid, Partly paid, Due or Overdue.
- Below, all payments (with a "Show voided" toggle). Printable.

### PAY-5 Dashboard and overdue

- Treasurer home: collected this month, outstanding per structure, overdue count.
- **Overdue list:** members whose paid amount is below the amount due as of today, sorted by how much and how long. Filter by structure and batch. Export to CSV.
- "Overdue" uses the proration function (PAY-8).

### PAY-6 Exports

- **Structure status PDF** (existing) keeps its roles and grid.
- **Payments CSV** for a date range and optional structure: date, member, structure, amount, status, notes, void reason.
- **Overdue CSV** from PAY-5.

### PAY-7 Limited lookup

- Secretary, officer and member pages are replaced by one lookup page. Search a member, see structure names and whether they are **paid up**, without amounts, unless the searcher is the declared person (D-1) or the treasurer or admin.
- Decision D-9: **resolved as recommended** -- only the treasurer and admin see all balances. Implemented in `src/lib/payments/visibility.ts` and enforced in the API, not the UI. A signed-in person always sees their own figures; everyone else sees structure names and a paid-up flag with no peso amount. This is a policy decision and is called out in the handoff.

### PAY-8 Proration function

- One pure function `amountDueByDate(structure, asOf)` and `balance(structure, payments, asOf)`, in `src/lib/payments/proration.ts`, with 53 tests.
- Decision D-7 answer: **there was no proration to paste.** The `deadline` column was stored, validated and printed but never entered an arithmetic expression, and `installment_months` only ever allocated already-paid money into the PDF's month columns. The one formula the app had, written four times with three small disagreements between them, was `paid = SUM(amount_paid WHERE NOT voided); remaining = MAX(0, amount - paid)`.
- `balance()` is that formula, extracted exactly and pinned by tests, so no total the parish has ever been shown moves.
- `amountDueByDate()` is therefore **new** behaviour and the only new rule in the module: with installments, installment `i` falls in `first_installment_month + i` and everything up to and including the month of `asOf` is due; a past deadline makes the whole amount due from the day after it; with no installments the full amount is always due, which is the old behaviour. It reuses the month anchoring the structure PDF already had, so the ledger and the PDF agree instead of each inventing a schedule.
- The last installment absorbs the rounding remainder, so installments always sum to exactly the structure amount.

## 5. API

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET/POST | `/api/treasurer/payment-structures` | treasurer, admin (read) | Pagination, totals per structure |
| PATCH | `/api/treasurer/payment-structures/[id]` | treasurer | Enforces the edit rules |
| GET/POST | `/api/treasurer/payments` | treasurer, admin (read) | Filters: structure, member, date range, voided. POST returns duplicate warning unless `confirm_duplicate: true` |
| PATCH | `/api/treasurer/payments/[id]/void` | treasurer | Body `{ reason }` |
| GET | `/api/treasurer/members/[id]/ledger` | treasurer, admin | New |
| GET | `/api/treasurer/overdue` | treasurer, admin | New. Filters, CSV via `?format=csv` |
| GET | `/api/treasurer/payments/csv` | treasurer, admin | New |
| GET | `/api/admin/payment-structures/[id]/pdf` | treasurer, admin | Unchanged |
| GET | `/api/payments/lookup?q=` | signed in | New. Limited fields per D-9 |
| GET | `/api/treasurer/summary` | treasurer, admin | New. Home cards |

## 6. Data (migration 032)

```txt
payments
  + void_reason text NULL
  + voided_at timestamptz NULL
  + voided_by_role text NULL

INDEX payments(payment_structure_id, member_id) WHERE voided = false
INDEX payments(paid_at DESC)
```

Plus `payment_structures.first_installment_month` (a nullable `YYYY-MM` anchor, defaulting to `created_at`) and five partial indexes for the ledger, the overdue list and the duplicate guard. The edit rule is enforced in the route.

## 7. Business rules

- Amounts are `NUMERIC(10,2)`, greater than zero. Show currency with the shared `format-peso` helper.
- Totals are the sum of non-voided payments.
- Overpayment is allowed and shown as a credit on the ledger.
- Scope: `for_all = true` applies to every active member; otherwise the structure's batch only. A member who moves batch later is not re-scoped for past structures.
- Members created after a structure exists are included if they fall in scope, and the schedule is prorated from today. Confirm this against the current behavior before building.

## 8. Edge cases

- Recording a payment for a deactivated member: allowed, with a note in the picker.
- Two treasurers recording at once. The duplicate guard covers the same person and amount within 10 minutes.
- A structure with a deadline in the past and no installments: everything unpaid is overdue.
- Installments with a deadline that is not on a month boundary. Follow the extracted formula; test it.
- Void a payment that made a structure's edit rules lock. Locks stay while any non-voided payment exists.

## 9. Acceptance criteria

- [ ] The payment form shows each member's remaining balance and defaults to the amount currently due.
- [ ] Recording the same payment twice within 10 minutes triggers the duplicate prompt.
- [ ] Voiding requires a reason. The row shows who, when and why. Totals exclude it.
- [ ] Editing amount, scope or installments is refused once payments exist, with the message.
- [ ] The ledger shows the installment schedule with correct statuses and matches the status PDF.
- [ ] The overdue list matches the ledger for every member. CSV exports match the screen.
- [ ] Non-treasurer roles cannot see balances they should not (D-9), verified through the API, not just the UI.
- [ ] The proration function has tests that pin today's behavior.
- [ ] Audit rows exist for the Payments actions in module 02.

## 10. Build tasks

1. Paste and extract the proration formula. Write the tests first.
2. Migration 031.
3. Structures table and safe editing.
4. Record payment sheet with balances and duplicate guard.
5. Void with reason.
6. Ledger endpoint and page.
7. Summary and overdue endpoints and dashboard.
8. CSV exports.
9. Limited lookup page and API. Remove the four old role payments pages.
10. Retire `PaymentLookup` and update `ReceiptModal` to the new design.

## 11. Unit tests

- `amountDueByDate` across installments, deadlines, no deadline, `for_all` versus batch.
- `balance` with voided payments, overpayment and zero payments.
- Duplicate detection window.
- Structure edit rules with and without payments.
- Lookup field filtering by role and declared identity.

## 12. QA checklist

Deferred to final handoff, like every other module's manual pass. The automated gates run clean; these need a real database and a real browser.

- [ ] Flow E end to end: create structure, partial payments, an accidental duplicate, void, print the PDF.
- [ ] Try to edit the amount after a payment.
- [ ] Sign in as secretary and member and search someone's balance.
- [ ] Phone: record three payments in a row quickly.

## 13. Out of scope

Receipt numbering, expenses, donor reports, online payments, refunds beyond void.
