# 10 — Dashboards & insights

**Status:** Not started
**Roles:** all (each has its own home)
**Depends on:** 04–09
**Size:** M
**Migration:** 032

## 1. Purpose

Give each role a home page that shows what needs attention and how the group is doing, using the data the other modules now collect.

## 2. Current behavior

(repo `README.md` §5.12)
- Admin home: inactive members card (no attendance in the last 2 complete months), top 20 servers (live plus archive), calendar.
- Member home: attendance history, birthdays today, announcements.
- Secretary calendar with appeal indicators. Reports panel with the status strip. Treasurer home with payments summary.
- Birthdays today appear on the member home and as a system announcement.

## 3. Problems found

| # | Problem |
|---|---|
| P1 | No sense of trend. You cannot see whether attendance is rising or falling. |
| P2 | "Inactive" is a blunt cut. Members drifting away are not seen until they hit zero for two months. |
| P3 | Nothing points a secretary or officer to what to do next. |
| P4 | Birthdays show only today. |
| P5 | Metrics are calculated in several places with slightly different rules. |
| P6 | Aggregates that read live and archive tables may be slow as history grows. |

## 4. Target scope

| ID | Item | Type |
|---|---|---|
| DSH-1 | Admin dashboard | Change |
| DSH-2 | Secretary "Needs attention" | New |
| DSH-3 | Officer "Needs attention" | New (uses module 07) |
| DSH-4 | Member home | Change |
| DSH-5 | Super admin and treasurer homes | Change |
| DSH-6 | One tested set of metric definitions | New |
| DSH-7 | Recent activity feed | New |

### DSH-1 Admin dashboard

Top to bottom:
1. **KPI row:** active members, sessions this month, average attendance per session, pending registrations, pending appeals, report status. Each links to its page.
2. **Attendance trend:** weekend attendance for the last 12 weeks (line chart). Toggle: total attendance or rate.
3. **Turnout by Mass:** average attendance per Mass type over the last 8 weeks (bar chart).
4. **Members to check in with:** the at-risk list (below), with a link to each profile.
5. **Inactive members** and **Top servers** (existing definitions, unchanged).
6. **Birthdays:** today and the next 7 days.
7. **Recent activity:** the last 10 audit entries.

Charts use the shadcn chart component (Recharts). Each has a text summary and a table alternative for screen readers.

### DSH-2 Secretary

Home is the calendar plus a **Needs attention** card:
- Past Sundays with sessions but no attendance recorded.
- Pending appeals count, linking to the queue.
- Report readiness: "Report opens Sunday 8:00 PM" or "Ready to generate".

### DSH-3 Officer

Calendar plus **Needs attention**: dates in the next 14 days with unassigned positions or no plan, linking to the planner.

### DSH-4 Member home

Top to bottom: announcements (audience-filtered), upcoming assignments, birthdays (today and this week), attendance history for the declared person if any, otherwise a search to look someone up. Appeal card lives on session pages, not here.

### DSH-5 Super admin and treasurer

- Super admin: pending count, oldest waiting time, last three decisions.
- Treasurer: collected this month, outstanding per structure, overdue count (from module 09).

### DSH-6 Metric definitions

One file, `lib/insights/metrics.ts`, with pure functions and tests. Every dashboard and profile uses them.

| Metric | Definition |
|---|---|
| **Session held** | A session with at least one attendance record. |
| **Attendance rate** (member, period) | Distinct sessions attended ÷ sessions held in the period, live plus archive. Toggle: Sundays only. |
| **Average attendance** (period) | Total records ÷ sessions held. |
| **Weekend streak** | Consecutive weekends, counting back from the latest weekend with any session, in which the member attended at least one session. |
| **Inactive** | Active member with zero attendance in the last 2 complete months (existing rule). Members who never had any attendance are excluded, as today. |
| **At risk** | Active member, not inactive, who meets either: attended 3 or more of the previous 8 weekends but none of the last 3; or a rate over the last 4 weekends at least 50 points below the rate over the 8 weekends before that. |
| **Birthdays in N days** | Compare `MM-DD` in church time. Handle 29 Feb by showing it on 28 Feb in non-leap years. |

