"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { AddSession } from "@/features/attendance/ui/AddSession";
import { BadRouteParamNotice, useDayParam } from "@/features/attendance/ui/route-params";

/**
 * The admin day screen offers "+ Add session" because `canAdd` says the admin can, and it can:
 * `POST /api/attendance/session` is declared for the secretary and an admin reaches the secretary.
 * This page exists so that promise is kept -- it used to point at a route that was never created, so
 * every tap was a 404.
 */
export default function AdminAddSessionPage() {
  const date = useDayParam();
  const router = useRouter();

  if (!date) {
    return <BadRouteParamNotice what="date" homeHref="/admin" homeLabel="Back to the dashboard" />;
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