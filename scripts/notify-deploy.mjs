/**
 * Notify Slack of a deployment (Vercel Hobby plan workaround).
 *
 * Run after every `npx vercel@latest deploy --prod`:
 *   npm run notify-deploy
 *
 * Reads the last commit SHA and message from git, then POSTs to
 * /api/slack/deployment which forwards to Slack via your webhook URL.
 */

import { execSync } from "child_process";
import { createReadStream } from "fs";

const sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
const msg = execSync("git log -1 --format=%s", { encoding: "utf8" }).trim();

const body = JSON.stringify({
  event: "deployment",
  payload: {
    name: "kofa-network",
    state: "READY",
    url: "https://kofa-network.vercel.app",
    target: "production",
    creator: { username: "jert101" },
    meta: { github: { commitSha: sha, commitMessage: msg } },
  },
});

const res = await fetch("https://kofa-network.vercel.app/api/slack/deployment", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Slack deploy notification failed: ${res.status} ${text}`);
  process.exit(1);
}

const json = await res.json();
console.log(`Slack deploy notification sent: ${json.ok ? "ok" : json.error}`);
