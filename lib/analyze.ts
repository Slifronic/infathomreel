import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import type { ReelAnalysis } from "./types";

const analysisSchema = z.object({
  summary: z.string().describe("1-2 plain sentences: what the video shows or claims. No commentary, no hooks, just what it is."),
  tools: z
    .array(
      z.object({
        name: z.string().describe("The specific, findable name of the tool, app, product, or skill — exact enough to search for and find it"),
        description: z.string().describe("One short phrase: what it does"),
      })
    )
    .describe(
      "Every specific tool, app, product, or skill named or shown in the video — check on-screen text/UI/labels AND spoken audio independently, since a name can appear in one without the other. Empty array if the video doesn't feature a specific tool/product."
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

/** Runs the reel through a video-native multimodal model to identify tools/products it features and verify them. */
export async function analyzeReel(videoBuffer: Buffer, mediaType: string): Promise<ReelAnalysis> {
  console.log(`Analyzing video: mediaType=${mediaType} size=${videoBuffer.length} bytes model=${MODEL}`);

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
              "You're analyzing an Instagram Reel for someone who saves videos about tools/products (e.g. a Claude Code skill, an app, a piece of software) so they can find and use them later.",
              "",
              "Their actual need: the exact name of any tool/product featured, well enough to search for and find it, and whether it's real or fake/exaggerated. They are not interested in editorial commentary, tone, or entertainment value — keep this factual and skimmable.",
              "",
              "Watch the full video: on-screen text/UI/captions and spoken audio are separate sources — check both independently, since a tool's name can appear in one without the other.",
              "",
              "If no specific tool or product is shown, return an empty tools array and set verdict/confidence/source based on whatever factual claim (if any) the video makes instead.",
            ].join("\n"),
          },
          {
            type: "file",
            data: videoBuffer,
            mediaType,
          },
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
    for (const t of a.tools) lines.push(`• ${t.name} — ${t.description}`);
  }

  const verdictLabel = { real: "Real", fake: "Fake", uncertain: "Uncertain" }[a.verdict];
  lines.push("", `Verdict: ${verdictLabel} (${a.confidence}% confidence)`);
  lines.push(`Source: ${a.source}`);

  return lines.join("\n");
}
