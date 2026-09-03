// The V2 decision pipeline as a dependency, not a script.
//
// Judgment (Memory Editor → Subject Resolution → Claim Grounding → frozen V6 routing → validator)
// and the Writer (Evidence Package → family writer → Narrative Validator) were only ever wired up
// inside scripts/. That was fine while V2 was being evaluated and impossible once a queue worker had
// to run it: a worker cannot import a script, and a canary that re-implements the pipeline is not
// evidence about production. This module is the one implementation both use.
//
// It makes DECISIONS ONLY. Nothing here writes a row — persistence is production-adapter.ts, and the
// separation is what lets the organizer run the real pipeline in a dry run.
import type { EvidenceWindow } from "./evidence/types";
import type { GroundingResult } from "./claim-grounding";
import type { MemoryEditorVerdict, OrganizerOutcome } from "./contract";
import type { JudgmentPolicy } from "./judgment-policy";
import type { NarrativePerson, VerifiedMemoryEvidencePackage, WriterV2Output } from "./writer-v2";
import { groundClaims } from "./claim-grounding";
import { groundingOptionsFor } from "./judgment-policy";
import { validate } from "./validator";
import { validateMemoryEditorVerdict } from "./contract";
import { createDeepSeekMemoryEditor } from "./deepseek-editor";
import { FAMILY_REGISTRY } from "./family-registry";
import { resolveSpeaker, type IdentityRegistry } from "./identity";
import { buildEvidencePackage, packageHasAssertableMaterial } from "./writer-v2";
import { WRITER_V2_PROMPT_VERSION, WRITER_V2_SYSTEM_PROMPT, WRITER_V2_TOOL_NAME, WRITER_V2_TOOL_SCHEMA, buildWriterV2Prompt } from "./writer-v2-prompt";
import { NARRATIVE_VALIDATOR_VERSION, validateNarrative } from "./narrative-validator";
import { shanghaiCalendarDate } from "./life-date";
import type { WorthinessAxis } from "./worthiness-v2";
import type { WorthinessAxisV3 } from "./worthiness-v3";
import type { WorthinessAxisV4 } from "./worthiness-v4";

/**
 * The frozen V6 router reads a V4 worthiness axis, and the editor's axis map is typed as any of the
 * three generations it can produce. The shape is CHECKED rather than asserted: a v1/v3 axis routed
 * as v4 would be a silently different decision, which is exactly what `expectedRoutingPolicyId`
 * exists to make impossible elsewhere in this pipeline.
 */
function isV4Axis(axis: WorthinessAxis | WorthinessAxisV3 | WorthinessAxisV4): axis is WorthinessAxisV4 {
  return "noDistinctiveMemorySignal" in axis && typeof (axis as WorthinessAxisV4).newCapabilityOrIndependence?.kind === "string";
}

/** 张年 and the names his family actually uses for him. The same subject every V2 evaluation ran on. */
export const PRODUCTION_SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] } as const;

export class V2PipelineError extends Error {}

export type V2Judgment = {
  outcome: OrganizerOutcome;
  reasonCodes: string[];
  verdict: MemoryEditorVerdict;
  grounding: GroundingResult;
  /** Bounded subject resolution level, recorded on the review row as gateA. */
  subjectLevel: string;
  routingPolicyId: string;
  latencyMs: number;
};

export type V2Story =
  | { wrote: true; title: string; story: string; usedMediaIds: string[]; promptVersion: string; validatorVersion: string; latencyMs: number }
  | { wrote: false; reason: string; promptVersion: string; validatorVersion: string; latencyMs: number };

export type V2Pipeline = {
  judge(window: EvidenceWindow): Promise<V2Judgment>;
  /** Only ever called for a Memory route. Declining to write is a valid answer, never an error. */
  write(input: { window: EvidenceWindow; windowFingerprint: string; judgment: V2Judgment; birthDate?: string }): Promise<V2Story>;
};

export type PipelineOptions = {
  judgment: JudgmentPolicy;
  /** Model id recorded on the outcome and used for the Writer call. */
  model: string;
  subject?: { primaryName: string; aliases: string[] };
  registry?: IdentityRegistry;
  /** Memory Editor prompt variant. v4 is the frozen production contract. */
  variant?: "v1" | "v2" | "v3" | "v4";
  now?: () => string;
};

const identityOfWith = (registry: IdentityRegistry | undefined) => (digest: string): NarrativePerson => {
  const speaker = resolveSpeaker(digest, registry);
  return { speakerDigest: digest, known: speaker.known, canonicalPersonId: speaker.canonicalPersonId, narrativeLabel: speaker.narrativeLabel, relationshipToSubject: speaker.relationshipToSubject };
};

/**
 * The real pipeline: two live model calls per Memory (one Judgment, one Writer) and no retries of
 * either. A retry of Judgment is "ask again until it promotes", which is not a decision; a retry of
 * the Writer is a second story for one evidence set. A failed call fails the job, which the queue
 * already knows how to retry as a whole.
 */
