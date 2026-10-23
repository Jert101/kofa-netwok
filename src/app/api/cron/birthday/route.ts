import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify/notify";
import { insertOnceByDedupeKey } from "@/lib/announcements/upsert-by-key";
import { recordCronRun } from "@/lib/system/cron-run";
import { tryGetSetting } from "@/lib/settings/store";
import { churchToday } from "@/lib/time/church-time";
import { isBirthdayEligible } from "@/lib/members/birthday";
import { sendSlack } from "@/lib/slack/send";

const BIRTHDAY_MESSAGES = [
  "Happy Birthday, %s! May your day be filled with joy and blessings from the Lord.",
  "Warmest birthday greetings to %s! We thank God for your life and dedication to our community.",
  "Happy Birthday, %s! May the Lord continue to bless you and your family abundantly.",
  "Birthday blessings to %s! Have a wonderful day celebrating God's goodness in your life.",
  "Happy Birthday, %s! Wishing you a year ahead full of grace, peace, and happiness.",
  "Celebrating you today, %s! Happy Birthday and may God's love shine upon you always.",
  "Happy Birthday, %s! Your presence in our Knights of the Altar community is a true blessing.",
  "A special birthday prayer for %s! May God grant you many more years of faithful service.",
];

function randomMessage(fullName: string): string {
  const msg = BIRTHDAY_MESSAGES[Math.floor(Math.random() * BIRTHDAY_MESSAGES.length)];
  return msg.replace("%s", fullName);
}

/** `birthday:2026-10-02`, keyed on the parish's own date so a greeting is one per parish day. */
function dedupeKeyFor(date: string): string {
  return `birthday:${date}`;
}

/** The month and day of a `YYYY-MM-DD` date, as numbers, with no timezone in the arithmetic. */
function monthDay(iso: string): { month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return { month: Number(m[2]), day: Number(m[3]) };
}

/**
 * COM-1: one birthday post per parish day, one push per parish day.
 *
 * Before this, the job inserted a separate announcement per person and pushed once per person, so a
 * parish of thirty phones received thirty notifications for one day's worth of birthdays and each
 * one named somebody who had nothing to do with the reader. Now it posts once, lists everybody, and
 * pushes once. `dedupe_key` makes a rerun update the same row: the scheduler retries these jobs and
 * the second copy would be the one the parish notices.
 *
 * Two things this job got wrong, both of them the kind that look like "notifications are broken":
 *
 * 1. **It ran on UTC's calendar, not the parish's.** The cron in `vercel.json` fires at 00:00 UTC,
 *    which is 08:00 in Manila, and the comparison below used `getUTCMonth()`/`getUTCDate()` against
 *    a UTC `date_of_birth`. So on the parish's 14 October the job was asked about 13 October in UTC
 *    and congratulated the people born on the 13th, while the app's own pages -- which read
 *    `churchToday` -- said the 14th. A member whose birthday it was on the 13th got the greeting, and
 *    on the 14th the app screen and the greeting disagreed by a day. The date now comes from the
 *    parish's timezone, the same source every other page uses, and the `dedupe_key` is keyed on that
 *    parish date so one parish day is still exactly one greeting.
 *
 * 2. **It congratulated every member with a date of birth, not the servers.** This is the Knights of
 *    the Altar's birthday job: the feed is for the ministry, and the oldest members -- some of them
 *    adults recorded when the ministry carried a wider roster -- were being congratulated on every
 *    phone in a group of children. The filter is `isBirthdayEligible`, which treats a cleared `batch`
 *    and an implausible age as "no longer serving", so "who is a server" has one answer.
 *
 * The window is the same either way: the row is created once for the day and deleted after 24 hours,
 * and the push is only sent on the run that inserted it.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();

  // SYS-8: the parish's own calendar decides the day, exactly as it does on every page. `tryGetSetting`
  // rather than `getSetting` because a settings outage must not silently skip a birthday.
  const tz = await tryGetSetting("report_timezone");
  const today = churchToday(tz);
  const md = monthDay(today);
  if (!md) {
    return NextResponse.json({ ok: false, error: `Unreadable parish date: ${today}` }, { status: 500 });
  }

  const { data: members, error } = await sb
    .from("members")
    .select("id, full_name, date_of_birth, batch, is_active")
    .not("date_of_birth", "is", null)
    .eq("is_active", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const all = members ?? [];

  const birthdayMembers = all.filter((m) => {
    if (!isBirthdayEligible(m)) return false;
    const dob = m.date_of_birth as string | null;
    if (!dob) return false;
    const dobMd = monthDay(String(dob).slice(0, 10));
    return dobMd !== null && dobMd.month === md.month && dobMd.day === md.day;
  });

  if (birthdayMembers.length === 0) {
    // The counts go in the answer so the health page can tell "checked 142 members, 0 birthdays" from
    // "checked 0 members" without anyone having to add logging to find out.
    return NextResponse.json({
      ok: true,
      date: today,
      message: "No birthdays today.",
      members_with_dob: all.length,
    });
  }

  const names = birthdayMembers.map((m) => String(m.full_name));
  const body = birthdayMembers
    .map((m) => randomMessage(String(m.full_name)))
    .join("\n\n");

  const deleteAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  let announcementId: string | null = null;
  let inserted = true;
  try {
    const result = await insertOnceByDedupeKey(sb, {
      dedupe_key: dedupeKeyFor(today),
      title: names.length === 1 ? "Birthday Greeting" : "Birthday Greetings",
      body,
      created_by: "system",
      delete_at: deleteAt,
      // No `updated_at`: it is the "Edited" signal the feed prints, and a
      // generated greeting is never edited. It was sent here once, so every
      // greeting was born carrying a marker no human had earned.
    });
    announcementId = result.id;
    inserted = result.inserted;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  // A rerun still deserves to know the day was already announced, but it must not re-notify the
  // parish about a post it already saw.
  if (inserted) {
    await notify("birthday_today", { names });

    // Tell Slack too, so the coordinator sees it even without opening the app.
    const namesList = birthdayMembers.map((m) => String(m.full_name)).join(", ");
    await sendSlack(
      `🎂 *Birthday greetings sent for ${today}*\n${namesList}`,
    );
  }

  return NextResponse.json({
    ok: true,
    date: today,
    birthdays: birthdayMembers.length,
    announcement_id: announcementId,
    inserted,
  });
}

/** SYS-4: every run is recorded, so a birthday job that quietly stops is visible on the health page. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return recordCronRun("birthday", () => run(req), (res) => `status ${res.status}`);
}
