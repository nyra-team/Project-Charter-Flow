import { z } from "zod";

/**
 * Single-entry LLM helper for the entire Project Hub.
 *
 * All AI calls in this app MUST go through `llm()` so that prompts,
 * models, retries, JSON parsing, observability and cost controls are
 * managed in one place.
 *
 * Configuration:
 *   - AI_INTEGRATIONS_ANTHROPIC_API_KEY   (auto-provisioned by Replit AI Integrations)
 *   - AI_INTEGRATIONS_ANTHROPIC_BASE_URL  (auto-provisioned proxy URL)
 *   - ANTHROPIC_API_KEY                   (fallback — own Anthropic key)
 *   - ANTHROPIC_BASE_URL                  (fallback — own proxy URL)
 *   - LLM_DEFAULT_MODEL                   (optional — default: claude-sonnet-4-6)
 *
 * If no API key is set, `llm()` returns a structured `{ ok: false }`
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

const DEFAULT_MODEL = process.env.LLM_DEFAULT_MODEL || "claude-sonnet-4-6";

function resolveCredentials(): { apiKey?: string; baseURL?: string } {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || process.env.ANTHROPIC_BASE_URL || undefined;
  return { apiKey, baseURL };
}

export function isLLMConfigured(): boolean {
  return Boolean(resolveCredentials().apiKey);
}

// ---------------------------------------------------------------------------
// Auth-mode-aware messages-API call.
//
// The Anthropic Messages API accepts EITHER an `sk-ant-api03-*` key (sent as
// `x-api-key`) OR an `sk-ant-oat*` Claude Code OAuth token (sent as
// `Authorization: Bearer ...` + specific beta headers + the "You are Claude
// Code…" identity block + NO temperature). Send a key under the wrong scheme
// and the API silently rejects with `invalid_request_error`. This helper
// auto-detects which mode the credential needs.
//
// Mirrors the same auth handling used by `llmWithTools` below (and by
// backend/shared/llm.js via pi-ai). Keep them in sync.
// ---------------------------------------------------------------------------
type StdMessagesBody = {
  model: string;
  max_tokens: number;
  system?: unknown;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature?: number;
};

type StdMessagesResponse = {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

function isOAuthToken(key: string): boolean {
  return key.includes("sk-ant-oat");
}

function authBase(): { url: string; key: string; oauth: boolean } | null {
  const { apiKey, baseURL } = resolveCredentials();
  if (!apiKey) return null;
  const root = (baseURL || "https://api.anthropic.com").replace(/\/$/, "");
  const url = /\/v\d+$/.test(root) ? `${root}/messages` : `${root}/v1/messages`;
  return { url, key: apiKey, oauth: isOAuthToken(apiKey) };
}

function headersFor(key: string, oauth: boolean): Record<string, string> {
  if (oauth) {
    return {
      authorization: `Bearer ${key}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "oauth-2025-04-20,claude-code-20250219",
      "content-type": "application/json",
    };
  }
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  };
}

/**
 * Single entry point for every AI call in the application.
 */
