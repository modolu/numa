"use node";
/**
 * Registry of interpretation providers. Node-only (OpenAI SDK). Tests
 * replace this module with a fake provider; nothing else reads the key.
 *
 * `OPENAI_API_KEY` and the optional `OPENAI_MODEL` are server-side Convex
 * deployment env vars.
 */
import type { InterpretationProvider } from "../../lib/ai/provider";
import { createOpenAIProvider } from "../../lib/ai/openai";

export function createInterpretationProvider(): InterpretationProvider {
  return createOpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY || undefined,
    model: process.env.OPENAI_MODEL || undefined,
  });
}
