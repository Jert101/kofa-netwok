import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionTokenEdge } from "@/lib/auth/jwt-edge";
import type { Role } from "@/lib/auth/roles";
import { ROLE_SECTIONS, canReach } from "@/lib/auth/roles";

/** Everything a signed-out visitor may open. Each is matched on a segment boundary so `/register`
 *  cannot accidentally imply `/register/status`. `/` is the landing page; the page itself sends a
 *  signed-in visitor on to their own dashboard, which it can do properly because it reads the cookie
 *  rather than only its signature. */
const PUBLIC_PATHS = ["/", "/login", "/register", "/register/status"] as const;

function loginUrl(req: NextRequest) {
  const u = req.nextUrl.clone();
  u.pathname = "/login";
  u.search = "";
  // Remember where they were headed so a deep link survives the detour through the form.
  // `safeNextPath` re-validates this on the login page; it is a convenience, never a trust boundary.
  u.searchParams.set("next", req.nextUrl.pathname);
  return u;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    /\.(ico|png|svg|webp|jpg|jpeg|gif|woff2?)$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  for (const path of PUBLIC_PATHS) {
    if (pathname === path) {
      return NextResponse.next();
    }
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  const secret = process.env.JWT_SECRET ?? "";
  const session = token ? await verifySessionTokenEdge(token, secret) : null;

  // No `/` case below, deliberately. It used to redirect a signed-in visitor to their role's home from
  // here, on the strength of `session.role` alone -- and that comes from a signature check, which a PIN
  // change or "sign out all devices" leaves intact. The holder was sent to a dashboard that refused
  // them, then to `/login`, then back here: a loop. The landing page forwards instead, after
  // `isSessionValidForRole`, which is the same answer every role layout gives.

  const need = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

  /*
    COM-4: the one authenticated page that is not under a role prefix. It renders the caller's own
    sidebar, so it reads the role from the session instead of from the path. Any role, still signed in.
  */
  if (need("/notifications")) {
    if (!session?.role) {
      return NextResponse.redirect(loginUrl(req));
    }
    return NextResponse.next();
  }

  /*
    Role prefixes are checked against `ROLE_REACH` rather than against one hard-coded role each.
    A section is open to the role that owns it plus every role that oversees it, so the admin and the
    super admin can follow a link into any other role's pages; everyone else is still turned away, and
    `admin` still cannot open `/super-admin`. Middleware stays a cheap signature check -- whether the
    session was revoked is settled again in the layout, where the cookie can be read properly.
  */
  for (const { prefix, role } of ROLE_SECTIONS) {
    if (!need(prefix)) continue;
    if (!session?.role || !canReach(session.role as Role, role)) {
      return NextResponse.redirect(loginUrl(req));
    }
    return NextResponse.next();
  }

  /*
    Nothing here claims the path. Redirecting an unknown URL to `/login` made a typo look like a
    sign-in problem and turned a wrong link into a dead end with no way to tell which it was, so an
    unmatched path is handed to Next.js, which renders `not-found.tsx` with the real status code.
    Middleware's job is deciding who may open a page that exists, not inventing a destination.
  */
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
