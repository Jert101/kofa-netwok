import { NextRequest, NextResponse } from "next/server";
import { sendSlack } from "@/lib/slack/send";

/**
 * POST /api/slack/deployment
 *
 * Receives Vercel deployment webhooks and forwards them to Slack.
 *
 * Register this URL in your Vercel project: Settings → Git → Deployment
 * Webhooks → Add webhook → URL:
 *   https://kofa-network.vercel.app/api/slack/deployment
 *
 * Vercel will POST here on every deployment, and this route forwards
 * success/failure to Slack, including the git commit when available.
 *
 * Body (Vercel deployment webhook):
 *   { event: "deployment", payload: { uid, name, state, url, target,
 *     creator, createdAt, updatedAt, meta: { github?: { commitSha?,
 *     commitMessage?, repo? } } } }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const body = json as {
    event?: string;
    payload?: {
      uid?: string;
      name?: string;
      state?: string;
      url?: string;
      target?: string;
      creator?: { username?: string };
      createdAt?: string;
      updatedAt?: string;
      meta?: {
        github?: {
          commitSha?: string;
          commitMessage?: string;
          repo?: string;
        };
      };
    };
  };

  if (body.event !== "deployment" || !body.payload) {
    return NextResponse.json({ error: "Not a deployment webhook" }, { status: 400 });
  }

  const { payload } = body;
  const state = (payload.state ?? "").toUpperCase();
  const target = payload.target ?? "production";
  const url = payload.url ?? "";
  const creator = payload.creator?.username ?? "unknown";

  // Short SHA (first 7 chars) and commit message when available.
  const commitSha = payload.meta?.github?.commitSha;
  const shortSha = commitSha ? commitSha.slice(0, 7) : "unknown";
  const commitMsg = payload.meta?.github?.commitMessage
    ? ` — ${payload.meta.github.commitMessage}`
    : "";

  let emoji: string;
  let statusText: string;
  switch (state) {
    case "READY":
      emoji = "✅";
      statusText = "Deployed successfully";
      break;
    case "ERROR":
      emoji = "❌";
      statusText = "Deployment failed";
      break;
    case "QUEUED":
      emoji = "⏳";
      statusText = "Deployment queued";
      break;
    case "INITIALIZING":
      emoji = "🔄";
      statusText = "Deployment initializing";
      break;
    default:
      emoji = "ℹ️";
      statusText = `Deployment ${state.toLowerCase()}`;
  }

  await sendSlack(
    `${emoji} *${statusText}*\nProject: ${payload.name ?? "kofa-network"}\nCommit: \`${shortSha}\`${commitMsg}\nTarget: ${target}\nBy: ${creator}\n${url}`,
    { event: "deployment" },
  );

  return NextResponse.json({ ok: true });
}
