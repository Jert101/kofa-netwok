"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Copy, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isApiResponse } from "@/lib/api/response";
import {
  GENDER_OPTIONS,
  normalizeRegisterInput,
  registerSchema,
  type RegisterInput,
} from "@/features/registrations/schemas";

const NO_BATCH = "__none__";

const fieldClass =
  "h-11 rounded-xl border-[var(--border)] bg-[var(--surface-2)]";

export function SignupForm({ ...props }: React.ComponentProps<typeof Card>) {
  const [batches, setBatches] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [received, setReceived] = useState(false);
  // REG-3: shown once on the confirmation card. There is no way to look it up
  // later by name, so the card is the only chance to copy it.
  const [referenceCode, setReferenceCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // AUTH-2: when the form first appeared, used to enforce a minimum fill time.
  const formLoadedAtRef = useRef<number>(Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/batches");
        const body: unknown = await res.json();
        if (cancelled) return;
        if (isApiResponse<{ batches: string[] }>(body) && body.ok) {
          setBatches(body.data.batches);
        }
      } catch {
        /* batch is optional; an empty list still lets the form submit */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    mode: "onBlur",
    defaultValues: {
      first_name: "",
      last_name: "",
      middle_initial: "",
      date_of_birth: "",
      gender: "male",
      contact_number: "",
      batch: "",
    },
  });

  const gender = watch("gender");
  const batch = watch("batch");
  const nowYear = new Date().getFullYear();

  async function onSubmit(values: RegisterInput) {
    setFormError(null);
    const payload = {
      ...normalizeRegisterInput(values),
      // AUTH-2: honeypot stays empty for a real person, and the load timestamp
      // proves the form was on screen for a few seconds.
      company: "",
      formLoadedAt: formLoadedAtRef.current,
    };
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {
      setFormError("Can't reach the server. Check your connection.");
      return null;
    });

    if (!res) return;

    if (res.status === 429) {
      const body: unknown = await res.json().catch(() => null);
      const message =
        isApiResponse(body) && !body.ok
          ? body.error.message
          : "Too many submissions. Please wait and try again.";
      setFormError(message);
      return;
    }
    if (res.status === 409) {
      setFormError("That name is already registered or is a current member.");
      return;
    }
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      if (isApiResponse(body) && !body.ok) {
        const first = Object.values(body.error.fields ?? {})[0];
        setFormError(first ?? body.error.message);
      } else {
        setFormError("Something went wrong. Try again.");
      }
      return;
    }

    // REG-3: keep the code so the confirmation can show it. A honeypot hit answers
    // with success but no code, so this may legitimately be absent.
    const body: unknown = await res.json().catch(() => null);
    if (isApiResponse<{ received: boolean; reference_code?: string }>(body) && body.ok) {
      setReferenceCode(body.data.reference_code ?? null);
    }

    reset();
    setReceived(true);
  }

  if (received) {
    return (
      <Card
        {...props}
        className="border-[var(--border)] bg-[var(--surface)] text-center"
      >
        <CardHeader className="items-center gap-3">
          <Image
            src="/logo.png"
            alt="Knights of the Altar logo"
            width={64}
            height={64}
            className="rounded-full"
            priority
          />
          <CheckCircle2 className="size-10 text-[var(--brand-text)]" aria-hidden />
          <CardTitle as="h1" className="text-xl text-[var(--brand-text)]">
            Application received
          </CardTitle>
          <CardDescription className="text-[var(--text-muted)]">
            An admin will review it. Keep this code to check the outcome.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {referenceCode ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4">
              <p className="text-xs text-[var(--text-muted)]">Your reference code</p>
              <p className="mt-1 font-mono text-2xl font-semibold tracking-[0.25em] text-[var(--text)]">
                {referenceCode}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 h-9"
                onClick={() => {
                  void navigator.clipboard?.writeText(referenceCode);
                  setCopied(true);
                }}
              >
                <Copy aria-hidden className="size-3.5" />
                {copied ? "Copied" : "Copy code"}
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-[var(--text-muted)]">
            Write this down. We cannot show it to you again.
          </p>
          <div className="flex flex-col gap-2">
            <Button asChild className={fieldClass}>
              <Link href={`/register/status?code=${referenceCode ?? ""}`}>
                Check status
              </Link>
            </Button>
            <Button asChild variant="outline" className={fieldClass}>
              <Link href="/login">Back to sign in</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card {...props} className="border-[var(--border)] bg-[var(--surface)]">
      <CardHeader className="gap-3">
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
          <CardTitle as="h1" className="text-xl text-[var(--brand-text)]">
            Membership application
          </CardTitle>
          <CardDescription className="text-[var(--text-muted)]">
            Knights of the Altar
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          {/* AUTH-2 honeypot: hidden from people, tempting to bots. */}
          <div aria-hidden="true" className="absolute h-0 w-0 overflow-hidden opacity-0">
            <label htmlFor="company">Company</label>
            <input
              id="company"
              name="company"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              defaultValue=""
            />
          </div>
          <FieldGroup className="gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={errors.first_name ? true : undefined}>
                <FieldLabel htmlFor="first_name">First name</FieldLabel>
                <Input
                  id="first_name"
                  autoComplete="given-name"
                  className={fieldClass}
                  aria-invalid={errors.first_name ? true : undefined}
                  {...register("first_name")}
                />
                <FieldError>{errors.first_name?.message}</FieldError>
              </Field>

              <Field data-invalid={errors.last_name ? true : undefined}>
                <FieldLabel htmlFor="last_name">Last name</FieldLabel>
                <Input
                  id="last_name"
                  autoComplete="family-name"
                  className={fieldClass}
                  aria-invalid={errors.last_name ? true : undefined}
                  {...register("last_name")}
                />
                <FieldError>{errors.last_name?.message}</FieldError>
              </Field>
            </div>

            <Field data-invalid={errors.middle_initial ? true : undefined}>
              <FieldLabel htmlFor="middle_initial">
                Middle initial <span className="text-[var(--text-muted)]">(optional)</span>
              </FieldLabel>
              <Input
                id="middle_initial"
                maxLength={1}
                placeholder="M"
                className={`${fieldClass} uppercase`}
                aria-invalid={errors.middle_initial ? true : undefined}
                {...register("middle_initial")}
              />
              <FieldError>{errors.middle_initial?.message}</FieldError>
            </Field>

            <Field data-invalid={errors.date_of_birth ? true : undefined}>
              <FieldLabel htmlFor="date_of_birth">Date of birth</FieldLabel>
              <Input
                id="date_of_birth"
                type="date"
                min={`${nowYear - 100}-01-01`}
                max={`${nowYear - 10}-12-31`}
                className={fieldClass}
                aria-invalid={errors.date_of_birth ? true : undefined}
                {...register("date_of_birth")}
              />
              <FieldError>{errors.date_of_birth?.message}</FieldError>
            </Field>

            <Field data-invalid={errors.gender ? true : undefined}>
              <FieldLabel htmlFor="gender">Gender</FieldLabel>
              <div className="grid grid-cols-2 gap-3">
                {GENDER_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm has-checked:border-[var(--brand)] has-checked:bg-[var(--brand-soft)]"
                  >
                    <input
                      type="radio"
                      value={option.value}
                      checked={gender === option.value}
                      onChange={() =>
                        setValue("gender", option.value, { shouldValidate: true })
                      }
                      className="accent-[var(--brand)]"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
              <FieldError>{errors.gender?.message}</FieldError>
            </Field>

            <Field data-invalid={errors.contact_number ? true : undefined}>
              <FieldLabel htmlFor="contact_number">Contact number</FieldLabel>
              <Input
                id="contact_number"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="09xx xxx xxxx"
                className={fieldClass}
                aria-invalid={errors.contact_number ? true : undefined}
                {...register("contact_number")}
              />
              <FieldDescription>Mobile number we can reach you on.</FieldDescription>
              <FieldError>{errors.contact_number?.message}</FieldError>
            </Field>

            <Field>
              <FieldLabel htmlFor="batch">Batch</FieldLabel>
              <Select
                value={batch === "" ? NO_BATCH : batch}
                onValueChange={(value) =>
                  setValue("batch", value === NO_BATCH ? "" : value)
                }
              >
                <SelectTrigger id="batch" className={`${fieldClass} w-full`}>
                  <SelectValue placeholder="Select a batch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_BATCH}>Not applicable</SelectItem>
                  {batches.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>Optional. Leave as not applicable if unsure.</FieldDescription>
            </Field>

            {formError ? (
              <p role="alert" aria-live="polite" className="text-sm text-[var(--danger-text)]">
                {formError}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={isSubmitting}
              className="h-13 w-full rounded-xl bg-[var(--brand)] text-base font-semibold text-white hover:bg-[var(--brand)]/90"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Submitting…
                </>
              ) : (
                "Submit application"
              )}
            </Button>

            <FieldDescription className="text-center text-[var(--text-muted)]">
              Already applied?{" "}
              <Link
                href="/login"
                className="font-medium text-[var(--brand-text)] underline underline-offset-4"
              >
                Sign in
              </Link>
            </FieldDescription>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
