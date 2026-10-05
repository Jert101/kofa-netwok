import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { LoginForm } from "@/components/login-form"
import { ThemeSwitch } from "@/components/layout/ThemeSwitch"
import { SESSION_COOKIE } from "@/lib/auth/constants"
import { verifySessionTokenEdge } from "@/lib/auth/jwt-edge"
import { safeNextPath } from "@/lib/auth/redirect"
import { isSessionValidForRole } from "@/lib/auth/session-valid"
import { ROLE_PATH } from "@/lib/auth/roles"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [jar, params] = await Promise.all([cookies(), searchParams])
  const token = jar.get(SESSION_COOKIE)?.value
  const session = token
    ? await verifySessionTokenEdge(token, process.env.JWT_SECRET ?? "")
    : null

  // A PIN change or "sign out all devices" revokes a session by timestamp, but the signature and the
  // expiry still check out -- so this page used to see a role and bounce the holder straight back to
  // their dashboard, which refused the revoked session and sent them here again, forever. Only a
  // session that is still valid earns a redirect. A revoked one falls through to the form, and signing
  // in again replaces the stale cookie.
  if (session?.role && (await isSessionValidForRole(session))) {
    redirect(safeNextPath(params.next, ROLE_PATH[session.role]))
  }

  return (
      <div className="relative flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        {/* FW-7: the sign-in page gets the theme switch too. Module 01's QA list asks for it here, and a
            person who chooses dark before signing in should not be flashed white on the way in. */}
        <div className="absolute right-4 top-4">
          <ThemeSwitch variant="plain" />
        </div>
        <div className="w-full max-w-sm">
          <LoginForm next={safeNextPath(params.next)} />
        </div>
      </div>
    )
}