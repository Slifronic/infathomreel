import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import type { ReelAnalysis } from "./types";

const analysisSchema = z.object({
  summary: z.string().describe("1-2 plain sentences: what the content shows or claims. No commentary, no hooks, just what it is."),
  tools: z
    .array(
      z.object({
        name: z.string().describe("The specific, findable name of the tool, app, product, or skill — exact enough to search for and find it"),
        description: z.string().describe("One short phrase: what it does"),
        whereToFind: z
          .string()
          .describe(
            "Exactly how someone could go find and get this. If a URL, @handle, repo name, or 'link in bio' is shown on-screen or spoken in the audio, quote it verbatim. Otherwise name the specific platform it lives on (GitHub, Chrome Web Store, App Store, npm, a company's own site, a Claude Code skill/plugin, etc.) plus the exact search term to use. Never invent a URL or handle that isn't actually shown or stated."
          ),
      })
    )
    .describe(
      "Every specific tool, app, product, or skill named or shown — check on-screen text/UI/labels AND spoken audio (if present) independently, since a name (and any link/handle/resource for it) can appear in one without the other. Empty array if it doesn't feature a specific tool/product."
    ),
  verdict: z
    .enum(["real", "fake", "uncertain"])
    .describe(
      "real: the tool/claim genuinely exists and works as shown. fake: fabricated, AI-generated, or the tool doesn't do what's claimed. uncertain: not enough evidence in the video alone to tell."
    ),
  confidence: z.number().int().min(0).max(100).describe("0-100: how confident you are in the verdict"),
  source: z
    .string()
    .describe(
      "One sentence: what the verdict is based on — e.g. 'matches publicly documented behavior of this tool', 'no independent way to verify from the video alone', 'the demo shown doesn't match how this tool actually works'."
    ),
});

const MODEL = process.env.ANALYSIS_MODEL ?? "gemini-3.6-flash";

export interface MediaItem {
  buffer: Buffer;
  mediaType: string;
}

/** Runs the shared content — a video Reel, a single image post, or every slide of a
 * carousel post together — through a multimodal model to identify tools/products it
 * features and verify them. Carousel slides are sent as separate file parts in the same
 * message so the model reads them as one connected post, not isolated images. */
export async function analyzeReel(media: MediaItem[]): Promise<ReelAnalysis> {
  const hasVideo = media.some((m) => m.mediaType.startsWith("video/"));
  const kind = hasVideo ? "video" : media.length > 1 ? "carousel" : "image";
  const totalSize = media.reduce((sum, m) => sum + m.buffer.length, 0);
  console.log(`Analyzing ${kind}: ${media.length} item(s), ${totalSize} bytes total, model=${MODEL}`);

  const kindDescription = {
    video: "Reel",
    image: "post (a static image, possibly a listicle/infographic)",
    carousel: `carousel post (${media.length} slides — read them as one connected post, in order)`,
  }[kind];

  const { object } = await generateObject({
    model: google(MODEL),
    schema: analysisSchema,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `You're analyzing an Instagram ${kindDescription} for someone who saves content about tools/products (e.g. a Claude Code skill, an app, a piece of software) so they can find and use them later.`,
              "",
              "Their actual need: the exact name of any tool/product featured, well enough to search for and find it, exactly where/how to actually go get it, and whether it's real or fake/exaggerated. They are not interested in editorial commentary, tone, or entertainment value — keep this factual and skimmable.",
              "",
              kind === "video"
                ? "Watch the full video: on-screen text/UI/captions and spoken audio are separate sources — check both independently, since a tool's name (and any link, @handle, repo, or 'link in bio' for it) can appear in one without the other."
                : "Read every piece of on-screen text carefully across every slide — listicle graphics often pack many tool names into small labels or a numbered list, sometimes one item per slide, and links/handles are often shown in small text under or beside the tool name.",
              "",
              "For every tool, actively look for a concrete way to find it — a URL, @handle, repo name, or 'link in bio' shown on screen or spoken out loud — and quote it exactly if one exists. Don't guess or invent one if it isn't actually there; in that case, point to the most specific real place it can be found instead (e.g. GitHub, the App Store, npm, the company's own site) plus the exact term to search.",
              "",
              `If no specific tool or product is shown, return an empty tools array and set verdict/confidence/source based on whatever factual claim (if any) the ${kind} makes instead.`,
            ].join("\n"),
          },
          ...media.map((m) => ({
            type: "file" as const,
            data: m.buffer,
            mediaType: m.mediaType,
          })),
        ],
      },
    ],
  });

  return object;
}

/** Formats the structured analysis into plain, skimmable text for Instagram DMs. */
export function formatAnalysis(a: ReelAnalysis): string {
  const lines: string[] = [a.summary];

  if (a.tools.length > 0) {
    lines.push("", "Tools:");
    for (const t of a.tools) {
      lines.push(`• ${t.name} — ${t.description}`);
      lines.push(`  Find it: ${t.whereToFind}`);
    }
  }

  const verdictLabel = { real: "Real", fake: "Fake", uncertain: "Uncertain" }[a.verdict];
  lines.push("", `Verdict: ${verdictLabel} (${a.confidence}% confidence)`);
  lines.push(`Source: ${a.source}`);

  return lines.join("\n");
}
