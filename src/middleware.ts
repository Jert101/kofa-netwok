import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { verifySessionTokenEdge } from "@/lib/auth/jwt-edge";
import type { Role } from "@/lib/auth/roles";
import { ROLE_PATH } from "@/lib/auth/roles";

function loginUrl(req: NextRequest) {
  const u = req.nextUrl.clone();
  u.pathname = "/login";
  u.search = "";
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

  if (pathname === "/login") {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  const secret = process.env.JWT_SECRET ?? "";
  const session = token ? await verifySessionTokenEdge(token, secret) : null;

  if (pathname === "/") {
    if (!session?.role) {
      return NextResponse.redirect(loginUrl(req));
    }
    const u = req.nextUrl.clone();
    u.pathname = ROLE_PATH[session.role as Role];
    return NextResponse.redirect(u);
  }

  const need = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);

  if (need("/admin")) {
    if (session?.role !== "admin") {
      return NextResponse.redirect(loginUrl(req));
    }
    return NextResponse.next();
  }

  if (need("/secretary")) {
    if (session?.role !== "secretary") {
      return NextResponse.redirect(loginUrl(req));
    }
    return NextResponse.next();
  }

  if (need("/member")) {
    if (session?.role !== "member") {
      return NextResponse.redirect(loginUrl(req));
    }
    return NextResponse.next();
  }

  return NextResponse.redirect(loginUrl(req));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
