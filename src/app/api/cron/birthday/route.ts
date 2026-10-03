import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notify/notify";
import { insertOnceByDedupeKey } from "@/lib/announcements/upsert-by-key";
import { recordCronRun } from "@/lib/system/cron-run";

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

/** `birthday:2026-10-02`. The date is in UTC because that is what the birthday comparison uses. */
function dedupeKeyFor(now: Date): string {
  return `birthday:${now.toISOString().slice(0, 10)}`;
}

/**
 * COM-1: one birthday post per day, one push per day.
 *
 * Before this, the job inserted a separate announcement per person and pushed once per person, so a
 * parish of thirty phones received thirty notifications for one day's worth of birthdays and each
 * one named somebody who had nothing to do with the reader. Now it posts once, lists everybody, and
 * pushes once. `dedupe_key` makes a rerun update the same row: the scheduler retries these jobs and
 * the second copy would be the one the parish notices.
 */
async function run(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  const today = new Date();
  // UTC on both sides. The comparison below reads UTC fields, and a date-of-birth column is meant as
  // a calendar date, not an instant: "March 3" is March 3 no matter where the server runs. Dates
  // parsed as local midnight then read back as UTC shift a day for any timezone ahead of UTC, so a
  // server west of Greenwich could wish somebody happy birthday the day before it happened.
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();

  const { data: members, error } = await sb
    .from("members")
    .select("id, full_name, date_of_birth")
    .not("date_of_birth", "is", null)
    .eq("is_active", true);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!members || members.length === 0) {
    return NextResponse.json({ ok: true, message: "No birthdays today." });
  }

  const birthdayMembers = members.filter((m) => {
    const dob = m.date_of_birth as string | null;
    if (!dob) return false;
    const d = new Date(dob + "T00:00:00Z");
    return d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
  });

  if (birthdayMembers.length === 0) {
    return NextResponse.json({ ok: true, message: "No birthdays today." });
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
      updated_at: new Date().toISOString(),
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
  }

  return NextResponse.json({
    ok: true,
    birthdays: birthdayMembers.length,
    announcement_id: announcementId,
    inserted,
  });
}

/** SYS-4: every run is recorded, so a birthday job that quietly stops is visible on the health page. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return recordCronRun("birthday", () => run(req), (res) => `status ${res.status}`);
}