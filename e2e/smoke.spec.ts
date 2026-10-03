import { expect, test, type Page } from "@playwright/test";

/**
 * FW-8: the smoke test. Module 01 build task 10: "sign in as each role and see its menu."
 *
 * ## What these tests can and cannot check
 *
 * They can check that a page renders, that the sidebar lists the items the nav config says it should, and
 * that a session survives a reload. None of that is covered by the unit suite, and all of it is the kind
 * of breakage that survives `tsc`.
 *
 * ## The PIN
 *
 * The fallback is 1234, the default every role ships with. **On any database where the PINs have already
 * been changed these tests will fail**, and they will fail in a confusing way: the login POST returns 429
 * "too many wrong PINs" and every test after that times out waiting for a redirect.
 *
 * So set the real ones. With distinct PINs per role:
 *
 *     $env:E2E_PIN_ADMIN="4821"
 *     $env:E2E_PIN_SECRETARY="7130"
 *     npm run e2e
 *
 * A 429 means "wrong PIN". Clear it by waiting out the window rather than a minute: `THROTTLE_RULES.login`
 * is 5 failures per 15 minutes, so a minute of waiting changes nothing and the next run fails identically
 * for a reason that has nothing to do with the code.
 *
 * ## The actor step, and why `member` passing is the tell
 *
 * AUTH-4 asks staff roles who is using the device before letting them in, and `require_actor_name_*`
 * defaults to on for every role except `member`. The dialog renders on `/login` itself, and the navigation
 * happens only once it is answered -- `login-form.tsx` sets the actor step and returns early, and
 * `onSelected` is what calls `router.replace`. So an unanswered dialog is indistinguishable from a failed
 * sign-in by hand: the URL never leaves `/login`, and a test waiting for a redirect times out.
 *
 * That asymmetry is the useful diagnostic. If `member` passes and every other role times out, the PINs are
 * almost certainly fine and the step is simply unanswered. One role passing proves the login route, the
 * database, the cookie and the PIN env vars all work, and none of those can be the problem.
 *
 * ## Viewports, and the closed drawer
 *
 * Every test runs twice, at `phone` and `desktop`, and a failure confined to one of them is nearly
 * always a layout difference rather than a broken feature. Below `md` the sidebar is a Radix `Sheet`,
 * and a closed `Sheet` does not hide its content -- it unmounts it. Nav links and footer controls are
 * absent from the DOM entirely, so they fail with "element(s) not found", which is indistinguishable
 * from a feature that was never built. Use `openSidebar()` before touching anything that lives in it.
 *
 * The tests need a database with migrations applied. The `no database needed` group below runs without one
 * and is the floor: if that group fails, the build is broken; if only the signed-in tests fail, the
 * database is not ready, the PINs are wrong, or the actor step changed shape.
 */

const ROLES = [
  { role: "admin", path: "/admin", menuItems: ["Members", "Registrations", "Inbox"] },
  { role: "secretary", path: "/secretary", menuItems: ["Appeals", "Inbox", "Reports"] },
  { role: "member", path: "/member", menuItems: ["Announcements", "Payments"] },
  { role: "officer", path: "/officer", menuItems: ["Announcements", "Payments"] },
  { role: "treasurer", path: "/treasurer", menuItems: ["Structures", "Overdue", "Payments"] },
  { role: "super_admin", path: "/super-admin", menuItems: ["Dashboard", "Reports", "Inbox"] },
] as const;

function pinFor(role: string): string {
  const override = process.env[`E2E_PIN_${role.toUpperCase()}`];
  return override ?? "1234";
}

/** Everything except the route the browser is on. */
const leftLogin = (url: URL) => !url.pathname.startsWith("/login");

/**
 * Sign in as a role, answering the AUTH-4 actor step when it is raised.
 *
 * Both outcomes have to be handled because they are genuinely different flows: `member` has the step off
 * by default and redirects straight away, while staff are shown a dialog that cannot be dismissed without
 * answering. Waiting for the redirect alone deadlocks the staff half of the suite for the full timeout --
 * which is what it did before this helper existed.
 */
