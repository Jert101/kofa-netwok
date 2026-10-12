import { redirect } from "next/navigation";

import { getSetting } from "@/lib/settings/store";
import { churchToday } from "@/lib/time/church-time";

/**
 * Today in the church's timezone, then straight to the dated page. One
 * rendering path instead of two: this route never renders anything itself,
 * so "today" cannot disagree between two copies of the view.
 */
export default async function MemberReadingsIndexPage() {
  const tz = await getSetting("report_timezone").catch(() => null);
  redirect(`/member/readings/${churchToday(tz)}`);
}
