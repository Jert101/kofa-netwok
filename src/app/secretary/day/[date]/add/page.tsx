"use client";

import { useParams, useRouter } from "next/navigation";
import { SecretaryAttendanceForm } from "@/components/SecretaryAttendanceForm";

export default function SecretaryAddPage() {
  const params = useParams();
  const date = String(params.date ?? "");
  const router = useRouter();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    router.replace("/secretary");
    return null;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => router.back()}
        className="mb-3 min-h-11 text-sm font-medium text-[var(--accent)]"
      >
        ← Back
      </button>
      <h1 className="mb-4 text-lg font-semibold">Add attendance</h1>
      <SecretaryAttendanceForm mode="create" sessionDate={date} />
    </div>
  );
}
