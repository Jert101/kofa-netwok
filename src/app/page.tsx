import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";

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
 * Built section for section from a reference page the parish supplied: the nav, the hero, the priest and
 * the ministry's background, the roles at the altar, the timeline, the patrons, the council, the close,
 * and the footer. The wording is the reference's wording. The parish's own facts — the priest, the
 * background, the roles, the milestones, the patrons, the council — come from the database and are
 * edited by the super admin.
 *
 * ## The signed-in redirect
 *
 * It used to be in the edge middleware, which read the cookie's signature and nothing else. A PIN change
 * or "sign out all devices" revokes a session by timestamp while the signature and expiry still check
 * out, so that redirect sent the holder to a dashboard that refused them, then to `/login`, then
 * straight back here — a loop. Deciding here instead means the one place that answers "is this session
 * still good?" is `isSessionValidForRole`, the same answer every layout gives, so `/` cannot disagree
 * with the page it forwards to.
 *
 * ## Why the content is read directly
 *
 * The page used to `fetch` this app's own `/api/church` over HTTP, rebuilding an absolute URL from
 * `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` / `localhost`. That call failed on every request in production,
 * so the page rendered perfectly and silently without one word of the parish's content. Both callers now
 * share `readPublicChurchProfile`; see `profile-server` for the whole story.
 */

/** The hero, exactly as the reference has it. Split so the last two words can take the gold. */
const HERO_BEFORE = "Serving at the altar,";
const HERO_ACCENT = "made simple.";

const HERO_LEAD =
  "Attendance used to live on a paper sheet per Mass, then a monthly spreadsheet, then a printed grid. Now the roster is marked on the day, everyone sees their own record, and the monthly report builds itself.";

