/**
 * OpenAI implementation of the interpretation provider (§3, §4).
 *
 * Responses API + strict Structured Outputs, no tools, `store: false`.
 * The model id lives here only; override with the OPENAI_MODEL env var.
 *
 * Model choice: gpt-5-mini — a current, cost-conscious model with reliable
 * strict-schema adherence for short classification/explanation tasks; the
 * larger gpt-5 is unnecessary for a bounded excerpt, and reasoning effort
 * is kept low for latency and cost.
 */
import OpenAI from "openai";
import { ProviderError, toProviderError } from "../providers/errors";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompts";
import {
  INTERPRETATION_JSON_SCHEMA,
  INTERPRETATION_SCHEMA_NAME,
  parseInterpretationOutput,
} from "./schemas";
import type { InterpretationInput, InterpretationOutput, InterpretationProvider } from "./provider";

export const OPENAI_PROVIDER = "openai";
export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const MAX_OUTPUT_TOKENS = 1_200;
const TIMEOUT_MS = 45_000;

export type OpenAIProviderOptions = {
  apiKey: string | undefined;
  model?: string;
  /** Test seam: replaces the SDK call; receives the request params. */
  createImpl?: (params: Record<string, unknown>) => Promise<unknown>;
};

/** Narrow an SDK response into the parsed output; refusals and truncation are errors. */
export function mapOpenAIResponse(response: unknown): InterpretationOutput {
  if (typeof response !== "object" || response === null) {
    throw new ProviderError("Empty response", "malformed", OPENAI_PROVIDER);
  }
  const r = response as Record<string, unknown>;
  const output = Array.isArray(r.output) ? (r.output as Record<string, unknown>[]) : [];
  for (const item of output) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content as Record<string, unknown>[]) {
      if (part.type === "refusal") {
        throw new ProviderError(
          `Model refused: ${String(part.refusal ?? "").slice(0, 120)}`,
          "refusal",
          OPENAI_PROVIDER,
        );
      }
    }
  }
  if (r.status === "incomplete") {
    const reason = (r.incomplete_details as Record<string, unknown> | null)?.reason;
    throw new ProviderError(`Response incomplete: ${String(reason ?? "unknown")}`, "malformed", OPENAI_PROVIDER);
  }
  let text = typeof r.output_text === "string" ? r.output_text : "";
  if (!text) {
    for (const item of output) {
      if (item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const part of item.content as Record<string, unknown>[]) {
        if (part.type === "output_text" && typeof part.text === "string") text += part.text;
      }
    }
  }
  if (!text.trim()) throw new ProviderError("Response had no text output", "malformed", OPENAI_PROVIDER);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderError("Response was not valid JSON", "malformed", OPENAI_PROVIDER);
  }
  return parseInterpretationOutput(parsed);
}

export function buildRequestParams(input: InterpretationInput, model: string): Record<string, unknown> {
  const params: Record<string, unknown> = {
    model,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(input) },
    ],
    text: {
      format: {
        type: "json_schema",
        name: INTERPRETATION_SCHEMA_NAME,
        strict: true,
        schema: INTERPRETATION_JSON_SCHEMA,
      },
    },
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
  };
  // Reasoning models accept an effort hint; keep it low for cost/latency.
  if (/^(gpt-5|o\d)/.test(model)) params.reasoning = { effort: "low" };
  return params;
}

export function createOpenAIProvider(options: OpenAIProviderOptions): InterpretationProvider {
  const model = options.model?.trim() || DEFAULT_OPENAI_MODEL;
  const createImpl =
    options.createImpl ??
    (async (params: Record<string, unknown>) => {
      if (!options.apiKey) {
        throw new ProviderError("OPENAI_API_KEY is not configured on this deployment", "permanent", OPENAI_PROVIDER);
      }
      const client = new OpenAI({ apiKey: options.apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
      return await client.responses.create(params as never);
    });

  return {
    provider: OPENAI_PROVIDER,
    model,
    async interpret(input) {
      let response: unknown;
      try {
        response = await createImpl(buildRequestParams(input, model));
      } catch (error) {
        throw toProviderError(error, OPENAI_PROVIDER);
      }
      return mapOpenAIResponse(response);
    },
  };
}
