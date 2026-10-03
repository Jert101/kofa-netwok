import { NextResponse } from "next/server";
import type { ZodError } from "zod";

export const API_ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "REPORT_LOCKED",
  "SESSION_LOCKED",
  "SESSION_EXISTS",
"SESSION_IN_FUTURE",
  "APPEAL_WINDOW_CLOSED",
  "ALREADY_RESOLVED",
  "PIN_IN_USE",
  "RATE_LIMITED",
  "STORAGE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiError = {
  code: ApiErrorCode;
  message: string;
  fields?: Record<string, string>;
};

export type ApiSuccess<T> = { ok: true; data: T };
export type ApiFailure = { ok: false; error: ApiError };
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type ListQuery = {
  page: number;
  pageSize: number;
  q: string | null;
  sort: string | null;
};

export type ListData<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function jsonOk<T>(data: T, init?: { status?: number }): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: init?.status ?? 200 });
}

export function jsonError(
  code: ApiErrorCode,
  message: string,
  init?: { status?: number; fields?: Record<string, string>; headers?: Record<string, string> },
): NextResponse {
  const error: ApiError = { code, message };
  if (init?.fields) error.fields = init.fields;
  return NextResponse.json(
    { ok: false, error },
    { status: init?.status ?? statusForCode(code), headers: init?.headers },
  );
}

export function badRequest(message: string, fields?: Record<string, string>): NextResponse {
  return jsonError("BAD_REQUEST", message, { status: 400, fields });
}

export function validationFailed(
  message: string,
  fields: Record<string, string>,
): NextResponse {
  return jsonError("VALIDATION_FAILED", message, { status: 400, fields });
}

export function unauthenticated(message = "Sign in to continue."): NextResponse {
  return jsonError("UNAUTHENTICATED", message, { status: 401 });
}

export function forbidden(message = "You do not have access to this."): NextResponse {
  return jsonError("FORBIDDEN", message, { status: 403 });
}

export function notFound(message = "Not found."): NextResponse {
  return jsonError("NOT_FOUND", message, { status: 404 });
}

export function conflict(
  code: ApiErrorCode,
  message: string,
  /** Extra machine-readable context, e.g. the conflicting member's id. */
  fields?: Record<string, string>,
): NextResponse {
  return jsonError("CONFLICT", message, { status: 409, fields });
}

export function reportLocked(message: string): NextResponse {
  return jsonError("REPORT_LOCKED", message, { status: 409 });
}

/**
 * A session for this (date, mass) already exists. Carries the existing id in
 * `fields` so the client can open the session the secretary meant rather than
 * making them find it on the calendar again.
 */
export function sessionExists(existingId: string, message = "That session already exists."): NextResponse {
  return jsonError("SESSION_EXISTS", message, { status: 409, fields: { existing_session_id: existingId } });
}

/** ATT-8: the Mass has not happened yet, so there is nobody to mark present. */
export function sessionInFuture(message = "This Mass hasn't happened yet."): NextResponse {
  return jsonError("SESSION_IN_FUTURE", message, { status: 409 });
}

/** APL-6: the appeal window for this Mass has closed. */
export function appealWindowClosed(
  closesOn: string,
  message = `Appeals for this Mass closed on ${closesOn}.`,
): NextResponse {
  return jsonError("APPEAL_WINDOW_CLOSED", message, { status: 400, fields: { closes_on: closesOn } });
}

/**
 * APL-3: somebody already resolved this appeal item.
 *
 * 409 rather than 404 even though the row is still there. The reviewer's second tap is
 * the common case — two people, or one person on a slow connection — and "already
 * resolved" tells them their earlier action landed. A 404 would read as "this appeal
 * vanished", which invites a second search for something that is right there.
 */
export function alreadyResolved(message = "This appeal was already reviewed."): NextResponse {
  return jsonError("ALREADY_RESOLVED", message, { status: 409 });
}

export function rateLimited(message = "Too many attempts. Wait a moment and try again."): NextResponse {
  return jsonError("RATE_LIMITED", message, { status: 429 });
}

export function internalError(message = "Something went wrong. Try again."): NextResponse {
  return jsonError("INTERNAL_ERROR", message, { status: 500 });
}

export function statusForCode(code: ApiErrorCode): number {
  switch (code) {
    case "BAD_REQUEST":
    case "VALIDATION_FAILED":
      return 400;
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
    case "REPORT_LOCKED":
    case "SESSION_LOCKED":
    case "SESSION_EXISTS":
    case "SESSION_IN_FUTURE":
    case "PIN_IN_USE":
    case "ALREADY_RESOLVED":
      return 409;
    case "APPEAL_WINDOW_CLOSED":
      // 400, not 409. The request was well-formed; what changed is the date. A conflict
      // would suggest retrying, and retrying an expired window never works.
      return 400;
    case "RATE_LIMITED":
      return 429;
    case "STORAGE_UNAVAILABLE":
      return 503;
    case "INTERNAL_ERROR":
      return 500;
  }
}

export function isApiResponse<T>(body: unknown): body is ApiResponse<T> {
  if (typeof body !== "object" || body === null) return false;
  if (!("ok" in body)) return false;
  return (body as { ok: unknown }).ok === true || (body as { ok: unknown }).ok === false;
}

export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_form";
    if (!(key in fields)) fields[key] = issue.message;
  }
  return fields;
}

export function parseListQuery(params: URLSearchParams): ListQuery {
  const page = clampInt(params.get("page"), 1, 1, 100_000);
  const pageSize = clampInt(
    params.get("pageSize"),
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE,
  );
  const q = params.get("q")?.trim() || null;
  const sort = parseSort(params.get("sort"));
  return { page, pageSize, q, sort };
}

export function listData<T>(items: T[], total: number, query: ListQuery): ListData<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export function listOk<T>(items: T[], total: number, query: ListQuery): NextResponse {
  return jsonOk(listData(items, total, query));
}

export function toSupabaseRange(query: ListQuery): { from: number; to: number } {
  const from = (query.page - 1) * query.pageSize;
  return { from, to: from + query.pageSize - 1 };
}

function parseSort(raw: string | null): string | null {
  if (!raw) return null;
  const match = /^([A-Za-z_][A-Za-z0-9_]*):(asc|desc)$/.exec(raw.trim());
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
