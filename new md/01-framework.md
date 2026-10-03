# 01 — Framework

**Status:** Code complete. shadcn setup, theme mapping, the `sidebar-07` desktop sidebar (demo data stripped), a phone drawer (the bottom tab bar was removed), six role layouts, a shared `lib/nav/config.ts`, the `/login` and `/register` rebuilds, the PWA App menu, the dark-mode toggle (Light/Dark/System, persisted, in the account menu and on `/login`), and the `--accent`/`--muted` token rename to `--brand`/`--text-muted`. `tsc`, `lint`, 1209 unit tests and `build` all pass, as do all 42 Playwright tests (21 flows at 375px and 1280px) run locally against the real database. **Visual QA at 375px and 1280px is outstanding** -- no page has been checked by eye.
**Roles:** all
**Depends on:** nothing
**Size:** M

## 1. Purpose

Replace the six hand-built layouts and the flat component folder with one professional app shell and a small shared component kit. Every later module plugs into it.

## 2. Current behavior

- Six role layouts. Four use `RoleNav`; `officer` and `treasurer` copy the markup inline (repo `README.md` §15.8–15.10).
- Bottom nav only. The admin's 8 links overflow on a phone. Two roles have no correct active state.
- No shared header, so each page hand-rolls its heading.
- Custom CSS variables for the maroon and gold theme. No shadcn.
- `/login` and `/register` are hand-built pages.

## 3. Target scope

| ID | Item | Type |
|---|---|---|
| FW-1 | shadcn/ui installed and themed with the existing palette (light and dark) | Change |
| FW-2 | One `AppShell`: collapsible sidebar on desktop, drawer plus bottom tab bar on phones | Change |
| FW-3 | Nav defined once in `lib/nav/config.ts`, one config per role | Change |
| FW-4 | Login page rebuilt from `login-01`, single PIN field | Change |
| FW-5 | Register page rebuilt from `signup-01` as the membership application form | Change |
| FW-6 | Shared component kit (section 6) | New |
| FW-7 | Dark mode toggle (Light, Dark, System) | New |
| FW-8 | Test tooling: Vitest and Playwright | New |
| FW-9 | Unused legacy components removed (`RoleNav`, `LogoutBar`) | Cleanup |

## 4. Screens

### 4.1 App shell

