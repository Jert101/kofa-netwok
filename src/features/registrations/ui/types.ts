import type { RequestRow } from "@/features/registrations/server/decide-request";

export type RegistrationRequest = Omit<RequestRow, "full_name"> & {
  full_name: string;
  reference_code: string | null;
  created_at: string;
  reviewed_at: string | null;
  /** Name of the active member that shares this name, when one does. */
  possible_duplicate_name: string | null;
  /** Another pending application on this page has the same name. */
  possible_duplicate_pending: boolean;
};

export type RequestCounts = {
  pending: number;
  approved: number;
  rejected: number;
};

export type Tab = keyof RequestCounts;

export const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export function formatSubmitted(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export function formatSubmittedTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/** REG-2: the admin is told, the applicant never is. */
export function duplicateLabel(request: RegistrationRequest): string | null {
  if (request.possible_duplicate_name) {
    return `Possible duplicate of ${request.possible_duplicate_name}`;
  }
  if (request.possible_duplicate_pending) {
    return "Possible duplicate of another pending application";
  }
  return null;
}
