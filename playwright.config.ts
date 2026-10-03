import { defineConfig, devices } from "@playwright/test";

/**
 * FW-8: Playwright.
 *
 * Module 01's smoke test is "sign in as each role and see its menu", which is the one check that nothing
 * else in this project can do: the unit tests are pure functions, and until this existed no page in the
 * app had ever been rendered by a browser. A sidebar that throws, a layout that does not compile, or a
 * session cookie that is not set all pass `tsc`, pass lint and pass 1204 unit tests.
 *
 * ## Why Chromium only
 *
 * One browser, not three. A parish app is used on phones, so mobile emulation matters more than engine
 * count, and this config runs the same flows at 375px and 1280px. Adding WebKit and Firefox multiplies CI
 * time for very little, because the failures this catches are layout and wiring failures rather than
 * engine-specific ones.
 *
 * ## Why the web server is started automatically
 *
 * `webServer` means `npm run e2e` works from a clean checkout with one command. The suite is not runnable
 * against an already-running dev server, which is deliberate: a test that depends on somebody having
 * remembered to start the right server on the right port is a test that gets skipped.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  // One worker, because these tests all run against one database. Two workers would have two browser
  // sessions mutating the same parish's records, and the flaky result would be blamed on the app.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3111",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      name: "phone",
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],

  /**
   * The build is part of the command, not a step somebody has to remember before it.
   *
   * `npm run dev` uses Turbopack, and Turbopack writes a different `.next` layout than a production
   * build. So after anybody runs the dev server -- which is nearly always, because that is how you work
   * on the app -- `.next/routes-manifest.json` is the dev manifest, and `next start` dies on it with the
   * least helpful error in the stack:
   *
   *     TypeError: routesManifest.dataRoutes is not iterable
   *
   * Nothing in that message mentions the dev server and nothing about it looks like a build problem; the
   * manifest simply has no `dataRoutes` key and the production server assumes it does. So the fix is
   * structural rather than a note to remember: build first, then serve. `next build` rewrites the
   * manifest correctly no matter what ran before it.
   *
   * `&&` and not `;`. On Windows a failing build has to stop the server from starting on a half-written
   * `.next`, which is the identical crash one step earlier and just as confusing.
   */
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run build && npm run start -- --port 3111",
        url: "http://127.0.0.1:3111/login",
        reuseExistingServer: !process.env.CI,
        // Generous, because this now includes a full production build. The previous 120s was sized for a
        // server that had nothing to do but boot, and a cold Next build comfortably exceeds it.
        timeout: 600_000,
      },
});