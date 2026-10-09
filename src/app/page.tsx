import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ThemeSwitch } from "@/components/layout/ThemeSwitch";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionTokenEdge } from "@/lib/auth/jwt-edge";
import { ROLE_PATH } from "@/lib/auth/roles";
import { isSessionValidForRole } from "@/lib/auth/session-valid";
import { tryGetSetting } from "@/lib/settings/store";
import { ParishPhoto } from "@/components/church/ParishPhoto";
import { Reveal } from "@/components/church/Reveal";
import { glyphFor } from "@/lib/church/icons";
import { milestonesToItalicise } from "@/lib/church/ministry";
import {
  SECTION_IDS,
  hasAbout,
  hasCouncil,
  hasLeadership,
  hasPatrons,
  hasRoles,
  hasTimeline,
  navSections,
  paragraphsOf,
} from "@/lib/church/profile";
import { readPublicChurchProfile } from "@/lib/church/profile-server";

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
 *
 * ## Where the content comes from
 *
 * The parish's own material -- the priest, the ministry's background, the roles, the timeline, the
 * patrons, the council -- is read from the database by `readPublicChurchProfile`, which `/api/church`
 * also calls. That used to be a loopback HTTP request to this app's own route, and it failed on every
 * request in production, so the page rendered perfectly and silently without one word of it. See
 * `profile-server` for the whole story.
 *
 * ## Where the wording comes from
 *
 * The parish's facts are data. The section headings are not: "A ministry as old as the liturgy" is a
 * sentence about the page, written here, and it stays here. Making the super admin edit every heading
 * would mean they could take the page down by typing a stray space into a label, and the headings are
 * not the part that changes.
 */

/** The app's own line, used when the parish has not written a headline. */
const DEFAULT_HEADLINE = "Serving at the altar, made simple.";

const DEFAULT_LEAD =
  "Attendance used to live on a paper sheet per Mass, then in a spreadsheet somebody typed up each month, then in a printed grid sent to the parish office. Now the roster is marked on the day, everyone sees their own record, and the monthly report builds itself.";

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

const APP_ROLES = [
  { role: "Members", body: "Check your attendance, pay your dues, and appeal a mark you disagree with." },
  { role: "Officers", body: "Plan server assignments ahead of time and post announcements." },
  { role: "Secretaries", body: "Run the roster, the appeals and the monthly report." },
  { role: "Treasurers", body: "Record dues payments and issue receipts." },
  { role: "Admins", body: "Oversee all of it, approve registrations and payment structures." },
  { role: "Super admins", body: "Approve the monthly report before it becomes the record." },
] as const;

