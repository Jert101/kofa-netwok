"use client";

import { useParams, useRouter } from "next/navigation";
import { SecretaryAttendanceForm } from "@/components/SecretaryAttendanceForm";

export default function SecretaryEditSessionPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const router = useRouter();

  if (!id) {
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
      <h1 className="mb-4 text-lg font-semibold">Edit attendance</h1>
      <SecretaryAttendanceForm mode="edit" sessionId={id} />
    </div>
  );
}
