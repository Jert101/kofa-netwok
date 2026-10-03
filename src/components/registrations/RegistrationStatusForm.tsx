"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { isApiResponse } from "@/lib/api/response";
import {
  REFERENCE_CODE_LENGTH,
  describeReferenceCodeProblem,
  normalizeReferenceCodeInput,
} from "@/lib/registrations/reference-code";

type Result = {
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  reviewedAt: string | null;
  rejectReason: string | null;
};

const STATUS_COPY = {
  pending: {
    icon: Clock,
    title: "Still under review",
    body: "An admin has not looked at this application yet. You do not need to apply again.",
    tone: "text-[var(--text-muted)]",
  },
  approved: {
    icon: CheckCircle2,
    title: "Approved",
    body: "This application was approved. Sign in with your role PIN to continue.",
    tone: "text-[var(--brand)]",
  },
  rejected: {
    icon: XCircle,
    title: "Not accepted",
    body: "This application was not accepted. Speak to an admin if you think this is a mistake.",
    tone: "text-[var(--danger)]",
  },
} as const;

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export function RegistrationStatusForm({ initialCode = "" }: { initialCode?: string }) {
  const starting = normalizeReferenceCodeInput(initialCode);
  const [code, setCode] = useState(starting);
  const [result, setResult] = useState<Result | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const autoChecked = useRef(false);

  const normalized = normalizeReferenceCodeInput(code);
  const problem = describeReferenceCodeProblem(normalized);
  const canSubmit = problem === null && !busy;

  const lookup = useCallback(async (value: string) => {
    setBusy(true);
    setError(null);
    setNotFound(false);
    setResult(null);
    try {
      const res = await fetch(`/api/register/status?code=${encodeURIComponent(value)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body: unknown = await res.json();
      if (!isApiResponse<{ found: boolean; result?: Result }>(body) || !body.ok) {
        setError(
          isApiResponse(body) && !body.ok ? body.error.message : "Could not check that code.",
        );
        return;
      }
      if (body.data.found && body.data.result) {
        setResult(body.data.result);
      } else {
        setNotFound(true);
      }
    } catch {
      setError("Can't reach the server.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setResult(null);
    setNotFound(false);
  }, [code]);

  // A code arriving in the query string is checked once, so the page from the
  // confirmation card opens already showing the answer.
  useEffect(() => {
    if (autoChecked.current) return;
    if (describeReferenceCodeProblem(starting) !== null) return;
    autoChecked.current = true;
    void lookup(starting);
  }, [starting, lookup]);

  const hint =
    touched && problem === "length"
      ? `A code is ${REFERENCE_CODE_LENGTH} characters.`
      : touched && problem === "ambiguous"
        ? "That code has a 0, O, 1 or I in it. We never use those, so check for a slip."
        : touched && problem === "character"
          ? "That code has a letter or number we do not use. Check the code you were given."
          : null;

  return (
    <Card className="border-[var(--border)] bg-[var(--surface)]">
      <CardHeader>
        <CardTitle>Check an application</CardTitle>
        <CardDescription>
          Enter the reference code you were given when you applied.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (problem === null) void lookup(normalized);
          }}
          className="space-y-3"
        >
          <div>
            <label htmlFor="code" className="text-sm">
              <span className="text-[var(--text-muted)]">Reference code</span>
            </label>
            <Input
              id="code"
              className="mt-1 h-12 uppercase tracking-[0.3em]"
              value={code}
              maxLength={REFERENCE_CODE_LENGTH + 4}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXXXXXX"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onBlur={() => setTouched(true)}
              aria-describedby="code-hint"
            />
            <p id="code-hint" aria-live="polite" className="mt-1 text-xs text-[var(--text-muted)]">
              {hint ?? "Codes are letters and numbers only."}
            </p>
          </div>

          <Button type="submit" className="h-12 w-full" disabled={!canSubmit}>
            <Search aria-hidden className="size-4" />
            {busy ? "Checking…" : "Check status"}
          </Button>
        </form>

        {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}

        {notFound ? (
          <p className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm">
            No application matches that code. Check it for a slip, or apply again if you have not
            applied before.
          </p>
        ) : null}

        {result ? (
          <div
            aria-live="polite"
            className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4"
          >
            {(() => {
              const copy = STATUS_COPY[result.status];
              const Icon = copy.icon;
              return (
                <>
                  <p className={`flex items-center gap-2 font-semibold ${copy.tone}`}>
                    <Icon aria-hidden className="size-5" />
                    {copy.title}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text)]">{copy.body}</p>
                  <p className="mt-2 text-xs text-[var(--text-muted)]">
                    Applied {formatDate(result.submittedAt)}
                    {result.reviewedAt ? ` · Reviewed ${formatDate(result.reviewedAt)}` : ""}
                  </p>
                  {result.status === "rejected" && result.rejectReason ? (
                    <p className="mt-2 text-sm text-[var(--text)]">
                      <span className="text-[var(--text-muted)]">Reason: </span>
                      {result.rejectReason}
                    </p>
                  ) : null}
                  {result.status === "approved" ? (
                    <Button asChild variant="outline" className="mt-3 h-11 w-full">
                      <Link href="/login">Go to sign in</Link>
                    </Button>
                  ) : null}
                </>
              );
            })()}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
