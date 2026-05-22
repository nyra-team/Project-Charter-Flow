import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * Single-entry LLM helper for the entire Project Hub.
 *
 * All AI calls in this app MUST go through `llm()` so that prompts,
 * models, retries, JSON parsing, observability and cost controls are
 * managed in one place.
 *
 * Configuration:
 *   - ANTHROPIC_API_KEY        (required to enable AI features)
 *   - ANTHROPIC_BASE_URL       (optional — for proxies)
 *   - LLM_DEFAULT_MODEL        (optional — default: claude-sonnet-4-6)
 *
 * If the API key is missing, `llm()` returns a structured `{ ok: false }`
 * result so callers can render a friendly "AI not configured" hint
 * instead of crashing.
 */

export type LLMRole = "system" | "user" | "assistant";

export interface LLMCallOptions<T = string> {
  /** Conversational task purpose — used for logging and future cost attribution. */
  task: string;
  /** System prompt (instructions, persona, constraints). */
  system?: string;
  /** Single user prompt — convenient shortcut for one-shot calls. */
  prompt?: string;
  /** Multi-turn messages — used when prompt is not enough. */
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  /** Override default model (e.g. "claude-haiku-4-5" for cheap calls). */
  model?: string;
  /** Max output tokens (default 2048). */
  maxTokens?: number;
  /** Sampling temperature (default 0.4). */
  temperature?: number;
  /**
   * When set, the LLM is asked to return strict JSON matching this Zod schema.
   * The helper auto-prepends formatting instructions, parses the response,
   * and validates against the schema. Returns the typed object as `data`.
   */
  jsonSchema?: z.ZodType<T>;
  /** JSON schema description shown to the model (e.g. an example or field list). */
  jsonSchemaHint?: string;
}

export type LLMResult<T = string> =
  | { ok: true; data: T; raw: string; usage?: { inputTokens?: number; outputTokens?: number } }
  | { ok: false; reason: "no_api_key" | "llm_error" | "parse_error" | "validation_error"; message: string };

const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL || "claude-sonnet-4-5";

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  _client = new Anthropic({
    apiKey,
    baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
  });
  return _client;
}

export function isLLMConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Single entry point for every AI call in the application.
 */
export async function llm<T = string>(opts: LLMCallOptions<T>): Promise<LLMResult<T>> {
  const client = getClient();
  if (!client) {
    return {
      ok: false,
      reason: "no_api_key",
      message:
        "AI features require an ANTHROPIC_API_KEY. Add it under Tools → Secrets and reload the page to enable AI Insights.",
    };
  }

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  if (opts.messages?.length) {
    messages.push(...opts.messages);
  } else if (opts.prompt) {
    messages.push({ role: "user", content: opts.prompt });
  } else {
    return { ok: false, reason: "llm_error", message: "llm() requires either prompt or messages" };
  }

  // If a JSON schema is requested, append strict formatting instructions
  // to the LAST user message so the model returns ONLY a JSON object.
  if (opts.jsonSchema) {
    const last = messages[messages.length - 1];
    const hint = opts.jsonSchemaHint
      ? `\n\nReturn ONLY a valid JSON object matching this shape (no markdown, no preamble):\n${opts.jsonSchemaHint}`
      : `\n\nReturn ONLY a valid JSON object (no markdown, no preamble).`;
    last.content = last.content + hint;
  }

  try {
    const response = await client.messages.create({
      model: opts.model || DEFAULT_MODEL,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: opts.temperature ?? 0.4,
      system: opts.system,
      messages,
    });

    const textBlocks = response.content
      .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
      .map((c) => c.text)
      .join("\n")
      .trim();

    const usage = {
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    };

    if (opts.jsonSchema) {
      const parsed = extractJson(textBlocks);
      if (parsed === null) {
        return { ok: false, reason: "parse_error", message: `LLM did not return valid JSON: ${textBlocks.slice(0, 200)}` };
      }
      const validated = opts.jsonSchema.safeParse(parsed);
      if (!validated.success) {
        return {
          ok: false,
          reason: "validation_error",
          message: `LLM JSON failed schema: ${validated.error.message}`,
        };
      }
      return { ok: true, data: validated.data as T, raw: textBlocks, usage };
    }

    return { ok: true, data: textBlocks as T, raw: textBlocks, usage };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "llm_error", message };
  }
}

/** Tolerant JSON extractor — strips markdown fences and grabs the outer object. */
function extractJson(raw: string): unknown {
  let s = raw.trim();
  // Strip ```json fences
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  }
  // If still not pure JSON, find the first { ... last }
  if (!(s.startsWith("{") || s.startsWith("["))) {
    const start = s.search(/[{\[]/);
    const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (start === -1 || end === -1 || end <= start) return null;
    s = s.slice(start, end + 1);
  }
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