async function signIn(page: Page, role: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/pin/i).first().fill(pinFor(role));
  await page.getByRole("button", { name: /^sign in$/i }).click();

  const dialog = page.getByRole("dialog");

  // Whichever lands first. Both are caught so the loser does not surface as an unhandled rejection, and
  // so a slow-but-correct sign-in is not reported as a navigation failure.
  await Promise.race([
    page.waitForURL(leftLogin, { timeout: 20_000 }).catch(() => undefined),
    dialog.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined),
  ]);

  if (await dialog.isVisible()) {
    // The dialog is not skippable for staff, so the first member in the list is the only way through.
    // It is a real `POST /api/auth/actor`, which is the point: this exercises the same write a person does.
    await dialog.getByRole("button").first().click();
    await dialog.waitFor({ state: "hidden", timeout: 20_000 });
  }

  // Uncaught on purpose. If the flow did not complete, this is where it should fail and say so.
  await page.waitForURL(leftLogin, { timeout: 20_000 });
}

/**
 * Open the sidebar when the viewport is too narrow to show it.
 *
 * Below `md` the sidebar is a Radix `Sheet`, and a closed `Sheet` unmounts its content outright rather
 * than hiding it. The nav links and the footer controls are therefore not in the DOM at all, so a test
 * looking for them fails with "element(s) not found" instead of "not visible" -- which reads like a
 * missing feature rather than a closed drawer, and is why half this suite failed on `phone` only.
 *
 * Desktop needs nothing, hence the guard: the trigger is rendered there too and clicking it would
 * *collapse* the sidebar instead of opening it.
 */
async function openSidebar(page: Page): Promise<void> {
  const drawer = page.locator('[data-sidebar="sidebar"]');
  if (await drawer.isVisible()) return;

  // `RoleHeader` labels it "Open menu"; `aria-label` wins over the sr-only "Toggle Sidebar" text.
  await page.getByRole("button", { name: /open menu/i }).click();
  await expect(drawer).toBeVisible();
}

/**
 * These need no database and no environment variables, so they pass on a fresh checkout before
 * migrations are applied.
 *
 * That is deliberate: they are the floor under the suite. When the database is still unconfigured, this
 * group is what tells you the app itself boots, the CSS loads and the shell guards work -- which is the
 * difference between "nothing is set up yet" and "the build is broken".
 */