The at-risk rule is a proposal. Adjust the numbers after looking at real data.

### DSH-7 Recent activity

- Last 10 entries from the audit log with plain-language text ("Maria Santos (Secretary) approved 3 appeals"), admin only. Links to the full audit page.

## 5. API

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/api/dashboard/admin` | admin | KPIs, trend, turnout, at-risk, activity |
| GET | `/api/dashboard/secretary` | secretary | Needs attention |
| GET | `/api/dashboard/officer` | officer | Needs attention |
| GET | `/api/dashboard/member` | member | Announcements, upcoming, birthdays |
| GET | `/api/dashboard/super-admin` | super admin | Pending summary |
| GET | `/api/admin/top-servers`, `/inactive-members` | admin | Unchanged, moved onto shared metrics |

Dashboards are read-only. Each endpoint is cached for 5 minutes with tags that attendance, appeal and report writes invalidate.

## 6. Data (migration 032)

```txt
VIEW v_attendance_all(session_id, session_date, mass_id, member_id, source_table)
  = live records joined to sessions
    UNION ALL
    archived records joined to archived sessions

INDEX attendance_records(member_id)                       -- if missing
INDEX attendance_records_archive(member_id)               -- if missing
INDEX attendance_sessions(session_date)                   -- if missing
INDEX attendance_sessions_archive(session_date)           -- if missing
```

Archive keys are composite (`id, archived_at`); the view must select the right session row for each record. Test with a month that was archived and live in the same query.

## 7. Business rules

- Dashboards show only what the role may already see. The admin dashboard never appears for other roles.
- Numbers on cards and on pages they link to must agree. Both use `metrics.ts`.
- Months are calendar months in church time.
- Empty states are meaningful: "No sessions yet this month. Create this weekend's sessions."

## 8. Edge cases

- New installation with no history. Charts show an empty state, not zeros that look like a problem.
- A month archived after being counted. The view keeps the numbers stable.
- Leap-day birthdays.
- A member with one attendance ever, three years ago. Not at risk, not counted as inactive by the "never active" exclusion rules.
- Very long member names in cards. Truncate with a tooltip.

## 9. Acceptance criteria

- [ ] The admin dashboard loads in under 1.5 seconds with 3 years of history in the database.
- [ ] The trend chart's last point equals the sum shown in that week's session pages.
- [ ] A member's rate on their profile equals the value used in any dashboard list.
- [ ] The at-risk list contains the members the rule says, verified on fixture data.
- [ ] Birthdays show today and the next 7 days, including 29 Feb handling.
- [ ] Secretary and officer "Needs attention" cards link to the right place and clear when the issue is fixed.
- [ ] Charts have text summaries and are readable in dark mode and at 375 px.
- [ ] Old metric code is removed; nothing computes a rate outside `metrics.ts`.

## 10. Build tasks

1. Migration 032. Check query plans on realistic data.
2. `metrics.ts` with fixtures and tests. Move top servers and inactive onto it.
3. Dashboard endpoints with caching and invalidation.
4. Admin dashboard components.
5. Secretary and officer cards.
6. Member, super admin and treasurer homes.
7. Recent activity feed.
8. Delete replaced cards (`InactiveMembersCard`, `TopServersCard`) once rebuilt on the shared components.

## 11. Unit tests

- Each metric on hand-built fixtures, including archive rows and empty history.
- At-risk edge cases: exactly at the thresholds, member joined recently.
- Birthday windows across month and year end, and leap day.
- Weekend grouping when a Mass falls on Saturday evening.

## 12. QA checklist

- [ ] Compare three numbers on the dashboard against a manual count.
- [ ] Archive a month and reload. Nothing changes.
- [ ] Check every dashboard at 375 px in dark mode.
- [ ] Empty database: every card has a sensible empty state.

## 13. Out of scope

Custom report builders, exports of charts, scheduled email digests, cross-year comparisons.