export async function llm<T = string>(opts: LLMCallOptions<T>): Promise<LLMResult<T>> {
  const auth = authBase();
  if (!auth) {
    return {
      ok: false,
      reason: "no_api_key",
      message:
        "AI features require Anthropic credentials. Set ANTHROPIC_API_KEY (either an sk-ant-api03-* key or an sk-ant-oat* OAuth token) in the api-server's process env, then restart.",
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

  // Build the request body. OAuth tokens REQUIRE the Claude Code identity as
  // the first system block and MUST NOT carry temperature (Anthropic rejects
  // both deviations with a generic invalid_request_error). API keys take an
  // ordinary system string + temperature.
  const body: StdMessagesBody = {
    model: opts.model || DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 2048,
    messages,
  };
  if (auth.oauth) {
    const systemBlocks: Array<{ type: "text"; text: string }> = [
      { type: "text", text: CLAUDE_CODE_IDENTITY },
    ];
    if (opts.system) systemBlocks.push({ type: "text", text: opts.system });
    body.system = systemBlocks;
  } else {
    if (opts.system) body.system = opts.system;
    body.temperature = opts.temperature ?? 0.4;
  }

  try {
    // 429 (rate limit) / 529 (overloaded) are transient — back off and retry.
    // Bigger requests (e.g. a draft grounded in an uploaded reference doc) are
    // the most likely to trip the per-minute token limit, so a plain one-shot
    // call would fail exactly when a source document is attached.
    const MAX_RETRIES = 4;
    const payload = JSON.stringify(body);
    let res!: Response;
    for (let attempt = 0; ; attempt++) {
      res = await fetch(auth.url, {
        method: "POST",
        headers: headersFor(auth.key, auth.oauth),
        body: payload,
      });
      if (res.ok) break;
      const errText = await res.text();
      const retryable = res.status === 429 || res.status === 529 || errText.includes("overloaded");
      if (!retryable || attempt >= MAX_RETRIES) {
        return { ok: false, reason: "llm_error", message: `${res.status} ${errText.slice(0, 400)}` };
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(2 ** attempt * 1000, 8000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
    const data = (await res.json()) as StdMessagesResponse;

    const textBlocks = (data.content ?? [])
      .filter((c): c is { type: "text"; text: string } => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n")
      .trim();

    const usage = {
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
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

// ===========================================================================
// Agentic tool-use caller (NYRA / Ask-NYRA analyst)
// ===========================================================================
//
// The standard `llm()` above goes through the Anthropic SDK using x-api-key.
// That works for ordinary `sk-ant-...` API keys but NOT for the Claude Code
// OAuth tokens (`sk-ant-oat*`) this deployment runs on — those require Bearer
// auth + the OAuth beta headers + the Claude Code identity block, and reject
// `temperature`. So the tool loop below talks to the Messages API directly via
// fetch, replicating exactly what the OAuth tokens need. Keep this self-
// contained; do NOT route it through the SDK client.

const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

// Quality-first, degrade on overload rather than failing the chat.
const TOOL_MODEL_CHAIN = ["claude-opus-4-6", "claude-sonnet-4-6", "claude-haiku-4-5"];

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: string; [k: string]: unknown };
type AnthropicResponse = { content?: AnthropicBlock[]; stop_reason?: string };

function toolAuthBase(): { url: string; key: string } | null {
  const { apiKey, baseURL } = resolveCredentials();
  if (!apiKey) return null;
  const root = (baseURL || "https://api.anthropic.com").replace(/\/$/, "");
  // SDK base URLs already include /v1; bare api.anthropic.com does not.
  const url = /\/v\d+$/.test(root) ? `${root}/messages` : `${root}/v1/messages`;
  return { url, key: apiKey };
}

function toolHeaders(key: string): Record<string, string> {
  return {
    authorization: `Bearer ${key}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "oauth-2025-04-20,claude-code-20250219",
    "content-type": "application/json",
  };
}

function toolTextOf(data: AnthropicResponse): string {
  return (data.content ?? [])
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

async function postMessages(
  url: string,
  key: string,
  body: (model: string) => Record<string, unknown>,
): Promise<AnthropicResponse> {
  let lastErr = "";
  for (const model of TOOL_MODEL_CHAIN) {
    const res = await fetch(url, {
      method: "POST",
      headers: toolHeaders(key),
      body: JSON.stringify(body(model)),
    });
    if (res.ok) return (await res.json()) as AnthropicResponse;
    const errText = await res.text();
    lastErr = `${res.status} ${errText.slice(0, 200)}`;
    const retryable =
      res.status === 429 || res.status === 529 || errText.includes("overloaded");
    if (!retryable) break;
  }
  throw new Error(`Claude call failed: ${lastErr}`);
}

/**
 * Agentic tool-use loop. The model may call tools (executed by `runTool`)
 * across up to `maxTurns` rounds; returns its final natural-language text.
 * `messages` is mutated in place with the assistant/tool turns so callers can
 * inspect the full trace. Throws if no API key is configured.
 */
export async function llmWithTools(
  messages: Array<{ role: "user" | "assistant"; content: unknown }>,
  system: string,
  tools: AnthropicTool[],
  runTool: (name: string, input: any) => Promise<unknown>,
  opts: { maxTokens?: number; maxTurns?: number } = {},
): Promise<string> {
  const auth = toolAuthBase();
  if (!auth) throw new Error("ANTHROPIC_API_KEY is not configured");
  const maxTokens = opts.maxTokens ?? 2000;
  const maxTurns = opts.maxTurns ?? 5;

  for (let turn = 0; turn < maxTurns; turn++) {
    const data = await postMessages(auth.url, auth.key, (model) => ({
      model,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: CLAUDE_CODE_IDENTITY },
        { type: "text", text: system },
      ],
      tools,
      messages,
    }));

    if (data.stop_reason !== "tool_use") return toolTextOf(data);

    // Echo the assistant's full turn (text + tool_use blocks) back into history.
    messages.push({ role: "assistant", content: data.content ?? [] });

    const toolResults: unknown[] = [];
    for (const block of data.content ?? []) {
      if (block.type !== "tool_use") continue;
      const tu = block as { id: string; name: string; input: unknown };
      let result: unknown;
      try {
        result = await runTool(tu.name, tu.input);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(result).slice(0, 30000),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  // Out of turns — one final call WITHOUT tools to force a text answer.
  const data = await postMessages(auth.url, auth.key, (model) => ({
    model,
    max_tokens: maxTokens,
    system: [
      { type: "text", text: CLAUDE_CODE_IDENTITY },
      {
        type: "text",
        text: system + "\n\nProvide your final answer now using the data already gathered.",
      },
    ],
    messages,
  }));
  return toolTextOf(data);
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