test.describe("public pages, no database needed", () => {
  test("the sign-in page renders", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/pin/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("the sign-in page has a theme switch", async ({ page }) => {
    await page.goto("/login");
    const theme = page.getByRole("button", { name: /theme/i }).first();
    await expect(theme).toBeVisible();
    await theme.click();
    await expect(page.getByRole("menuitemradio", { name: "Dark" })).toBeVisible();
  });

  test("choosing dark on the sign-in page sticks", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /theme/i }).first().click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("the registration page renders", async ({ page }) => {
    await page.goto("/register");
    // The form is long; the point is that it mounts and the shell does not throw.
    await expect(page.getByRole("button", { name: /submit|apply|send/i }).first()).toBeVisible();
  });

  test("a signed-out deep link returns to login", async ({ page }) => {
    // AUTH-1: a protected URL reached without a session must not render, and must not 500 either.
    for (const path of ["/admin", "/secretary", "/member", "/treasurer", "/super-admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test("an unknown path returns to login rather than a 404 page", async ({ page }) => {
    await page.goto("/no-such-page");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("the actor step", () => {
  /**
   * These two are the tests that would have caught the bug the suite actually hit.
   *
   * Without them the whole staff half of the suite fails with a bare navigation timeout, which reads as
   * "the sign-in is broken" and sends you looking at the login route and the PIN hashes instead of at the
   * dialog that was sitting there unanswered.
   */
  test("a staff role is asked who is using the device, and cannot get past it", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/pin/i).first().fill(pinFor("admin"));
    await page.getByRole("button", { name: /^sign in$/i }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole("heading", { name: /who.?s using this device/i })).toBeVisible();

    // Still on /login, and no Skip: `require_actor_name_admin` defaults to on, so staff must answer.
    await expect(page).toHaveURL(/\/login/);
    await expect(dialog.getByRole("button", { name: /^skip$/i })).toHaveCount(0);

    await dialog.getByRole("button").first().click();
    await page.waitForURL(leftLogin, { timeout: 20_000 });
  });

  test("a member role is not asked", async ({ page }) => {
    // The counterpart that makes the asymmetry explicit, and the reason one role used to pass alone.
    await page.goto("/login");
    await page.getByLabel(/pin/i).first().fill(pinFor("member"));
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await page.waitForURL(leftLogin, { timeout: 20_000 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("sign in", () => {
  for (const { role, path } of ROLES) {
    test(`${role} reaches their own home`, async ({ page }) => {
      await signIn(page, role);
      expect(page.url()).not.toContain("/login");
      expect(page.url()).toContain(path.split("/")[1]);
    });
  }
});

test.describe("the shell", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "admin");
  });

  test("the sidebar lists the admin menu", async ({ page }) => {
    await openSidebar(page);
    for (const item of ["Members", "Registrations", "Inbox", "Settings"]) {
      await expect(page.getByRole("link", { name: new RegExp(item, "i") }).first()).toBeVisible();
    }
  });

  test("the footer carries the account menu and the app menu", async ({ page }) => {
    // FW-7's theme switch lives here, which is where module 01 §4.1 says it should.
    await openSidebar(page);
    await expect(page.getByRole("button", { name: /theme/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /log ?out/i }).first()).toBeVisible();
  });

  test("the session survives a reload", async ({ page }) => {
    await page.reload();
    // The drawer is closed again after the reload, so it has to be opened before it can be inspected.
    await openSidebar(page);
    await expect(page.getByRole("button", { name: /theme/i }).first()).toBeVisible();
  });

  test("the theme switch offers light, dark and system", async ({ page }) => {
    await openSidebar(page);
    await page.getByRole("button", { name: /theme/i }).first().click();
    for (const option of ["Light", "Dark", "System"]) {
      await expect(page.getByRole("menuitemradio", { name: option })).toBeVisible();
    }
  });

  test("choosing dark adds the dark class and persists across a reload", async ({ page }) => {
    await openSidebar(page);
    await page.getByRole("button", { name: /theme/i }).first().click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();

    // The acceptance criterion is "no flash of the wrong theme on reload", which is only true if the
    // choice is written to storage rather than held in component state.
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("a signed-out deep link returns to login", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/secretary/session/some-id");
    await expect(page).toHaveURL(/\/login/);
  });

  /**
   * Regression guard for a failure that `tsc`, lint and all 1209 unit tests were happy with.
   *
   * `/admin/appeals` passed a `dayHref={(date) => ...}` callback from a server component into
   * `AppealsQueuePage`, which is a client component. React cannot serialize a function across the RSC
   * boundary, so it threw "Functions cannot be passed directly to Client Components" and the page fell
   * back to the error boundary -- while still answering 200, which is why nothing else noticed.
   *
   * Asserting the heading is the only assertion that catches it: the shell and the sidebar render fine
   * either way, so "the page loaded" is not evidence the page worked.
   */
  test("the appeals queue renders, not the error boundary", async ({ page }) => {
    await page.goto("/admin/appeals");
    await expect(page.getByRole("heading", { name: /attendance appeals/i })).toBeVisible();
    await expect(page.getByText(/application error|server-side exception/i)).toHaveCount(0);
  });

  /**
   * Regression guard for a second failure that `tsc`, lint and every unit test were happy with.
   *
   * `GET /api/masses` answers with the standard envelope, `{ ok: true, data: { masses } }`. The page
   * read `masses` off the top level instead, so `body.masses` was `undefined`, `?? []` swallowed it,
   * and the catalog rendered empty on every load. Nothing errored: `POST /api/masses` answered 200 and
   * the row really was in the database. To the user that reads as "my Masses were deleted" and "Add
   * Mass does nothing". The same mistake was in five other screens (day view, add-session Mass picker,
   * liturgy copy-from, announcement batch suggestions, appeals queue, treasurer batches).
   *
   * Comparing the rendered row count against the API's count is what makes this a contract instead of
   * a snapshot -- it holds for a fresh database with one Mass and for a populated one with dozens. It
   * is vacuous when the database genuinely has no Masses, so the populated case is what protects us.
   */
  test("the Masses catalog renders every Mass the API returns", async ({ page }) => {
    const api = await page.request.get("/api/masses");
    expect(api.ok()).toBe(true);
    const body = (await api.json()) as { data?: { masses?: unknown[] } };
    const expected = body.data?.masses?.length ?? 0;

    await page.goto("/admin/masses");
    await expect(page.getByRole("heading", { name: "Masses" })).toBeVisible();
    await expect(page.getByTestId("mass-list").locator("li")).toHaveCount(expected);
  });
});

test.describe("navigation", () => {
  test("the active item is highlighted for a child route", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/admin/members");
    await openSidebar(page);
    const members = page.getByRole("link", { name: /^Members$/ }).first();
    await expect(members).toHaveAttribute("aria-current", "page");
  });
});