import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import type { ReelAnalysis } from "./types";

const analysisSchema = z.object({
  verdict: z.enum(["true", "false", "mixed", "unverifiable"]),
  verdictReasoning: z.string().describe("1-2 sentences on why this verdict, citing the specific claim(s) made in the video"),
  questionable: z.array(z.string()).describe("Specific claims, framing, or editing choices worth being skeptical of. Empty array if none."),
  resources: z.array(z.string()).describe("Concrete resources, links, products, or actions the video points viewers toward. Empty array if none."),
  purpose: z.string().describe("The video's core point in one or two sentences: what it wants the viewer to think, feel, or do"),
});

const MODEL = process.env.ANALYSIS_MODEL ?? "gemini-2.5-flash";

/** Runs the reel through a video-native multimodal model to get a structured fact-check style breakdown. */
export async function analyzeReel(videoBuffer: Buffer): Promise<ReelAnalysis> {
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
              "You are analyzing an Instagram Reel that was shared to a fact-checking bot.",
              "Watch the video (visuals, on-screen text, and audio/narration) and assess it.",
              "",
              "Be concrete and specific — reference what is actually said or shown, not generic caveats.",
              "If the video makes no factual claims (e.g. it's pure entertainment, a recipe, a meme), say so in verdictReasoning and use verdict \"unverifiable\".",
            ].join("\n"),
          },
          {
            type: "file",
            data: videoBuffer,
            mediaType: "video/mp4",
          },
        ],
      },
    ],
  });

  return object;
}

/** Formats the structured analysis into the DM reply text. */
export function formatAnalysis(a: ReelAnalysis): string {
  const lines: string[] = [];

  const verdictLabel = { true: "✅ Likely true", false: "❌ Likely false", mixed: "⚠️ Mixed / partly true", unverifiable: "❔ Not a factual claim" }[a.verdict];
  lines.push(verdictLabel);
  lines.push(a.verdictReasoning);

  if (a.questionable.length > 0) {
    lines.push("", "Worth questioning:");
    for (const q of a.questionable) lines.push(`• ${q}`);
  }

  if (a.resources.length > 0) {
    lines.push("", "Resources mentioned:");
    for (const r of a.resources) lines.push(`• ${r}`);
  }

  lines.push("", `Point of the video: ${a.purpose}`);

  return lines.join("\n");
}
