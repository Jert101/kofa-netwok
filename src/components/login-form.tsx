"use client"

import { useId, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye, EyeOff, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ActorDialog } from "@/components/auth/ActorPicker"
import { ROLE_PATH, type Role } from "@/lib/auth/roles"
import { isApiResponse } from "@/lib/api/response"

const PIN_MIN = 4
const PIN_MAX = 12

const WRONG_PIN = "That PIN isn't right. Check it and try again."
const NO_CONNECTION = "Can't reach the server. Check your connection."
const THROTTLED = "Too many attempts. Try again in a few minutes."
const GENERIC = "Something went wrong. Try again."

type LoginData = { role: Role; actorRequired: boolean; defaultPinRoles: string[] }

export function LoginForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const router = useRouter()
  const [pin, setPin] = useState("")
  const [shown, setShown] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // AUTH-4: staff roles are asked who is using the device before they land.
  const [actorStep, setActorStep] = useState<{ role: Role; required: boolean } | null>(null)

  const pinId = useId()
  const errorId = useId()

  const tooShort = pin.length > 0 && pin.length < PIN_MIN
  const invalid = tooShort || pin.length > PIN_MAX
  const message = error ?? (invalid ? `Use ${PIN_MIN}–${PIN_MAX} characters.` : null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    setError(null)
    setPending(true)

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
        credentials: "same-origin",
      })

      if (res.status === 429) {
        setError(THROTTLED)
        return
      }      if (res.status === 401) {
        setError(WRONG_PIN)
        return
      }
      if (!res.ok) {
        setError(GENERIC)
        return
      }

      const body: unknown = await res.json()
      if (!isApiResponse<LoginData>(body) || !body.ok) {
        setError(GENERIC)
        return
      }

      const { role, actorRequired } = body.data

      // Staff roles answer "who is using this device" first; members may skip,
      // and skipping simply leaves the session anonymous as it is today.
      if (actorRequired) {
        setActorStep({ role, required: true })
        return
      }

      router.replace(ROLE_PATH[role])
      router.refresh()
    } catch {
      setError(NO_CONNECTION)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={className} {...props}>
      <ActorDialog
        open={actorStep !== null}
        onOpenChange={(open) => {
          if (!open && actorStep?.required) return
          setActorStep(null)
        }}
        actor={null}
        skippable={!actorStep?.required}
        onSelected={() => {
          const role = actorStep?.role
          setActorStep(null)
          if (role) {
            router.replace(ROLE_PATH[role])
            router.refresh()
          }
        }}
      />
      <Card className="border-[var(--border)] bg-[var(--surface)]">
        <CardHeader className="gap-4">
          <div className="flex justify-center">
            <Image
              src="/logo.png"
              alt="Knights of the Altar logo"
              width={64}
              height={64}
              className="rounded-full"
              priority
            />
          </div>
          <div className="space-y-1.5 text-center">
            <CardTitle as="h1" className="text-xl text-[var(--brand)]">Sign in</CardTitle>
            <CardDescription className="text-[var(--text-muted)]">
              Knights of the Altar
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={onSubmit} noValidate>
            <FieldGroup>
              <Field data-invalid={invalid || undefined}>
                <FieldLabel htmlFor={pinId}>PIN</FieldLabel>
                <div className="relative">
                  <Input
                    id={pinId}
                    name="pin"
                    type={shown ? "text" : "password"}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={pending}
                    value={pin}
                    onChange={(event) => {
                      setPin(event.target.value)
                      if (error) setError(null)
                    }}
                    placeholder="••••"
                    maxLength={PIN_MAX}
                    aria-invalid={invalid || undefined}
                    aria-describedby={message ? errorId : undefined}
                    className="h-14 rounded-xl border-[var(--border)] bg-[var(--surface-2)] px-4 pr-12 text-lg tracking-widest"
                  />
                  <button
                    type="button"
                    onClick={() => setShown((value) => !value)}
                    disabled={pending}
                    aria-label={shown ? "Hide PIN" : "Show PIN"}
                    aria-pressed={shown}
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-[var(--text-muted)] transition-colors hover:text-[var(--brand)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--brand)]/40 disabled:opacity-50"
                  >
                    {shown ? (
                      <EyeOff className="size-5" aria-hidden />
                    ) : (
                      <Eye className="size-5" aria-hidden />
                    )}
                  </button>
                </div>
                <FieldError id={errorId} aria-live="polite">
                  {message}
                </FieldError>
              </Field>

              <Field>
                <Button
                  type="submit"
                  disabled={pending || pin.length < PIN_MIN}
                  className="h-14 w-full rounded-xl bg-[var(--brand)] text-base font-semibold text-white hover:bg-[var(--brand)]/90"
                >
                  {pending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Signing in…
                    </>
                  ) : (
                    "Sign in"
                  )}
                </Button>
                <FieldDescription className="text-center text-[var(--text-muted)]">
                  Not yet a member?{" "}
                  <Link
                    href="/register"
                    className="font-medium text-[var(--brand)] underline underline-offset-4"
                  >
                    Register here
                  </Link>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <p className="mt-8 text-center text-xs text-[var(--text-muted)]">
        Knights of the Altar Attendance Monitoring System&trade; &middot; Created by
        Jerson Catadman &middot; {new Date().getFullYear()}
      </p>
    </div>
  )
}
