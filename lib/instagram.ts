import crypto from "node:crypto";

const GRAPH_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;

/**
 * Meta signs every webhook POST body with the app secret. Reject anything
 * that doesn't match instead of trusting whoever hit the endpoint.
 */
export function verifySignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader) return false;
  const [algo, theirHash] = signatureHeader.split("=");
  if (algo !== "sha256" || !theirHash) return false;

  const ourHash = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  const a = Buffer.from(theirHash);
  const b = Buffer.from(ourHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const IG_PERMALINK_PATTERN = /instagram\.com\/(reel|p|tv)\//;

/** This deployment's own origin, for calling the internal yt-dlp resolver function.
 * VERCEL_URL points at the per-deployment hashed URL, which is gated behind Vercel's
 * own auth wall by default — use the stable production alias instead. */
function internalOrigin(): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** Downloads the shared media's bytes — video for a Reel, image for a static post/carousel.
 * Meta's `ig_reel`/`share` attachments give an Instagram permalink page, not a direct video
 * file, and Instagram blocks plain server-side scraping of that page — so permalinks are
 * routed through the yt-dlp resolver function (api/resolve-reel.py) instead, which handles
 * Instagram's anti-bot measures properly. `ig_post` attachments (image posts, carousels) give
 * a direct lookaside.fbsbx.com CDN link that can be fetched as-is. */
export async function downloadMedia(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const isPermalink = IG_PERMALINK_PATTERN.test(url);
  const fetchUrl = isPermalink
    ? `${internalOrigin()}/api/resolve-reel?url=${encodeURIComponent(url)}`
    : url;

  const res = await fetch(fetchUrl);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to download media: ${res.status} ${detail.slice(0, 500)}`);
  }

  const contentType = res.headers.get("content-type") ?? "unknown";
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log(`Downloaded media: content-type=${contentType} size=${buffer.length} bytes`);

  if (!contentType.startsWith("video/") && !contentType.startsWith("image/")) {
    throw new Error(
      `Expected a video or image but got content-type "${contentType}" (${buffer.length} bytes). ` +
        `First 200 bytes: ${buffer.subarray(0, 200).toString("utf-8")}`
    );
  }

  return { buffer, contentType };
}

// Instagram's shortcode is a bijective base-64 encoding (their own alphabet,
// no padding) of the numeric media ID. This is a stable, widely-documented
// conversion — not guesswork — and is how a media ID becomes a real
// instagram.com/p/<shortcode>/ permalink. Media IDs can exceed
// Number.MAX_SAFE_INTEGER, hence BigInt throughout.
const SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function mediaIdToShortcode(mediaId: string): string {
  const zero = BigInt(0);
  const base = BigInt(64);
  let id = BigInt(mediaId.split("_")[0]);
  if (id === zero) return SHORTCODE_ALPHABET[0];

  let shortcode = "";
  while (id > zero) {
    const remainder = Number(id % base);
    id /= base;
    shortcode = SHORTCODE_ALPHABET[remainder] + shortcode;
  }
  return shortcode;
}

/** Downloads every slide of a carousel post. Meta's `ig_post` attachment only gives a
 * lookaside.fbsbx.com link to the cover slide — to get the rest, rebuild the real
 * instagram.com permalink from the media ID and let yt-dlp enumerate the full carousel
 * (it exposes a multi-slide post as a playlist; the single-item resolver deliberately
 * passes --no-playlist, which is exactly what was hiding the other slides). */
export async function downloadCarouselMedia(mediaId: string): Promise<{ buffer: Buffer; contentType: string }[]> {
  const permalink = `https://www.instagram.com/p/${mediaIdToShortcode(mediaId)}/`;
  const res = await fetch(`${internalOrigin()}/api/resolve-reel?url=${encodeURIComponent(permalink)}&carousel=true`);

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to download carousel: ${res.status} ${detail.slice(0, 500)}`);
  }

  const { items } = (await res.json()) as { items: { contentType: string; dataBase64: string }[] };
  console.log(`Downloaded carousel: ${items.length} slide(s) from ${permalink}`);

  return items.map((item) => ({
    buffer: Buffer.from(item.dataBase64, "base64"),
    contentType: item.contentType,
  }));
}

/** Sends a text reply back into the DM thread with the sender. */
export async function sendTextMessage(recipientId: string, text: string, accessToken: string): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to send Instagram message: ${res.status} ${body}`);
  }
}

/** Instagram truncates DMs at 1000 chars; split long analyses across multiple sends. */
export function chunkMessage(text: string, maxLen = 950): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks;
}
