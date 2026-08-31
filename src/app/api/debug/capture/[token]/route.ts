import { NextResponse } from "next/server";
import { appendFile } from "node:fs/promises";
import path from "node:path";

/**
 * ============================================================================
 * Payload capture — DEVELOPMENT ONLY.
 * ============================================================================
 *
 * Sarvam's inbound calls do not fire the campaign post-call webhook; that was
 * confirmed in the console on 2026-08-29 (no webhook field on an inbound
 * deployment) and by Sarvam's own docs assistant, which points at Agent
 * Analytics instead.
 *
 * The way back in is the agent-level HTTPS tool with lifecycle `on_end`, which
 * "fires automatically at call end, typically to push captured variables out
 * to your endpoint" — agent-level, so it fires for inbound too. What the docs
 * do NOT say is what the body actually contains: whether we get only the
 * variables we template in, or call metadata such as duration, interaction_id
 * and the caller's number alongside them.
 *
 * That difference decides whether inbound calls can be billed and transcribed
 * or only turned into leads, so it is worth knowing exactly rather than
 * approximately. This route records the request verbatim so a single real
 * call answers it.
 *
 * It refuses to exist outside development. An endpoint that accepts anything
 * and echoes it back is a gift to an attacker, and the whole point of the
 * token on the real webhook route is that unauthenticated writes are not
 * acceptable — so this must never ship.
 */

const isDev = process.env.NODE_ENV === "development";

export async function POST(
  req: Request,
  ctx: RouteContext<"/api/debug/capture/[token]">
) {
  if (!isDev) return new NextResponse(null, { status: 404 });

  const { token } = await ctx.params;
  const raw = await req.text();

  // Header allowlist: capturing every header verbatim would print whatever
  // credential the hook is configured with into a log file. Only the shape
  // matters here — whether auth arrived at all, and what type.
  const auth = req.headers.get("authorization");
  const headers = {
    "content-type": req.headers.get("content-type"),
    "user-agent": req.headers.get("user-agent"),
    authorization: auth ? `${auth.split(" ")[0]} <redacted>` : null,
    "x-api-key": req.headers.get("x-api-key") ? "<redacted>" : null,
  };

  let pretty = raw;
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    /* not JSON — print it as it came */
  }

  const block = [
    "",
    "=".repeat(72),
    `[capture] ${new Date().toISOString()}  POST /api/debug/capture/${token}`,
    `[capture] headers: ${JSON.stringify(headers)}`,
    `[capture] ${raw.length} bytes`,
    "-".repeat(72),
    pretty,
    "=".repeat(72),
    "",
  ].join("\n");

  console.log(block);

  // Also to a file. The dev server's stdout belongs to whichever terminal
  // started it, and the whole point of this route is that someone else can
  // read what arrived — a file is findable from anywhere. Gitignored.
  try {
    await appendFile(
      path.join(process.cwd(), ".sarvam-capture.log"),
      block,
      "utf8"
    );
  } catch (err) {
    console.error("[capture] could not write .sarvam-capture.log", err);
  }

  // 200 with a body, because a hook that thinks it failed may retry or, worse,
  // make the agent say something to the caller.
  return NextResponse.json({ ok: true, received: raw.length });
}

export async function GET() {
  if (!isDev) return new NextResponse(null, { status: 404 });
  return NextResponse.json({
    ok: true,
    hint: "POST here from a Sarvam on_end hook; the body is printed to the dev server log.",
  });
}
