// AI plumbing smoke test: two bge-m3 embeddings through Ollama and one Claude call.
// Run with `pnpm smoke` (loads .env.local). Prints sizes, timings and the reply, never keys.
import {
  type AnthropicLanguageModelOptions,
  anthropic,
} from "@ai-sdk/anthropic";
import { generateText } from "ai";

const sentences = {
  ja: "模擬店の保健所申請は、学祭の3週間前までに学生課へ出します。",
  en: "The food stall's health office application goes to the student office three weeks before the festival.",
};

function env(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} is not set; copy it from .env.example into .env.local`,
    );
  return value;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / Math.sqrt(normA * normB);
}

async function embeddings(): Promise<string> {
  const response = await fetch(`${env("OLLAMA_BASE_URL")}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: env("EMBED_MODEL"),
      input: [sentences.ja, sentences.en],
    }),
  });
  if (!response.ok)
    throw new Error(
      `Ollama answered ${response.status}: ${await response.text()}`,
    );
  const { embeddings } = (await response.json()) as { embeddings: number[][] };
  const [ja, en] = embeddings;
  for (const [lang, vector] of [
    ["ja", ja],
    ["en", en],
  ] as const) {
    if (vector?.length !== 1024 || !vector.every(Number.isFinite)) {
      throw new Error(
        `${lang}: expected 1,024 numbers, got ${vector?.length ?? 0}`,
      );
    }
  }
  return `ja 1,024 numbers, en 1,024 numbers, ja/en cosine similarity ${cosine(ja, en).toFixed(3)}`;
}

async function claude(): Promise<string> {
  env("ANTHROPIC_API_KEY"); // presence only; the provider reads the key itself
  const result = await generateText({
    model: anthropic(env("ANSWER_MODEL")),
    prompt: "Reply with the single word OK.",
    // Adaptive-only models such as Sonnet 5.5 think first, and thinking counts toward this limit.
    maxOutputTokens: 1024,
    providerOptions: {
      anthropic: { effort: "low" } satisfies AnthropicLanguageModelOptions,
    },
  });
  if (result.finishReason !== "stop") {
    throw new Error(
      `finished with ${result.finishReason} (${result.rawFinishReason})`,
    );
  }
  const { inputTokens, outputTokens } = result.usage;
  return `${result.response.modelId} replied "${result.text.trim()}" (${inputTokens} in, ${outputTokens} out tokens)`;
}

let failed = false;
for (const [name, check] of [
  ["bge-m3", embeddings],
  ["Claude", claude],
] as const) {
  const started = performance.now();
  try {
    const detail = await check();
    console.log(
      `✓ ${name}: ${detail} (${Math.round(performance.now() - started)} ms)`,
    );
  } catch (error) {
    failed = true;
    console.error(
      `✗ ${name}: ${error instanceof Error ? error.message : error}`,
    );
  }
}
process.exitCode = failed ? 1 : 0;