- **Desktop (≥768 px):** flush sidebar (not floating) that collapses to icons. Header shows the current page title. Footer of the sidebar has the account menu.
- **Phone:** the sidebar becomes a drawer opened from the ☰ button in the header. It shows the role label and the full menu. **There is no bottom tab bar** — the user overrode the spec during the build.
- **Account menu:** shows the role, theme switch (Light, Dark, System), and Log out.
- **Sidebar footer:** Log out, plus the **App** menu (PWA install + push notifications, moved out of the floating bottom-right button into the sidebar footer at the owner's request).
- **Active item:** matches the page or any of its child routes. Day and session pages keep their parent highlighted.
- **Content width:** `max-w-6xl`, centered, same as today so existing pages do not shift.

Written so far: `src/lib/nav/config.ts`, `src/components/layout/AppShell.tsx`, `src/components/layout/AppSidebar.tsx`, `src/components/layout/AppProviders.tsx`, `src/components/layout/RoleHeader.tsx`, `src/components/layout/LogoutButton.tsx`, `src/components/layout/PageHeader.tsx`, `src/components/login-form.tsx`, `src/components/signup-form.tsx`, `src/features/registrations/schemas.ts`, `src/app/api/public/batches/route.ts`, `src/components/shared/EmptyState.tsx`, `src/components/shared/StatusBadge.tsx`, the six role `layout.tsx` files, the shadcn variable mapping in `globals.css`, and the `sidebar-07`/`login-01`/`signup-01` blocks (demo content stripped).

Not yet written: `src/components/theme-provider.tsx` — the theme switch described in this section is **not built**; it still goes into the sidebar footer next to Log out. `MobileTabBar.tsx` was built then removed when the bottom tab bar was scrapped.

### 4.2 Login (`/login`, public)

- One card: logo, title "Sign in", one field labelled "PIN", button "Sign in".
- PIN field: `type="password"`, `inputMode="numeric"`, `autocomplete="one-time-code"`, autofocus, show/hide toggle. Accepts 4–12 characters.
- No email, password or "forgot password" text.
- Submit calls `POST /api/auth/login`, then goes to the role's home (`ROLE_PATH`).
- Errors appear under the field and are announced with `aria-live="polite"`:
  - 401: "That PIN isn't right. Check it and try again."
  - 429: "Too many attempts. Try again in {minutes} minutes."
  - Network: "Can't reach the server. Check your connection."
- While submitting, the button shows a spinner and the field is disabled.
- A signed-in user who opens `/login` is redirected to their home.

### 4.3 Register (`/register`, public)

The public membership application. Seven fields, all validated with one Zod schema shared with the API.

| Field | Rule |
|---|---|
| First name | required, 2–60 chars, trimmed |
| Last name | required, 2–60 chars, trimmed |
| Middle initial | optional, one letter |
| Date of birth | required, a real date in the past |
| Gender | required, male or female (matches the database check) |
| Contact number | required, digits only after normalizing, 10–13 digits, accepts `09…` and `+63…` |
| Batch | optional, dropdown of batch years |

- Submit calls `POST /api/register`.
- On success the form is replaced by a confirmation card: "Application received. An admin will review it." (Module 03 adds a reference code to this card.)
- Public endpoint protections (honeypot field, minimum fill time, rate limit) are added in module 02.
- The batch list needs a public source. Decision D-8: confirm what the page calls today.

### 4.4 Page header

Pages inside the shell use `PageHeader` for their own heading, description and primary action. The shell header shows only the section title, so pages do not repeat it.

## 5. Behavior rules

- Middleware and role guards are unchanged in this module.
- Role layouts stay server components that render `AppShell`. Module 02 adds the session-validity check to them.
- The tab bar shows at most four items. More than four is a config error.
- Theme preference is stored by `next-themes` and follows the OS by default.

## 6. Shared component kit

Build these once. Later modules must use them instead of writing their own.

| Component | Purpose |
|---|---|
| `PageHeader` | Title, description, actions slot, optional back link |
| `DataTable` | Server-side pagination, sort, search, column visibility, row selection, empty and loading states |
| `EmptyState` | Icon, message, one action |
| `ConfirmDialog` | Wraps `AlertDialog`; takes an action label and a destructive flag |
| `BlockingOverlay` | Full-area overlay with message, `aria-busy`, `beforeunload` guard |
| `StatusBadge` | Text plus color for statuses (pending, approved, rejected, locked, voided) |
| `FormField` helpers | Label, control, error, hint, wired to React Hook Form |
| `MemberCombobox` | Debounced (180 ms) member search, used by attendance, liturgy, payments |
| `DateBadge` | A calendar date shown in church time |
| `ErrorState` | Message and retry button |

## 7. API

No new routes. `POST /api/auth/login` and `POST /api/register` keep working. Both move to the standard response shape from [00-conventions.md](00-conventions.md) with the login and register screens; the client handles the old shape until then.

## 8. Data

None.

## 9. Edge cases

- A user whose session expires mid-use gets a 401 from an API call. The client shows "Your session ended. Sign in again." and redirects to `/login`.
- The bottom tab bar must not cover the last row of content. The content wrapper adds bottom padding on phones.
- The sidebar state (collapsed or open) persists in a cookie so it does not flash on reload.
- The `sidebar-07` block ships demo teams and projects. Remove all demo data.

## 10. Acceptance criteria

- [x] `npx shadcn@latest init` is done and `components.json` exists. Theme matches the current maroon and gold in light and dark.
- [x] Legacy `--accent` and `--muted` usages are renamed to `--brand` and `--text-muted`; no page lost its colors. 148 `--accent` and 444 `--muted` references, renamed by exact-match `var()` substitution so shadcn's own `--color-accent` primitive could not be caught. `--accent-soft` went with them as `--brand-soft`, because leaving one behind next to `--brand` would have been worse.
- [x] All six roles render inside the new shell. Each shows its own menu.
- [x] The bottom tab bar was removed at the owner's request. Navigation is one flush sidebar (drawer on phones) from `lib/nav/config.ts`.
- [ ] Every page shows the correct active item, including day and session pages. (Pending visual QA.)
- [ ] Login accepts a valid PIN and redirects by role. Wrong PIN and network errors show the messages above. (Pending live-device check.)
- [ ] Register validates all seven fields, submits, and shows the confirmation card. (Pending live-device check.)
- [x] Theme switch works and persists. No flash of the wrong theme on reload. `next-themes` with `enableSystem`, wired into `AppProviders`, and a `.dark` block in `globals.css` that is a copy of the media-query palette rather than a reference to it -- because `.dark` and `prefers-color-scheme` have to be able to disagree.
- [x] `RoleNav` and `LogoutBar` are deleted and nothing imports them.
- [x] Vitest and Playwright run with `npm test` and `npm run e2e`. Chromium only, at 375px and 1280px, one worker because they share a database. 21 flows x 2 viewports = 42 tests, all passing. The PINs come from `E2E_PIN_<ROLE>` env vars set in the shell that runs the suite, not from `.env.local`, so real PINs never land in a file. Without them the suite falls back to `1234` and the signed-in flows fail.
  - Six flows need no database and no PINs (sign-in page, theme switch, dark persistence, registration, signed-out deep link, unknown path). They are the floor: if these fail the build is broken, as opposed to the database being unready.
  - Two flows cover the AUTH-4 actor step, which is on for every role except `member` and renders on `/login` itself. Both halves matter: the whole staff half of the suite once timed out waiting for a redirect that the un-answered dialog was holding back.
  - The shell and navigation flows call `openSidebar()` first. Below `md` the sidebar is a `Sheet` that unmounts when closed, so its links are absent from the DOM rather than merely hidden.

## 11. Build tasks

1. Rename legacy `--accent` and `--muted` usages (grep, then sed). Commit alone.
2. Run `shadcn init`. Install `next-themes react-hook-form @hookform/resolvers sonner @tanstack/react-query`.
3. Replace `globals.css` with the themed file. Add the theme provider, `Toaster` and query provider to the root layout.
4. Add the blocks: `login-01`, `signup-01`, `sidebar-07`. Remove demo content from the sidebar block.
5. Drop in `AppShell`, `MobileTabBar`, `nav/config.ts` and the six layouts. Delete `RoleNav` and `LogoutBar` after a usage grep.
6. Rebuild `/login` on the login block.
7. Rebuild `/register` on the signup block.
8. Build the shared component kit, one component per commit.
9. Set up Vitest. Add the first unit test (`isActive` in `nav/config.ts`).
10. Set up Playwright. Smoke test: sign in as each role and see its menu.
11. Verify the acceptance list at 375 px and 1280 px.

## 12. Unit tests

- `isActive`: exact match for home items, prefix match for others, `also` prefixes, no false match between `/admin` and `/admin-tools`.
- Register schema: each field rule, phone normalization, future date rejected.

## 13. QA checklist

- [ ] Resize from 1280 px to 375 px with the sidebar open. No overlap, no horizontal scroll.
- [ ] Tab through the shell with the keyboard. Focus is always visible. The drawer traps focus.
- [ ] Log in and out as all six roles.
- [ ] Open a deep link (`/secretary/session/<id>`) while signed out, sign in, and confirm the redirect ends on the role home.
- [ ] Switch theme on `/login` and inside the shell.
- [ ] iOS Safari: the tab bar clears the home indicator.

## 14. Out of scope

Global search and the notification badge (module 08). Session-validity checks (module 02).
