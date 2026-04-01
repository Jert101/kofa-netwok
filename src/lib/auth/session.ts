import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import type { Role } from "./roles";
import { isRole } from "./roles";
import { SESSION_COOKIE } from "./constants";

export { SESSION_COOKIE };

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error("JWT_SECRET must be set (min 16 characters)");
  }
  return new TextEncoder().encode(s);
}

export type SessionPayload = JWTPayload & { role: Role };

export async function signSession(role: Role): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (!isRole(String(payload.role))) return null;
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSessionFromCookies(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  return verifySessionToken(raw);
}

export async function setSessionCookie(role: Role) {
  const token = await signSession(role);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
