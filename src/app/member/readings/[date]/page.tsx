import { BadRouteParamNotice } from "@/features/attendance/ui/route-params";
import { ReadingsView } from "@/components/readings/ReadingsView";
import { describeDate } from "@/lib/readings/calendar";
import { loadDayCitations } from "@/lib/readings/citations";
import { isIsoDate } from "@/lib/time/church-time";

export const metadata = { title: "Daily Readings" };

/**
 * One civil date's liturgy and the citations for its readings.
 *
 * A server component on purpose: the calendar is computed locally and the
 * citations are resolved (and cached) before first paint, so a member on a slow
 * phone in the parish gets the day's references or an honest notice -- never a
 * spinner waiting on a third party. The loader is written not to throw.
 */
export default async function MemberReadingsDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;

  if (!isIsoDate(date)) {
    return (
      <BadRouteParamNotice
        what="date"
        homeHref="/member/readings"
        homeLabel="Back to today's readings"
      />
    );
  }

  return <ReadingsView date={date} info={describeDate(date)} readings={await loadDayCitations(date)} />;
}
