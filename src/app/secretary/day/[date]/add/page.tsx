"use client";

import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AddSession } from "@/features/attendance/ui/AddSession";

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
      <Button type="button" variant="ghost" size="sm" onClick={() => router.back()} className="mb-3">
        ← Back
      </Button>
      <h1 className="mb-4 text-lg font-semibold">Add session</h1>
      <AddSession sessionDate={date} />
    </div>
  );
}