export function createDeepSeekV2Pipeline(env: NodeJS.ProcessEnv, options: PipelineOptions): V2Pipeline {
  const subject = options.subject ?? { primaryName: PRODUCTION_SUBJECT.primaryName, aliases: [...PRODUCTION_SUBJECT.aliases] };
  const registry = options.registry ?? FAMILY_REGISTRY;
  const baseOptions = { registry, singleChildHousehold: true };
  const identityOf = identityOfWith(registry);
  const now = options.now ?? (() => new Date().toISOString());
  // The worker is the async path — a generous ceiling here is not the "raise AI_TIMEOUT_MS until it
  // stops failing" anti-pattern the sync capture route suffered from, because nobody is waiting on
  // this request. It exists so a hung provider connection cannot hold a job lease forever.
  const timeoutMs = Number(env.ORGANIZER_V2_MODEL_TIMEOUT_MS ?? 120_000);

  return {
    async judge(window) {
      const editor = createDeepSeekMemoryEditor(env, subject, { variant: options.variant ?? "v4", ...baseOptions });
      const started = Date.now();
      const raw = (await editor.organize(window)).verdict;
      const latencyMs = Date.now() - started;
      const verdict = validateMemoryEditorVerdict(raw, window);
      const axes = editor.axesByWindowId.get(window.windowId);
      const bounded = editor.subjectResolutionByWindowId.get(window.windowId);
      if (!axes || !bounded) throw new V2PipelineError("Memory Editor returned no worthiness axes for this window.");
      const worthinessAxis = axes.worthinessAxis;
      if (!isV4Axis(worthinessAxis)) {
        throw new V2PipelineError(`Memory Editor produced a worthiness axis that ${options.judgment.id} cannot route (expected the v4 axis).`);
      }
      const verdictWithAxis = { ...verdict, worthinessAxis };
      const grounding = groundClaims(window, verdictWithAxis, subject, groundingOptionsFor(options.judgment, baseOptions));
      const lookup = () => ({ worthiness: worthinessAxis, evidence: axes.evidenceAxis, subjectResolution: bounded.level, grounding });
      const result = validate(window, verdictWithAxis, {
        now: now(),
        modelVersion: options.model,
        existingLifeEvents: [],
        recentSameTypeCount: 0,
        otherChildDigests: [],
        routingPolicy: options.judgment.createRoutingPolicy(lookup, () => {}),
        expectedRoutingPolicyId: options.judgment.routingPolicyId,
        claimGrounding: grounding,
      });
      return { outcome: result.outcome, reasonCodes: result.reasonCodes, verdict: verdictWithAxis, grounding, subjectLevel: bounded.level, routingPolicyId: options.judgment.routingPolicyId, latencyMs };
    },

    async write({ window, windowFingerprint, judgment, birthDate }) {
      const versions = { promptVersion: WRITER_V2_PROMPT_VERSION, validatorVersion: NARRATIVE_VALIDATOR_VERSION };
      const apiKey = env.DEEPSEEK_API_KEY;
      const baseUrl = (env.DEEPSEEK_BASE_URL ?? "").replace(/\/$/, "");
      if (!apiKey || !baseUrl) throw new V2PipelineError("Writer v2 needs DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL.");
      const pkg: VerifiedMemoryEvidencePackage = buildEvidencePackage({
        window,
        windowFingerprint,
        grounding: judgment.grounding,
        selectedBy: { policyId: judgment.routingPolicyId, action: judgment.outcome.action, worthinessScore: judgment.outcome.worthinessScore ?? 0 },
        subject: { ...subject, narrativeLabel: subject.primaryName, birthDate },
        identityOf,
        quotableLines: (judgment.verdict.quotableLines ?? []).map((line) => ({ text: line.text, evidenceRef: line.evidenceRef, speakerRole: line.speakerRole })),
        longitudinal: [],
        lifeDate: shanghaiCalendarDate(window.timeRange.from),
      });
      // Nothing assertable is a complete answer from the evidence layer — the model is not asked.
      if (!packageHasAssertableMaterial(pkg)) return { wrote: false, reason: "nothing_assertable", ...versions, latencyMs: 0 };

      const started = Date.now();
      const response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: options.model, max_tokens: 3000, temperature: 0, thinking: { type: "disabled" },
          system: WRITER_V2_SYSTEM_PROMPT,
          tools: [{ name: WRITER_V2_TOOL_NAME, description: "输出这一页的标题、正文和逐句依据", input_schema: WRITER_V2_TOOL_SCHEMA }],
          tool_choice: { type: "tool", name: WRITER_V2_TOOL_NAME },
          messages: [{ role: "user", content: buildWriterV2Prompt(pkg) }],
        }),
      });
      const latencyMs = Date.now() - started;
      if (!response.ok) throw new V2PipelineError(`Writer v2 HTTP ${response.status}`);
      const payload = await response.json() as { content?: Array<{ type: string; name?: string; input?: unknown }> };
      const tool = payload.content?.find((block) => block.type === "tool_use" && block.name === WRITER_V2_TOOL_NAME);
      if (!tool) throw new V2PipelineError("Writer v2 returned no tool_use block.");
      const output = { contractVersion: "writer-v2-output-contract-v1", ...(tool.input as object) } as WriterV2Output;
      const validation = validateNarrative({ pkg, output });
      // A rejected narrative is NOT downgraded into a trace or retried with a softer prompt. The page
      // simply is not written, the run records why, and the evidence stays available for a human.
      if (output.insufficient) return { wrote: false, reason: "writer_declined", ...versions, latencyMs };
      if (!validation.ok) return { wrote: false, reason: `narrative_rejected:${validation.issues.map((issue) => issue.code).join(",")}`, ...versions, latencyMs };
      return { wrote: true, title: output.title ?? "", story: output.story ?? "", usedMediaIds: output.usedMediaIds ?? [], ...versions, latencyMs };
    },
  };
}
