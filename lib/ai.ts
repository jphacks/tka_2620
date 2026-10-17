// Claude through the AI SDK (docs/SPEC.md → LLM contracts). The model ids come from the environment, like
// scripts/smoke.ts; each engine function takes the model as an argument, so tests pass a fake one.
import {
  type AnthropicLanguageModelOptions,
  anthropic,
} from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}

// Sonnet: answers, card drafting and import.
export function sonnet(): LanguageModel {
  env("ANTHROPIC_API_KEY"); // presence only; the provider reads the key itself
  return anthropic(env("ANSWER_MODEL"));
}

// Low effort keeps the live loop fast. Default fallbacks re-run a refused request on another model within the
// same call. Structured output goes through output_config.format: Sonnet 5.5 rejects the forced JSON tool.
export const sonnetOptions = {
  anthropic: {
    effort: "low",
    fallbacks: "default",
  } satisfies AnthropicLanguageModelOptions,
};

// Untrusted text (note bodies, pasted docs, spoken answers) as data inside a tag. Angle brackets become full-width,
// so the text can't close its tag or open another one.
export function untrusted(tag: string, text: string): string {
  const inert = text.replaceAll("<", "＜").replaceAll(">", "＞");
  return `<${tag}>\n${inert}\n</${tag}>`;
}
