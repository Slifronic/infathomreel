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

// Instagram serves rich Open Graph video tags to known crawlers (this is how
// link previews work inside Messenger/Instagram itself) but a bare fetch
// with no User-Agent gets a stripped-down page with no video reference.
const CRAWLER_USER_AGENT = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

/** Pulls the actual video URL out of an Instagram permalink page's Open Graph / embedded JSON metadata. */
function extractVideoUrlFromHtml(html: string): string | null {
  const ogVideoMatch = html.match(/<meta property="og:video:secure_url" content="([^"]+)"/)
    ?? html.match(/<meta property="og:video" content="([^"]+)"/);
  if (ogVideoMatch) {
    return ogVideoMatch[1].replace(/&amp;/g, "&");
  }

  // Fallback: Instagram embeds the raw media graph in a script tag as JSON
  // with escaped slashes/unicode — unescape before using.
  const jsonMatch = html.match(/"video_url":"(https:[^"]+?)"/);
  if (jsonMatch) {
    return jsonMatch[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  }

  return null;
}

/** Downloads the shared reel's video bytes. Meta's `share` attachment gives a permalink page,
 * not a direct video file, so this resolves that page to the real video URL first. */
export async function downloadVideo(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  let res = await fetch(url, { headers: { "User-Agent": CRAWLER_USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Failed to download reel video: ${res.status} ${res.statusText}`);
  }
  let contentType = res.headers.get("content-type") ?? "unknown";

  if (contentType.startsWith("text/html")) {
    const html = await res.text();
    const videoUrl = extractVideoUrlFromHtml(html);
    if (!videoUrl) {
      throw new Error(
        `Got an HTML permalink page instead of a video and couldn't find an embedded video URL. ` +
          `First 300 bytes: ${html.slice(0, 300)}`
      );
    }
    console.log(`Resolved permalink to video URL: ${videoUrl}`);
    res = await fetch(videoUrl, { headers: { "User-Agent": CRAWLER_USER_AGENT } });
    if (!res.ok) {
      throw new Error(`Failed to download resolved video URL: ${res.status} ${res.statusText}`);
    }
    contentType = res.headers.get("content-type") ?? "unknown";
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  console.log(`Downloaded video: content-type=${contentType} size=${buffer.length} bytes`);

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