const GETTING_IN = [
  {
    step: "1.",
    body: "Officers, secretaries, treasurers and admins are added by the parish office, which sets their PIN. There is no self-signup for these — an officer should not be able to grant themselves the ability to reverse a payment.",
  },
  {
    step: "2.",
    body: "Members apply with their details and wait for an admin to approve. You can check where an application has got without signing in.",
  },
  {
    step: "3.",
    body: "Signing in is your PIN, not a password. It works on a phone, and the app installs to the home screen.",
  },
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

  // Failure is not fatal. A stranger gets the app sections alone rather than a 500 on the front door,
  // but the reason is logged instead of being turned into nothing: silence here is what made a broken
  // read invisible for a whole day.
  const churchResult = await readPublicChurchProfile();
  if (!churchResult.ok) {
    console.error("[landing] the parish profile could not be read:", churchResult.reason);
  }
  const church = churchResult.ok ? churchResult.profile : null;

  const parish = church?.parish_name ?? (await tryGetSetting("church_name"))?.trim() ?? "Knights of the Altar";
  const year = new Date().getFullYear();

  const headline = church?.headline?.trim() || DEFAULT_HEADLINE;

  return (
    <div className="landing min-h-svh bg-[var(--background)] text-[var(--foreground)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-[var(--brand)] focus:px-4 focus:py-2 focus:text-[var(--on-brand)]"
      >
        Skip to the content
      </a>

      {/* ---------------------------------------------------------------
          Nav. Sticky so the theme switch and the way out are always to hand,
          and translucent so the content passing underneath is visible rather
          than hidden behind an opaque bar.
      ---------------------------------------------------------------- */}
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_72%,transparent)] backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-4xl items-center justify-between gap-4 px-5" aria-label="Sections">
          <span className="flex min-w-0 items-center gap-2.5 font-bold tracking-tight">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-[linear-gradient(135deg,var(--a1),var(--a2))] text-[#16150f]"
            >
              <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden>
                <path d="M9.5 2h5v7.5H22v5h-7.5V22h-5v-7.5H2v-5h7.5V2Z" />
              </svg>
            </span>
            <span className="truncate text-[15px]">{parish}</span>
          </span>

          <div className="flex items-center gap-1">
            <ul className="mr-1 hidden items-center gap-0.5 text-sm sm:flex">
              {navSections(church).map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    className="rounded-lg px-3 py-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--card)] hover:text-[var(--foreground)]"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
            <ThemeSwitch variant="plain" />
          </div>
        </nav>
      </header>

      <main id="main">
        {/* -------------------------------------------------------------
            Hero. Centred and large on purpose: this is a front door, and
            the first thing a visitor should get is what this place is.
        -------------------------------------------------------------- */}
        <section className="relative overflow-hidden px-5 pb-16 pt-20 text-center sm:pb-20 sm:pt-24">
          <div className="landing-glow" aria-hidden />

          <div className="relative mx-auto max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3.5 py-1.5 text-[13px] text-[var(--text-muted)]">
              <span aria-hidden className="block size-1.5 rounded-full bg-[var(--a1)]" />
              Attendance Monitoring System
            </span>

            <h1 className="mx-auto mt-5 max-w-3xl text-[clamp(2.5rem,8.5vw,5.25rem)] font-extrabold leading-[1.02] tracking-[-0.04em]">
              {/* The whole line takes the gold rather than half of it. A split needs the two halves to
                  each be a sensible phrase, which a headline typed by a super admin is not. */}
              <span className="bg-[linear-gradient(120deg,var(--a1),var(--a2)_60%,var(--a1))] bg-clip-text text-transparent">
                {headline}
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-xl text-base text-[var(--text-muted)] sm:text-lg">{DEFAULT_LEAD}</p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href="/login"
                className="inline-block rounded-xl border border-[var(--brand)] bg-[var(--brand)] px-6 py-3.5 text-[15px] font-semibold text-[var(--on-brand)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-10px_var(--a1)]"
              >
                Sign in
              </a>
              <a
                href="/register"
                className="inline-block rounded-xl border border-[var(--border)] bg-[var(--card)] px-6 py-3.5 text-[15px] font-semibold text-[var(--foreground)] transition-transform hover:-translate-y-0.5"
              >
                Apply to join
              </a>
            </div>

            <p className="mt-5 text-sm text-[var(--text-muted)]">
              Applied already?{" "}
              <a href="/register/status" className="font-medium text-[var(--brand-text)] hover:underline">
                Check your status
              </a>
            </p>
          </div>
        </section>

        {/* -------------------------------------------------------------
            About, with the priest beside it.

            Two columns above 860px and one below, with the priest first
            in the source rather than second: on a phone the name comes
            before the history, which is the order a visitor wants.
        -------------------------------------------------------------- */}
        {hasAbout(church) || hasLeadership(church) ? (
          <section
            id={SECTION_IDS.about}
            aria-labelledby="about-heading"
            className="bg-[var(--surface-2)] px-5 py-16 sm:py-20"
          >
            <div className="mx-auto grid max-w-4xl gap-10 sm:grid-cols-[minmax(0,20rem)_1fr] sm:gap-12">
              {hasLeadership(church) ? (
                <Reveal className="h-fit rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-6 text-center">
                  <span
                    aria-hidden
                    className="mx-auto mb-4 grid size-24 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,var(--a1),var(--a2))] text-2xl font-extrabold text-[#16150f]"
                  >
                    <ParishPhoto url={church?.photo_url ?? null} name={church?.priest_name ?? ""} />
                  </span>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-text)]">
                    Our Priest
                  </p>
                  <p className="mt-1 text-lg font-bold tracking-tight">{church?.priest_name?.trim()}</p>
                </Reveal>
              ) : null}

              <Reveal>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-text)]">
                  About the Ministry
                </p>
                <h2 id="about-heading" className="mt-2.5 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
                  A ministry as old as the liturgy.
                </h2>
                <div className="mt-6 space-y-4 text-[15px] text-[var(--text-muted)]">
                  {paragraphsOf(church?.about).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              </Reveal>
            </div>
          </section>
        ) : null}

        {/* -------------------------------------------------------------
            Roles at the altar.

            One card per role, laid out to whatever fits the width. The
            grid is `auto-fit` rather than a fixed column count so four
            roles and nine roles both look deliberate.
        -------------------------------------------------------------- */}
        {hasRoles(church) ? (
          <section id={SECTION_IDS.roles} aria-labelledby="roles-heading" className="px-5 py-16 sm:py-20">
            <div className="mx-auto max-w-4xl">
              <Reveal>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-text)]">
                  Roles at the Altar
                </p>
                <h2 id="roles-heading" className="mt-2.5 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
                  Every Mass is a team effort.
                </h2>
                <p className="mt-4 max-w-xl text-[var(--text-muted)]">
                  Servers are trained and rostered into these roles.
                </p>
              </Reveal>

              <ul className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
                {(church?.roles ?? []).map((role, i) => {
                  const Glyph = glyphFor(role.icon);
                  return (
                    <Reveal
                      as="li"
                      key={role.id}
                      delay={i * 60}
                      className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-5 transition-all hover:-translate-y-1 hover:border-[var(--a1)]"
                    >
                      <span
                        aria-hidden
                        className="mb-4 grid size-10 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand-text)]"
                      >
                        <Glyph size={20} strokeWidth={1.75} />
                      </span>
                      <h3 className="text-[17px] font-semibold tracking-tight">{role.name}</h3>
                      {role.description ? (
                        <p className="mt-2 text-[15px] text-[var(--text-muted)]">{role.description}</p>
                      ) : null}
                    </Reveal>
                  );
                })}
              </ul>
            </div>
          </section>
        ) : null}

        {/* -------------------------------------------------------------
            A short timeline.

            The year is set large beside the sentence rather than inside
            it, so a column of them scans as a column of dates. Below
            560px they stack, because a 110px gutter for "1962–65" is
            most of a phone's width.
        -------------------------------------------------------------- */}
        {hasTimeline(church) ? (
          <section
            id={SECTION_IDS.timeline}
            aria-labelledby="timeline-heading"
            className="bg-[var(--surface-2)] px-5 py-16 sm:py-20"
          >
            <div className="mx-auto max-w-4xl">
              <Reveal>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-text)]">
                  A Short Timeline
                </p>
                <h2 id="timeline-heading" className="mt-2.5 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
                  Two thousand years of service.
                </h2>
                <p className="mt-4 max-w-xl text-[var(--text-muted)]">
                  Milestones in the story of altar servers.
                </p>
              </Reveal>

              <ul className="mt-8 grid gap-3.5">
                {(church?.milestones ?? []).map((m, i) => (
                  <Reveal
                    as="li"
                    key={m.id}
                    delay={Math.min(i * 45, 400)}
                    className="grid gap-1 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 sm:grid-cols-[7rem_1fr] sm:items-center sm:gap-5 sm:px-6"
                  >
                    <b className="text-xl font-extrabold tracking-tight sm:text-[22px]">{m.year_label}</b>
                    <span className="text-[15px] text-[var(--text-muted)]">{emphasise(m.body)}</span>
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* -------------------------------------------------------------
            Patrons of servers. Centred cards, because these are short
            names rather than things to be compared.
        -------------------------------------------------------------- */}
        {hasPatrons(church) ? (
          <section aria-labelledby="patrons-heading" className="px-5 py-16 sm:py-20">
            <div className="mx-auto max-w-4xl">
              <Reveal>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-text)]">
                  Patrons of Servers
                </p>
                <h2 id="patrons-heading" className="mt-2.5 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
                  Saints who served.
                </h2>
                <p className="mt-4 max-w-xl text-[var(--text-muted)]">
                  Serving was long seen as a first step toward priestly vocations, and several saints
                  became patrons of servers.
                </p>
              </Reveal>

              <ul className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] gap-4">
                {(church?.patrons ?? []).map((p, i) => (
                  <Reveal
                    as="li"
                    key={p.id}
                    delay={i * 60}
                    className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-6 text-center transition-all hover:-translate-y-1 hover:border-[var(--a1)]"
                  >
                    <span
                      aria-hidden
                      className="mx-auto mb-3.5 grid size-10 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand-text)]"
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                        <path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45 6.19 20.5 7.3 14.03 2.6 9.45l6.5-.95L12 2.6Z" />
                      </svg>
                    </span>
                    <h3 className="text-[17px] font-semibold tracking-tight">{p.name}</h3>
                    {p.note ? <p className="mt-1.5 text-sm text-[var(--text-muted)]">{p.note}</p> : null}
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* -------------------------------------------------------------
            Council. The one section with people who have photographs, so
            it falls back to initials rather than to an empty box.
        -------------------------------------------------------------- */}
        {hasCouncil(church) ? (
          <section
            id={SECTION_IDS.council}
            aria-labelledby="council-heading"
            className="bg-[var(--surface-2)] px-5 py-16 sm:py-20"
          >
            <div className="mx-auto max-w-4xl">
              <Reveal>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-text)]">
                  Council Members
                </p>
                <h2 id="council-heading" className="mt-2.5 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
                  The officers who lead.
                </h2>
                <p className="mt-4 max-w-xl text-[var(--text-muted)]">
                  They govern the ministry alongside the parish.
                </p>
              </Reveal>

              <ul className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(17rem,1fr))] gap-4">
                {(church?.council ?? []).map((m, i) => (
                  <Reveal
                    as="li"
                    key={m.id}
                    delay={i * 60}
                    className="flex items-center gap-3.5 rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-4 transition-all hover:-translate-y-1 hover:border-[var(--a1)]"
                  >
                    <span
                      aria-hidden
                      className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,var(--a1),var(--a2))] text-[17px] font-bold text-[#16150f]"
                    >
                      <ParishPhoto url={m.photo_url ?? null} name={m.name} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold tracking-tight">{m.name}</span>
                      {m.office ? (
                        <span className="block text-sm text-[var(--text-muted)]">{m.office}</span>
                      ) : null}
                      {m.bio ? (
                        <span className="mt-1 block text-sm text-[var(--text-muted)]">{m.bio}</span>
                      ) : null}
                    </span>
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* -------------------------------------------------------------
            What the app does, and who it is for.

            Kept from the page this replaced. Everything above is about
            the parish; without these the front door describes a ministry
            and says nothing about the software a visitor is about to
            sign in to.
        -------------------------------------------------------------- */}
        <section aria-labelledby="what-it-does" className="px-5 py-16 sm:py-20">
          <div className="mx-auto max-w-4xl">
            <Reveal>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-text)]">
                The System
              </p>
              <h2 id="what-it-does" className="mt-2.5 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
                What it does
              </h2>
            </Reveal>

            <ul className="mt-8 grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-4">
              {CAPABILITIES.map((c, i) => (
                <Reveal
                  as="li"
                  key={c.title}
                  delay={Math.min(i * 45, 300)}
                  className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-5 transition-all hover:-translate-y-1 hover:border-[var(--a1)]"
                >
                  <h3 className="font-semibold tracking-tight text-[var(--brand-text)]">{c.title}</h3>
                  <p className="mt-1.5 text-[15px] text-[var(--text-muted)]">{c.body}</p>
                </Reveal>
              ))}
            </ul>

            <Reveal className="mt-14">
              <h2 className="text-[clamp(1.5rem,3.6vw,2rem)] font-extrabold tracking-[-0.03em]">
                Who it is for
              </h2>
              <p className="mt-3 max-w-xl text-[var(--text-muted)]">
                One account, six roles. You see your own section, and the officers who oversee you can
                open the sections they answer for.
              </p>
              <dl className="mt-6 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {APP_ROLES.map((r) => (
                  <div key={r.role}>
                    <dt className="font-medium">{r.role}</dt>
                    <dd className="text-sm text-[var(--text-muted)]">{r.body}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>

            <Reveal className="mt-14">
              <h2 className="text-[clamp(1.5rem,3.6vw,2rem)] font-extrabold tracking-[-0.03em]">
                Getting in
              </h2>
              <ol className="mt-5 space-y-3 text-[15px] text-[var(--text-muted)]">
                {GETTING_IN.map((s) => (
                  <li key={s.step} className="flex gap-3">
                    <span className="font-medium text-[var(--foreground)]">{s.step}</span>
                    <span>{s.body}</span>
                  </li>
                ))}
              </ol>
            </Reveal>
          </div>
        </section>

        {/* -------------------------------------------------------------
            The close. A single box with the one action worth taking.
        -------------------------------------------------------------- */}
        <section className="px-5 pb-16 sm:pb-24">
          <Reveal className="relative mx-auto max-w-4xl overflow-hidden rounded-[28px] border border-[var(--border)] bg-[radial-gradient(ellipse_at_top,var(--glow),transparent_70%)] px-6 py-14 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand-text)]">Join Us</p>
            <h2 className="mx-auto mt-2.5 max-w-lg text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
              Serve at the Altar
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[var(--text-muted)]">
              Join {parish} and be part of the parish&apos;s ministry.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a
                href="/register"
                className="inline-block rounded-xl border border-[var(--brand)] bg-[var(--brand)] px-6 py-3.5 text-[15px] font-semibold text-[var(--on-brand)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-10px_var(--a1)]"
              >
                Apply to join
              </a>
              <a
                href="/login"
                className="inline-block rounded-xl border border-[var(--border)] bg-[var(--card)] px-6 py-3.5 text-[15px] font-semibold text-[var(--foreground)] transition-transform hover:-translate-y-0.5"
              >
                Sign in
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-[var(--border)] px-5 py-10 text-center text-[13px] text-[var(--text-muted)]">
        {parish} Attendance Monitoring System &middot; Created by Jerson Catadman &middot; {year}
      </footer>
    </div>
  );
}

/**
 * Italicise a milestone's document titles.
 *
 * The body is plain text -- deliberately, because a markup editor is a rich-text XSS surface aimed at a
 * public page and two document titles are not worth one. So emphasis is applied by splitting on a
 * closed list of phrases the page knows about, which means the only strings that can reach `<em>` are
 * strings this file contains.
 */
function emphasise(body: string) {
  const parts: Array<{ text: string; italic: boolean }> = [{ text: body, italic: false }];
  for (const phrase of milestonesToItalicise(body)) {
    for (const part of parts) {
      if (part.italic) continue;
      const at = part.text.indexOf(phrase);
      if (at === -1) continue;
      const before = part.text.slice(0, at);
      const after = part.text.slice(at + phrase.length);
      const index = parts.indexOf(part);
      parts.splice(
        index,
        1,
        { text: before, italic: false },
        { text: phrase, italic: true },
        { text: after, italic: false },
      );
      break;
    }
  }
  return parts.filter((p) => p.text).map((p, i) =>
    p.italic ? (
      <em key={i} className="italic text-[var(--foreground)]">
        {p.text}
      </em>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}