export default async function LandingPage() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const session = token
    ? await verifySessionTokenEdge(token, process.env.JWT_SECRET ?? "")
    : null;

  // Only a session that is still valid earns a redirect. A revoked one falls through to the page, and
  // signing in again replaces the stale cookie — the same treatment the sign-in page gives it.
  if (session?.role && (await isSessionValidForRole(session))) {
    redirect(ROLE_PATH[session.role]);
  }

  // Failure is not fatal. A stranger gets the app's own words rather than a 500 on the front door, but
  // the reason is logged instead of being turned into nothing: that silence is what made a broken read
  // invisible for a whole day.
  const result = await readPublicChurchProfile();
  if (!result.ok) {
    console.error("[landing] the parish profile could not be read:", result.reason);
  }
  const church = result.ok ? result.profile : null;

  const parish = church?.parish_name ?? (await tryGetSetting("church_name"))?.trim() ?? "Knights of the Altar";
  const year = new Date().getFullYear();

  return (
    <div className="landing min-h-svh bg-[var(--background)] text-[var(--foreground)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-[var(--brand)] focus:px-4 focus:py-2 focus:text-[var(--on-brand)]"
      >
        Skip to the content
      </a>

      {/* ----------------------------------------------------------------
          Nav
      ----------------------------------------------------------------- */}
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--background)_72%,transparent)] backdrop-blur-md">
        <nav
          className="mx-auto flex h-16 max-w-[1040px] items-center justify-between gap-4 px-5"
          aria-label="Sections"
        >
          <span className="flex min-w-0 items-center gap-2.5 font-bold tracking-[-0.01em]">
            {/* The parish's own crest rather than the reference's cross. It is a shield on white, so it
                is shown as-is with no gold plate behind it — a gradient square would crop its points. */}
            <Image
              src="/logo.png"
              alt=""
              width={30}
              height={30}
              aria-hidden
              className="size-8 shrink-0 object-contain"
              priority
            />
            <span className="truncate text-[15px]">{parish}</span>
          </span>

          <div className="flex items-center gap-1.5">
            <ul className="mr-1 hidden items-center gap-1 text-sm sm:flex">
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
            {/* The reference toggles light and dark from one button. This is the app's switch instead,
                because it also offers System and because the landing page and the roster have to agree
                about which theme is active — two toggles would be free to disagree. */}
            <ThemeSwitch variant="plain" />
          </div>
        </nav>
      </header>

      <main id="main">
        {/* ----------------------------------------------------------------
            Hero
        ----------------------------------------------------------------- */}
        <section className="relative overflow-hidden px-5 pb-[84px] pt-24 text-center">
          <div className="landing-glow" aria-hidden />

          <div className="relative mx-auto max-w-[1040px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--card)] px-3.5 py-1.5 text-[13px] text-[var(--text-muted)]">
              <span aria-hidden className="block size-[7px] rounded-full bg-[var(--a1)]" />
              Attendance Monitoring System
            </span>

            <h1 className="mx-auto mt-[22px] max-w-[880px] text-[clamp(2.5rem,8.5vw,5.25rem)] font-extrabold leading-[1.02] tracking-[-0.04em]">
              {HERO_BEFORE}{" "}
              <span className="bg-[linear-gradient(120deg,var(--a1),var(--a2)_60%,var(--a1))] bg-clip-text text-transparent">
                {HERO_ACCENT}
              </span>
            </h1>

            <p className="mx-auto mb-[34px] mt-5 max-w-[640px] text-[clamp(1rem,2.2vw,1.1875rem)] text-[var(--text-muted)]">
              {HERO_LEAD}
            </p>

            <div className="flex flex-wrap justify-center gap-3">
              <a
                href="/login"
                className="inline-block rounded-xl border border-[var(--btn)] bg-[var(--btn)] px-[26px] py-3.5 text-[15px] font-semibold text-[var(--btn-fg)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-10px_var(--a1)]"
              >
                Sign in
              </a>
              <a
                href="/register"
                className="inline-block rounded-xl border border-[var(--border)] bg-[var(--card)] px-[26px] py-3.5 text-[15px] font-semibold text-[var(--foreground)] transition-transform hover:-translate-y-0.5"
              >
                Apply to join
              </a>
            </div>

            <p className="mt-5 text-sm text-[var(--text-muted)]">
              Applied already?{" "}
              <a href="/register/status" className="font-medium text-[var(--a1)] hover:underline">
                Check your status
              </a>
            </p>
          </div>
        </section>

        {/* ----------------------------------------------------------------
            About — the priest beside the ministry
        ----------------------------------------------------------------- */}
        {hasAbout(church) || hasLeadership(church) ? (
          <section
            id={SECTION_IDS.about}
            aria-labelledby="about-heading"
            className="bg-[var(--surface-2)] px-5 py-[84px]"
          >
            <div className="mx-auto grid max-w-[1040px] items-start gap-8 sm:grid-cols-[320px_1fr] sm:gap-12">
              {hasLeadership(church) ? (
                <Reveal className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-[26px] text-center transition-all hover:-translate-y-1 hover:border-[var(--a1)]">
                  <span
                    aria-hidden
                    className="mx-auto mb-[18px] grid size-24 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,var(--a1),var(--a2))] text-[26px] font-extrabold text-[#16150f]"
                  >
                    <ParishPhoto url={church?.photo_url ?? null} name={church?.priest_name ?? ""} />
                  </span>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--a1)]">Our Priest</p>
                  <p className="mt-2.5 font-bold">{church?.priest_name?.trim()}</p>
                  {church?.priest_role?.trim() ? (
                    <p className="text-sm text-[var(--text-muted)]">{church.priest_role.trim()}</p>
                  ) : null}
                </Reveal>
              ) : null}

              <Reveal>
                <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--a1)]">
                  About the Ministry
                </p>
                <h2
                  id="about-heading"
                  className="mb-4 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]"
                >
                  A ministry as old as the liturgy.
                </h2>
                <div className="text-[15px] text-[var(--text-muted)]">
                  {paragraphsOf(church?.about).map((p, i) => (
                    <p key={i} className="mb-4 last:mb-0">
                      {p}
                    </p>
                  ))}
                </div>
              </Reveal>
            </div>
          </section>
        ) : null}

        {/* ----------------------------------------------------------------
            Roles at the altar
        ----------------------------------------------------------------- */}
        {hasRoles(church) ? (
          <section id={SECTION_IDS.roles} aria-labelledby="roles-heading" className="px-5 py-[84px]">
            <div className="mx-auto max-w-[1040px]">
              <Reveal>
                <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--a1)]">
                  Roles at the Altar
                </p>
                <h2
                  id="roles-heading"
                  className="mb-4 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]"
                >
                  Every Mass is a team effort.
                </h2>
                <p className="mb-10 max-w-[620px] text-[var(--text-muted)]">
                  Servers are trained and rostered into these roles.
                </p>
              </Reveal>

              <ul className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4">
                {(church?.roles ?? []).map((role, i) => (
                  <Reveal
                    as="li"
                    key={role.id}
                    delay={i * 60}
                    className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-[26px] transition-all hover:-translate-y-1 hover:border-[var(--a1)]"
                  >
                    <span
                      aria-hidden
                      className="mb-4 grid size-[42px] place-items-center rounded-xl bg-[var(--brand-soft)] text-xl leading-none"
                    >
                      {glyphFor(role.icon)}
                    </span>
                    <h3 className="mb-2 text-lg tracking-[-0.01em]">{role.name}</h3>
                    {role.description ? (
                      <p className="text-[15px] text-[var(--text-muted)]">{role.description}</p>
                    ) : null}
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* ----------------------------------------------------------------
            A short timeline
        ----------------------------------------------------------------- */}
        {hasTimeline(church) ? (
          <section
            id={SECTION_IDS.timeline}
            aria-labelledby="timeline-heading"
            className="bg-[var(--surface-2)] px-5 py-[84px]"
          >
            <div className="mx-auto max-w-[1040px]">
              <Reveal>
                <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--a1)]">
                  A Short Timeline
                </p>
                <h2
                  id="timeline-heading"
                  className="mb-4 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]"
                >
                  Two thousand years of service.
                </h2>
                <p className="mb-10 max-w-[620px] text-[var(--text-muted)]">
                  Milestones in the story of altar servers.
                </p>
              </Reveal>

              <ul className="grid gap-3.5">
                {(church?.milestones ?? []).map((m, i) => (
                  <Reveal
                    as="li"
                    key={m.id}
                    delay={Math.min(i * 45, 400)}
                    className="grid gap-1 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-5 py-[18px] sm:grid-cols-[110px_1fr] sm:items-center sm:gap-[18px] sm:px-[22px]"
                  >
                    <b className="text-[22px] font-extrabold tracking-[-0.02em]">{m.year_label}</b>
                    <span className="text-[15px] text-[var(--text-muted)]">{emphasise(m.body)}</span>
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* ----------------------------------------------------------------
            Patrons of servers
        ----------------------------------------------------------------- */}
        {hasPatrons(church) ? (
          <section aria-labelledby="patrons-heading" className="px-5 py-[84px]">
            <div className="mx-auto max-w-[1040px]">
              <Reveal>
                <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--a1)]">
                  Patrons of Servers
                </p>
                <h2
                  id="patrons-heading"
                  className="mb-4 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]"
                >
                  Saints who served.
                </h2>
                <p className="mb-10 max-w-[620px] text-[var(--text-muted)]">
                  Serving was long seen as a first step toward priestly vocations, and several saints became
                  patrons of servers.
                </p>
              </Reveal>

              <ul className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4">
                {(church?.patrons ?? []).map((p, i) => (
                  <Reveal
                    as="li"
                    key={p.id}
                    delay={i * 60}
                    className="rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-[26px] text-center transition-all hover:-translate-y-1 hover:border-[var(--a1)]"
                  >
                    <span
                      aria-hidden
                      className="mx-auto mb-3.5 grid size-[42px] place-items-center rounded-full bg-[var(--brand-soft)] text-xl leading-none text-[var(--a1)]"
                    >
                      ★
                    </span>
                    <h3 className="mb-2 text-lg tracking-[-0.01em]">{p.name}</h3>
                    {p.note ? <p className="text-[15px] text-[var(--text-muted)]">{p.note}</p> : null}
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* ----------------------------------------------------------------
            Council members
        ----------------------------------------------------------------- */}
        {hasCouncil(church) ? (
          <section
            id={SECTION_IDS.council}
            aria-labelledby="council-heading"
            className="bg-[var(--surface-2)] px-5 py-[84px]"
          >
            <div className="mx-auto max-w-[1040px]">
              <Reveal>
                <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--a1)]">
                  Council Members
                </p>
                <h2
                  id="council-heading"
                  className="mb-4 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]"
                >
                  The officers who lead.
                </h2>
                <p className="mb-10 max-w-[620px] text-[var(--text-muted)]">
                  They govern the ministry alongside the parish.
                </p>
              </Reveal>

              <ul className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4">
                {(church?.council ?? []).map((m, i) => (
                  <Reveal
                    as="li"
                    key={m.id}
                    delay={i * 60}
                    className="flex items-center gap-3.5 rounded-[20px] border border-[var(--border)] bg-[var(--card)] p-[26px] transition-all hover:-translate-y-1 hover:border-[var(--a1)]"
                  >
                    <span
                      aria-hidden
                      className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full bg-[linear-gradient(135deg,var(--a1),var(--a2))] text-[17px] font-bold text-[#16150f]"
                    >
                      <ParishPhoto url={m.photo_url ?? null} name={m.name} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-bold">{m.name}</span>
                      {m.office ? (
                        <span className="block text-sm text-[var(--text-muted)]">{m.office}</span>
                      ) : null}
                      {m.bio ? (
                        <span className="mt-1 block text-[15px] text-[var(--text-muted)]">{m.bio}</span>
                      ) : null}
                    </span>
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {/* ----------------------------------------------------------------
            Join us
        ----------------------------------------------------------------- */}
        <section className="px-5 py-[84px]">
          <Reveal className="mx-auto max-w-[1040px] rounded-[28px] border border-[var(--border)] bg-[radial-gradient(ellipse_at_top,var(--glow),transparent_70%),var(--card)] px-6 py-16 text-center sm:py-[72px]">
            <p className="mb-2.5 text-xs font-bold uppercase tracking-[0.16em] text-[var(--a1)]">Join Us</p>
            <h2 className="mb-4 text-[clamp(1.75rem,4.6vw,2.75rem)] font-extrabold leading-[1.1] tracking-[-0.03em]">
              Serve at the Altar
            </h2>
            <p className="mx-auto mb-7 max-w-[480px] text-[var(--text-muted)]">
              Join {parish} and be part of the parish&apos;s ministry.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <a
                href="/register"
                className="inline-block rounded-xl border border-[var(--btn)] bg-[var(--btn)] px-[26px] py-3.5 text-[15px] font-semibold text-[var(--btn-fg)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-10px_var(--a1)]"
              >
                Apply to join
              </a>
              <a
                href="/login"
                className="inline-block rounded-xl border border-[var(--border)] bg-[var(--card)] px-[26px] py-3.5 text-[15px] font-semibold text-[var(--foreground)] transition-transform hover:-translate-y-0.5"
              >
                Sign in
              </a>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="px-5 pb-10 pt-11 text-center text-[13px] text-[var(--text-muted)]">
        <p className="mx-auto max-w-[1040px]">
          {parish} Attendance Monitoring System&trade; &middot; Created by Jerson Catadman &middot; {year}
        </p>
      </footer>
    </div>
  );
}

/**
 * Italicise a milestone's document titles.
 *
 * The body is plain text — deliberately, because a markup editor is a rich-text XSS surface aimed at a
 * public page, and two document titles are not worth one. So emphasis is applied by splitting on a
 * closed list of phrases the page knows about, which means the only strings that can reach `<em>` are
 * strings in this file.
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
      <em key={i} className="text-[var(--foreground)]">
        {p.text}
      </em>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}
