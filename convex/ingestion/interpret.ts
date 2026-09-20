"use node";
/**
 * Source-change interpretation (NUMA_ARCHITECTURE.md §17, §18):
 *
 *   pending interpretation → bounded structured input → model (strict
 *   schema) → local validation → persisted result → generic event upgraded
 *
 * The only network call is the model request. Failures never touch the
 * generic `protocol_update` event, which remains the fallback; transient
 * failures retry with bounded backoff, everything else stops.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import { toProviderError } from "../../lib/providers/errors";
import { buildInterpretationInput, interpretationInputHash } from "../../lib/ai/input";
import { validateInterpretation } from "../../lib/ai/validation";
import { MAX_INTERPRETATION_ATTEMPTS, RETRY_DELAYS_MS } from "../interpretations";
import { createInterpretationProvider } from "./aiAdapters";

export type InterpretRunResult =
  | { status: "ok"; interpretationId: Id<"interpretations">; relevant: boolean; severity: string; capped: boolean }
  | { status: "rejected"; interpretationId: Id<"interpretations">; reason: string }
  | { status: "failed"; interpretationId: Id<"interpretations">; kind: string; error: string; willRetry: boolean }
  | { status: "skipped"; interpretationId: Id<"interpretations">; reason: string };

export async function performInterpretation(
  ctx: ActionCtx,
  interpretationId: Id<"interpretations">,
): Promise<InterpretRunResult> {
  const context = await ctx.runQuery(internal.interpretations.getContext, { interpretationId });
  if (!context) return { status: "skipped", interpretationId, reason: "context unavailable" };
  if (context.interpretation.status === "ok" || context.interpretation.status === "rejected") {
    return { status: "skipped", interpretationId, reason: `already ${context.interpretation.status}` };
  }
  // Interpret exactly the version this row is for; a newer crawl gets its own row.
  if (context.source.contentHash !== context.interpretation.contentHash || !context.source.latestContent) {
    return { status: "skipped", interpretationId, reason: "source moved on to a newer version" };
  }

  const claim = await ctx.runMutation(internal.interpretations.markRunning, { interpretationId, now: Date.now() });
  if (!claim.started) return { status: "skipped", interpretationId, reason: claim.reason ?? "not started" };

  const now = Date.now();
  const input = buildInterpretationInput({
    protocol: { slug: context.protocol.slug, name: context.protocol.name },
    source: {
      url: context.source.url,
      sourceType: context.source.sourceType,
      title: context.source.latestTitle,
      previousHash: context.source.previousContentHash ?? "none",
      currentHash: context.source.contentHash,
    },
    content: context.source.latestContent,
    exposure: context.exposure,
    now,
  });
  const inputHash = interpretationInputHash(input);
  const provider = createInterpretationProvider();

  try {
    const output = await provider.interpret(input);
    const validation = validateInterpretation(output, input, now);
    if (!validation.ok) {
      await ctx.runMutation(internal.interpretations.recordRejection, {
        interpretationId,
        reason: validation.reason,
        details: validation.details,
        provider: provider.provider,
        model: provider.model,
        inputHash,
        now: Date.now(),
      });
      return { status: "rejected", interpretationId, reason: validation.reason };
    }
    const v = validation.value;
    await ctx.runMutation(internal.interpretations.recordSuccess, {
      interpretationId,
      provider: provider.provider,
      model: provider.model,
      inputHash,
      now: Date.now(),
      result: {
        relevant: v.relevant,
        confidence: v.confidence,
        eventType: v.eventType,
        category: v.category,
        headline: v.headline,
        summary: v.summary,
        whyItMatters: v.whyItMatters,
        recommendedAction: v.recommendedAction ?? undefined,
        requiresAction: v.requiresAction,
        deadline: v.deadline ?? undefined,
        deadlineEvidence: v.deadlineEvidence ?? undefined,
        claimedSeverity: v.claimedSeverity,
        severity: v.severity,
        priorityScore: v.priorityScore,
        severityCapped: v.severityCapped,
        evidence: v.evidence,
        unsupportedClaims: v.unsupportedClaims,
        relevanceReason: v.relevanceReason,
        notes: v.notes,
        exposureOrigin: input.exposure.origin,
      },
    });
    return { status: "ok", interpretationId, relevant: v.relevant, severity: v.severity, capped: v.severityCapped };
  } catch (error) {
    const providerError = toProviderError(error, provider.provider);
    const message = `${provider.provider}: ${providerError.message}`;
    console.error("interpretation failed", interpretationId, providerError.kind, message);
    const { attempts } = await ctx.runMutation(internal.interpretations.recordFailure, {
      interpretationId,
      kind: providerError.kind,
      message,
      now: Date.now(),
    });
    const willRetry = providerError.kind === "transient" && attempts < MAX_INTERPRETATION_ATTEMPTS;
    if (willRetry) {
      const delay = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS[0];
      await ctx.scheduler.runAfter(delay, internal.ingestion.interpret.run, { interpretationId });
    }
    return { status: "failed", interpretationId, kind: providerError.kind, error: message, willRetry };
  }
}

export const run = internalAction({
  args: { interpretationId: v.id("interpretations") },
  handler: async (ctx, args): Promise<InterpretRunResult> => {
    return await performInterpretation(ctx, args.interpretationId);
  },
});

/**
 * DEVELOPMENT ONLY (internal): confirm the configured model exists for this
 * account without sending any content. Returns model ids only, never keys.
 */
export const devProbeModel = internalAction({
  args: {},
  handler: async (): Promise<{ configured: string; available: boolean; alternatives: string[] }> => {
    const { default: OpenAI } = await import("openai");
    const { DEFAULT_OPENAI_MODEL } = await import("../../lib/ai/openai");
    const configured = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const models = await client.models.list();
    const ids: string[] = [];
    for await (const m of models) ids.push(m.id);
    return {
      configured,
      available: ids.includes(configured),
      alternatives: ids.filter((id) => /^gpt-5/.test(id)).sort().slice(0, 20),
    };
  },
});
