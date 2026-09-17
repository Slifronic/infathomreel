import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import type { ReelAnalysis } from "./types";

const analysisSchema = z.object({
  hook: z
    .string()
    .describe(
      "1-2 sentences opening the analysis like a sharp editorial lede, not a dry summary. Name the creator/handle if it's visible on screen or said aloud."
    ),
  keyQuote: z
    .string()
    .describe(
      "A short, notable verbatim quote or on-screen text worth showing directly (e.g. the exact prompt someone typed, a striking claim). Empty string if nothing in the video is worth quoting directly."
    ),
  itemsIdentified: z
    .array(z.string())
    .describe(
      "Specific items the video lists or covers — tools, steps, requirements, claims, products, whatever it enumerates. Pull these from BOTH the spoken audio/narration AND any on-screen text, captions, labels, or UI shown in the frames — something can appear as an on-screen label without ever being said aloud, or be spoken without appearing on screen. Check both sources independently rather than relying on the transcript alone. Empty array if the video doesn't enumerate discrete items."
    ),
  breakdown: z
    .string()
    .describe(
      "2-4 sentences of real analysis with a point of view: why this works or doesn't, what's actually good or questionable about it. Reference specifics from the video, not generic hedging."
    ),
  verdict: z.enum(["true", "false", "mixed", "unverifiable"]),
  verdictReasoning: z.string().describe("One sentence justifying the verdict, citing the specific claim(s) if any."),
  takeaway: z
    .string()
    .describe(
      "The closing point, 1-2 sentences: what the video ultimately wants the viewer to think, feel, or do. End with a genuine observation, not a generic wrap-up line."
    ),
});

const MODEL = process.env.ANALYSIS_MODEL ?? "gemini-3.6-flash";

/** Runs the reel through a video-native multimodal model to get a structured, editorial-style breakdown. */
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
              "You are analyzing an Instagram Reel shared to a bot that sends back a sharp, specific breakdown — think a media-literate friend texting back their honest take, not a generic content warning.",
              "",
              "Watch the full video closely: visuals, on-screen text/captions/UI, AND audio/narration are all separate sources of information. Cross-check them against each other — a video can show something on screen without saying it aloud, or vice versa. When asked to identify discrete items (tools, steps, claims, products, requirements), check both sources independently; do not assume the transcript alone covers everything shown.",
              "",
              "Be concrete: reference exact wording, on-screen labels, and specific moments. If the video makes no factual claims (entertainment, comedy, a recipe, a demo), say so plainly in verdictReasoning and use verdict \"unverifiable\" — don't force a true/false judgment onto something that isn't a claim.",
              "Write with an actual point of view, not hedged neutrality.",
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

/** Formats the structured analysis into plain text for Instagram DMs (no markdown rendering there). */
export function formatAnalysis(a: ReelAnalysis): string {
  const lines: string[] = [a.hook];

  if (a.keyQuote) {
    lines.push("", `"${a.keyQuote}"`);
  }

  if (a.itemsIdentified.length > 0) {
    lines.push("", "What it covers:");
    for (const item of a.itemsIdentified) lines.push(`• ${item}`);
  }

  lines.push("", a.breakdown);

  const verdictLabel = {
    true: "Checks out",
    false: "Doesn't check out",
    mixed: "Partly true",
    unverifiable: "Not a factual claim",
  }[a.verdict];
  lines.push("", `${verdictLabel} — ${a.verdictReasoning}`);

  lines.push("", a.takeaway);

  return lines.join("\n");
}
