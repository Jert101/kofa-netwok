import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ThemeSwitch } from "@/components/layout/ThemeSwitch";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionTokenEdge } from "@/lib/auth/jwt-edge";
import { ROLE_PATH } from "@/lib/auth/roles";
import { isSessionValidForRole } from "@/lib/auth/session-valid";
import { tryGetSetting } from "@/lib/settings/store";
import { ParishPhoto } from "@/components/church/ParishPhoto";
import {
  fetchChurchProfile,
  hasAbout,
  hasCouncil,
  hasLeadership,
  paragraphsOf,
} from "@/lib/church/profile";

/**
 * The landing page.
 *
 * The signed-in case used to be a redirect in the edge middleware, which read the cookie's signature
 * and nothing else. A PIN change or "sign out all devices" revokes a session by timestamp while the
 * signature and expiry still check out, so that redirect sent the holder to a dashboard that refused
 * them, then to `/login`, then straight back here -- a loop. Deciding here instead means the one place
 * that answers "is this session still good?" is `isSessionValidForRole`, the same answer every layout
 * gives, so `/` cannot disagree with the page it forwards to.
 *
 * The parish name is read from settings so the page greets the actual parish rather than the default
 * the repository was built with. `tryGetSetting` rather than `getSetting`: this is the first screen a
 * signed-out visitor sees, and a database that is briefly unreachable should not 500 the front door --
 * the registry's own default is a perfectly good answer in that case.
 */

const CAPABILITIES = [
  {
    title: "Attendance",
    body: "Mark who served each Mass from your phone, appeal a mark you think is wrong, and see your own record and streak without asking anyone.",
  },
  {
    title: "Server assignments",
    body: "Plan who serves what weeks ahead, from a template. Draw the servers at random with the right people eligible for each role, or pick them yourself — and announce the roster when it is settled.",
  },
  {
    title: "Announcements",
    body: "Post once and have it reach the parish's phones. Aim a notice at one role, one batch, or everyone, and set the day it comes down.",
  },
  {
    title: "Membership",
    body: "New members apply in the browser and an admin approves them. Inactive members are tracked, not deleted, so last year's record still reads.",
  },
  {
    title: "Dues",
    body: "Payment structures and installments, payments recorded and voided with a reason, and a receipt with a control number for every one.",
  },
  {
    title: "Reports",
    body: "The monthly attendance report is generated, then approved before it counts. Nobody edits the parish's record by hand and calls it done.",
  },
] as const;

const ROLES = [
  { role: "Members", body: "Check your attendance, pay your dues, and appeal a mark you disagree with." },
  { role: "Officers", body: "Plan server assignments ahead of time and post announcements." },
  { role: "Secretaries", body: "Run the roster, the appeals and the monthly report." },
  { role: "Treasurers", body: "Record dues payments and issue receipts." },
  { role: "Admins", body: "Oversee all of it, approve registrations and payment structures." },
  { role: "Super admins", body: "Approve the monthly report before it becomes the record." },
] as const;

