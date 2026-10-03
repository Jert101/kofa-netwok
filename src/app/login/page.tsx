import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { LoginForm } from "@/components/login-form"
import { ThemeSwitch } from "@/components/layout/ThemeSwitch"
import { SESSION_COOKIE } from "@/lib/auth/constants"
import { verifySessionTokenEdge } from "@/lib/auth/jwt-edge"
import { ROLE_PATH } from "@/lib/auth/roles"

export default async function Page() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  const session = token
    ? await verifySessionTokenEdge(token, process.env.JWT_SECRET ?? "")
    : null

  if (session?.role) {
    redirect(ROLE_PATH[session.role])
  }

return (
      <div className="relative flex min-h-svh w-full items-center justify-center p-6 md:p-10">
        {/* FW-7: the sign-in page gets the theme switch too. Module 01's QA list asks for it here, and a
            person who chooses dark before signing in should not be flashed white on the way in. */}
        <div className="absolute right-4 top-4">
          <ThemeSwitch variant="plain" />
        </div>
        <div className="w-full max-w-sm">
          <LoginForm />
        </div>
      </div>
    )
}
