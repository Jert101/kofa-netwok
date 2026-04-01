"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MonthCalendar } from "@/components/MonthCalendar";

export default function SecretaryHomePage() {
  const [month, setMonth] = useState(() => new Date());
  const router = useRouter();

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold sm:text-xl">Encoding</h1>
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        onSelectDate={(ymd) => router.push(`/secretary/day/${ymd}`)}
      />
    </div>
  );
}
