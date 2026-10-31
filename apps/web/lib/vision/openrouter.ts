// One frame → ScreenSummary through an OpenRouter multimodal model. The image is
// forwarded once as a data URL and never logged or stored (ARCHITECTURE.md §6.2).
import { buildVisionUserPrompt, parseScreenSummary, VISION_SYSTEM_PROMPT, type VisionRequest, type VisionResponse } from "@intelliprompter/core";

export const DEFAULT_VISION_MODEL = "google/gemini-2.5-flash";

/** Rough guard: a 1280×720 JPEG at q0.8 is ~150–300 KB; refuse anything absurd. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  return Math.floor(((dataUrl.length - comma - 1) * 3) / 4);
}

export async function describeFrame(body: VisionRequest): Promise<VisionResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set. Screen Sense needs a multimodal model on OpenRouter.");
  const model = process.env.OPENROUTER_VISION_MODEL || DEFAULT_VISION_MODEL;
  const started = Date.now();
  const text = buildVisionUserPrompt(body.context) + (body.question ? `\n\nPRESENTER'S QUESTION: ${body.question}` : "");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.PUBLIC_ORIGIN || "http://localhost:4747",
      "X-Title": "Intelliprompter",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 600,
      response_format: { type: "json_object" },
      usage: { include: true },
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text },
            { type: "image_url", image_url: { url: body.image } },
          ],
        },
      ],
    }),
  });
  const latencyMs = Date.now() - started;
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const content: string = json?.choices?.[0]?.message?.content ?? "";
  const cost: number | null = typeof json?.usage?.cost === "number" ? json.usage.cost : null;
  return { summary: parseScreenSummary(content, body.source, Date.now()), latencyMs, cost, model };
}
