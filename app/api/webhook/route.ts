import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifySignature, downloadVideo, sendTextMessage, chunkMessage } from "@/lib/instagram";
import { analyzeReel, formatAnalysis } from "@/lib/analyze";
import type { IgWebhookBody } from "@/lib/types";

// Attachment types Meta has been observed sending for a DM'd Reel/post share.
// Confirm against real payloads in your own webhook logs (Vercel function logs)
// and extend this list if a variant shows up that isn't caught here.
const REEL_ATTACHMENT_TYPES = new Set(["share", "video", "ig_reel", "reel", "ig_post"]);

// yt-dlp retries (up to ~3min worst case) plus Gemini analysis need real headroom.
export const maxDuration = 300;

/** Meta's one-time subscription handshake: echo back the challenge if the verify token matches. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.IG_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  const appSecret = process.env.IG_APP_SECRET;
  if (!appSecret || !verifySignature(rawBody, signature, appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  const body = JSON.parse(rawBody) as IgWebhookBody;
  console.log("Incoming webhook body:", JSON.stringify(body, null, 2));

  // Ack immediately — Meta retries aggressively if it doesn't get a fast 200.
  // The actual video download + analysis + reply happens after we return.
  waitUntil(processWebhook(body));

  return new NextResponse("OK", { status: 200 });
}

async function processWebhook(body: IgWebhookBody) {
  const accessToken = process.env.IG_PAGE_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("IG_PAGE_ACCESS_TOKEN is not set — cannot reply.");
    return;
  }

  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const message = event.message;
      if (!message || message.is_echo || !message.attachments?.length) continue;

      const reelAttachment = message.attachments.find(
        (a) => REEL_ATTACHMENT_TYPES.has(a.type) && a.payload?.url
      );
      if (!reelAttachment?.payload.url) continue;

      const senderId = event.sender.id;

      try {
        await sendTextMessage(senderId, "Got it — analyzing now, one sec 🔎", accessToken);

        const { buffer, contentType } = await downloadVideo(reelAttachment.payload.url);
        const analysis = await analyzeReel(buffer, contentType);
        const reply = formatAnalysis(analysis);

        for (const chunk of chunkMessage(reply)) {
          await sendTextMessage(senderId, chunk, accessToken);
        }
      } catch (err) {
        console.error("Failed to process reel", err);
        await sendTextMessage(
          senderId,
          "Couldn't analyze that one — the video link may have expired or the format wasn't supported. Try resharing it.",
          accessToken
        ).catch(() => {});
      }
    }
  }
}
