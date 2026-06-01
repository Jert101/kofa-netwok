import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastPush } from "@/lib/push/broadcast";

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

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();

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
    const d = new Date(dob + "T00:00:00");
    return d.getUTCMonth() + 1 === month && d.getUTCDate() === day;
  });

  if (birthdayMembers.length === 0) {
    return NextResponse.json({ ok: true, message: "No birthdays today." });
  }

  const created = [];

  for (const m of birthdayMembers) {
    const fullName = m.full_name as string;
    const body = randomMessage(fullName);

    const { error: insErr } = await sb.from("announcements").insert({
      title: "Birthday Greeting",
      body,
      created_by: "system",
    });

    if (insErr) {
      created.push({ id: m.id, ok: false, error: insErr.message });
      continue;
    }

    created.push({ id: m.id, ok: true });

    void broadcastPush({
      title: "Birthday Greeting",
      body,
      url: "/member",
    });
  }

  return NextResponse.json({ ok: true, birthdays: birthdayMembers.length, created });
}
