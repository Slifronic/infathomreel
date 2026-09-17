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

/** Downloads the shared reel's video bytes from the CDN URL Meta puts in the webhook payload. */
export async function downloadVideo(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download reel video: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") ?? "unknown";
  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log(`Downloaded attachment: content-type=${contentType} size=${buffer.length} bytes`);

  if (!contentType.startsWith("video/")) {
    throw new Error(
      `Expected a video but got content-type "${contentType}" (${buffer.length} bytes). ` +
        `First 200 bytes: ${buffer.subarray(0, 200).toString("utf-8")}`
    );
  }

  return { buffer, contentType };
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