export default async function LandingPage() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const session = token
    ? await verifySessionTokenEdge(token, process.env.JWT_SECRET ?? "")
    : null;

  // Only a session that is still valid earns a redirect. A revoked one falls through to the page, and
  // signing in again replaces the stale cookie -- the same treatment the sign-in page gives it.
  if (session?.role && (await isSessionValidForRole(session))) {
    redirect(ROLE_PATH[session.role]);
  }

  // The parish's own content: who leads it, what the ministry is, who is on the council. Read from the
  // API rather than straight from the database so the route that decides what may be published to a
  // stranger is the only one, and this page cannot drift from it.
  //
  // Failure is not fatal. Every section below is conditional on having content, so a profile that has
  // not been filled in yet renders the app sections alone -- which is exactly what this page looked like
  // before the feature existed, and a working front door rather than a 500.
  const church = await fetchChurchProfile();

  const parish = church?.parish_name ?? (await tryGetSetting("church_name"))?.trim() ?? "Knights of the Altar";
  const year = new Date().getFullYear();

  return (
    <div className="min-h-svh bg-[var(--surface)]">
      <header className="border-b border-[var(--border)]">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--text)]">{parish}</p>
            <p className="text-xs text-[var(--text-muted)]">Attendance Monitoring System</p>
          </div>
          <ThemeSwitch variant="plain" />
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 pb-16">
        <section className="py-10 sm:py-14">
          {/* The parish's own headline when the super admin has written one, and the app's line when
              they have not. A page that says nothing about itself is worse than one that falls back,
              so this is the only place the two are blended. */}
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {church?.headline?.trim() || "The parish's altar-server records, in one place."}
          </h1>
          <p className="mt-3 max-w-2xl text-base text-[var(--text-muted)]">
            {hasAbout(church) ? (
              <>
                {paragraphsOf(church?.about)[0]}{" "}
                Attendance used to live on a paper sheet per Mass, then in a spreadsheet somebody typed
                up each month, then in a printed grid sent to the parish office. This replaces all three:
                the roster is marked on the day, everyone sees their own record, and the monthly report
                builds itself.
              </>
            ) : (
              "Attendance used to live on a paper sheet per Mass, then in a spreadsheet somebody typed up each month, then in a printed grid sent to the parish office. This replaces all three: the roster is marked on the day, everyone sees their own record, and the monthly report builds itself."
            )}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/register">Apply to join</Link>
            </Button>
          </div>

          <p className="mt-3 text-sm text-[var(--text-muted)]">
            Applied already?{" "}
            <Link href="/register/status" className="font-medium text-[var(--brand-text)] hover:underline">
              Check your status
            </Link>
          </p>
        </section>

        {hasLeadership(church) ? (
          <section aria-labelledby="our-priest" className="border-t border-[var(--border)] py-10">
            <h2 id="our-priest" className="text-lg font-semibold">
              Our Priest
            </h2>
            <div className="mt-4 flex items-center gap-4">
              <span
                aria-hidden
                className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--brand-soft)] text-xl font-semibold text-[var(--brand-text)]"
              >
                <ParishPhoto url={church?.photo_url ?? null} name={church?.priest_name ?? ""} />
              </span>
              <p className="text-base font-medium text-[var(--text)]">
                {church?.priest_name?.trim()}
              </p>
            </div>
          </section>
        ) : null}

        {hasAbout(church) ? (
          <section aria-labelledby="about-us" className="border-t border-[var(--border)] py-10">
            <h2 id="about-us" className="text-lg font-semibold">
              About the Ministry
            </h2>
            <div className="mt-4 max-w-2xl space-y-3">
              {paragraphsOf(church?.about).map((p, i) => (
                <p key={i} className="text-base text-[var(--text-muted)]">
                  {p}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        {hasCouncil(church) ? (
          <section aria-labelledby="council" className="border-t border-[var(--border)] py-10">
            <h2 id="council" className="text-lg font-semibold">
              Council Members
            </h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              The officers who govern the ministry alongside the parish.
            </p>
            <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {church?.council.map((m) => (
                <li
                  key={m.id}
                  className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4"
                >
                  <span
                    aria-hidden
                    className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand-text)]"
                  >
                    <ParishPhoto url={m.photo_url ?? null} name={m.name} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--text)]">{m.name}</p>
                    {m.office ? (
                      <p className="text-xs text-[var(--brand-text)]">{m.office}</p>
                    ) : null}
                    {m.bio ? (
                      <p className="mt-1 text-sm text-[var(--text-muted)]">{m.bio}</p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="what-it-does" className="border-t border-[var(--border)] py-10">
          <h2 id="what-it-does" className="text-lg font-semibold">
            What it does
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <li key={c.title} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
                <h3 className="text-sm font-semibold text-[var(--brand-text)]">{c.title}</h3>
                <p className="mt-1.5 text-sm text-[var(--text-muted)]">{c.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="who-it-is-for" className="border-t border-[var(--border)] py-10">
          <h2 id="who-it-is-for" className="text-lg font-semibold">
            Who it is for
          </h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            One account, six roles. You see your own section, and the officers who oversee you can open
            the sections they answer for.
          </p>
          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {ROLES.map((r) => (
              <div key={r.role}>
                <dt className="text-sm font-medium text-[var(--text)]">{r.role}</dt>
                <dd className="text-sm text-[var(--text-muted)]">{r.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="getting-in" className="border-t border-[var(--border)] py-10">
          <h2 id="getting-in" className="text-lg font-semibold">
            Getting in
          </h2>
          <ol className="mt-4 space-y-3 text-sm text-[var(--text-muted)]">
            <li className="flex gap-3">
              <span className="font-medium text-[var(--text)]">1.</span>
              <span>
                Officers, secretaries, treasurers and admins are added by the parish office, which sets
                their PIN. There is no self-signup for these — an officer should not be able to grant
                themselves the ability to reverse a payment.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-medium text-[var(--text)]">2.</span>
              <span>
                Members apply with their details and wait for an admin to approve. You can check where
                an application has got without signing in.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="font-medium text-[var(--text)]">3.</span>
              <span>
                Signing in is your PIN, not a password. It works on a phone, and the app installs to
                the home screen.
              </span>
            </li>
          </ol>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/register">Apply to join</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--border)]">
        <p className="mx-auto max-w-4xl px-5 py-6 text-xs text-[var(--text-muted)]">
          Knights of the Altar Attendance Monitoring System&trade; &middot; Created by Jerson
          Catadman &middot; {year}
        </p>
      </footer>
    </div>
  );
}