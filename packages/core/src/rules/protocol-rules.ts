// Protocol drift rules for UND100, UND110, UND120, and UND130 as specified in LLD.md Section 10.4–10.7 and 11.1.
// Evaluates endpoint existence, method conflicts, and suspected route mismatches.

import type { AnalysisWarning, Finding } from "../domain/finding";
import { createFindingId } from "../domain/finding";
import type { ApiObservation, RoutePattern } from "../domain/observation";
import type { ContractRelationship } from "../domain/relationship";
import type { AnalysisCoverageSummary } from "../domain/types";
import { explainFinding, formatExplanationText } from "../explaining/finding-explainer";
import {
  areRouteShapesEqual,
  getKnownMethod,
  getKnownRoute,
  isSuspectedSegmentTypo,
  matchCandidates
} from "../matching/contract-matcher";
import { formatRoutePattern } from "../normalization/route-normalizer";

/**
 * Supported protocol and endpoint existence rule identifiers defined in LLD.md Section 11.1.
 */
export const PROTOCOL_RULE_IDS = {
  UND100: "UND100",
  UND110: "UND110",
  UND120: "UND120",
  UND130: "UND130"
} as const;

export type ProtocolRuleId = (typeof PROTOCOL_RULE_IDS)[keyof typeof PROTOCOL_RULE_IDS];

/**
 * Context options controlling protocol rule evaluation, particularly coverage gating.
 */
export interface ProtocolRuleContext {
  /**
   * Overall workspace analysis coverage summary, if available.
   */
  coverage?: AnalysisCoverageSummary;

  /**
   * Explicit flag indicating whether backend / provider analysis was sufficiently complete.
   * If false, or if omitted without complete coverage, UND100 (missing provider) findings
   * will be withheld. Conflicting signals favor incompleteness: a false signal always wins.
   */
  backendScanComplete?: boolean;

  /**
   * Explicit flag indicating whether frontend / consumer analysis was sufficiently complete.
   * If false, or if omitted without complete coverage, UND110 (orphaned provider) findings
   * will be withheld. Conflicting signals favor incompleteness: a false signal always wins.
   */
  consumerScanComplete?: boolean;
}

/**
 * Resolves whether a specific analysis scope (backend or consumer) is sufficiently complete
 * according to the conservative coverage gating policy of LLD.md Section 10.6, 10.7, and 11.1.
 *
 * Policy:
 * 1. Missing or unverified coverage defaults to false (absence findings withheld).
 * 2. Any explicit false signal (scope-specific flag or overall coverage) immediately resolves to false.
 * 3. Conflicting signals favor incompleteness: a false signal cannot be overridden by true.
 * 4. Completeness is established only if at least one applicable signal is true and neither is false.
 */
export function resolveScopeCompleteness(scopeFlag?: boolean, coverageComplete?: boolean): boolean {
  if (scopeFlag === false || coverageComplete === false) {
    return false;
  }
  return scopeFlag === true || coverageComplete === true;
}

/**
 * Input parameters for protocol rule evaluation.
 */
export interface ProtocolRuleEvaluationInput {
  relationships?: readonly ContractRelationship[];
  observations: readonly ApiObservation[];
  context?: ProtocolRuleContext;
}

/**
 * Helper to deduplicate limitations by code, message, and source URI.
 */
function mergeLimitations(limitationsList: (AnalysisWarning[] | undefined)[]): AnalysisWarning[] {
  const merged: AnalysisWarning[] = [];
  const seen = new Set<string>();

  for (const list of limitationsList) {
    if (!list) continue;
    for (const lim of list) {
      const key = `${lim.code}:${lim.message}:${lim.source?.uri ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(lim);
      }
    }
  }

  return merged;
}

/**
 * Evaluates UND120 (HTTP Method Conflict) for a candidate relationship.
 * Requires structurally matching known routes and two known, different HTTP methods.
 */
export function evaluateMethodConflictRule(
  rel: ContractRelationship,
  obsMap: Map<string, ApiObservation>
): Finding | undefined {
  if (rel.matchKind !== "method-conflict" || rel.state !== "matched") {
    return undefined;
  }

  if (!rel.consumerId || !rel.providerId) {
    return undefined;
  }

  const consumer = obsMap.get(rel.consumerId);
  const provider = obsMap.get(rel.providerId);
  if (!consumer || !provider) {
    return undefined;
  }

  const cMethod = getKnownMethod(consumer);
  const pMethod = getKnownMethod(provider);
  const cRoute = getKnownRoute(consumer);
  const pRoute = getKnownRoute(provider);

  // Both methods must be known, supported, and different
  if (!cMethod || !pMethod || cMethod === pMethod) {
    return undefined;
  }

  // Both routes must be known and structurally matching
  if (!cRoute || !pRoute || !areRouteShapesEqual(cRoute, pRoute)) {
    return undefined;
  }

  const sourceLocations = [...(consumer.source ?? []), ...(provider.source ?? [])];
  const limitations = mergeLimitations([
    rel.limitations,
    consumer.limitations,
    provider.limitations
  ]);

  const id = createFindingId({
    ruleId: "UND120",
    method: cMethod,
    route: cRoute,
    consumerId: consumer.id,
    providerId: provider.id,
    observationIds: [consumer.id, provider.id],
    scopeUri: consumer.source[0]?.uri
  });

  const structuredExplanation = explainFinding({
    ruleId: "UND120",
    title: "HTTP method conflict",
    expectedDescription: cMethod,
    observedDescription: pMethod,
    route: formatRoutePattern(cRoute),
    evidenceStrength: "direct",
    sourceLocations,
    limitations
  });

  return {
    id,
    ruleId: "UND120",
    category: "route",
    severity: "error",
    state: "active",
    title: "HTTP method conflict",
    summary: structuredExplanation.summary,
    explanation: formatExplanationText(structuredExplanation),
    evidenceStrength: "direct",
    relationshipId: rel.id,
    observationIds: [consumer.id, provider.id],
    sourceLocations,
    expected: cMethod,
    observed: pMethod,
    impactStatement: structuredExplanation.possibleImpact,
    limitations,
    fixProposalIds: [],
    structuredExplanation
  };
}

/**
 * Evaluates UND130 (Suspected Route Mismatch) for a candidate relationship.
 * Follows the strict 7-condition policy of LLD.md Section 10.4.
 */
export function evaluateSuspectedRouteMismatchRule(
  rel: ContractRelationship,
  obsMap: Map<string, ApiObservation>
): Finding | undefined {
  if (rel.matchKind !== "suspected-route-conflict" || rel.state !== "matched") {
    return undefined;
  }

  if (!rel.consumerId || !rel.providerId) {
    return undefined;
  }

  const consumer = obsMap.get(rel.consumerId);
  const provider = obsMap.get(rel.providerId);
  if (!consumer || !provider) {
    return undefined;
  }

  const cMethod = getKnownMethod(consumer);
  const pMethod = getKnownMethod(provider);
  const cRoute = getKnownRoute(consumer);
  const pRoute = getKnownRoute(provider);

  // Condition 1: Same known HTTP method
  if (!cMethod || !pMethod || cMethod !== pMethod) {
    return undefined;
  }

  // Condition 2: Both routes known and valid
  if (!cRoute || !pRoute) {
    return undefined;
  }

  // Verify high similarity threshold on the differing static segment before declaring UND130
  if (cRoute.segments.length === pRoute.segments.length) {
    for (let i = 0; i < cRoute.segments.length; i++) {
      const cSeg = cRoute.segments[i];
      const pSeg = pRoute.segments[i];
      if (cSeg.kind === "static" && pSeg.kind === "static" && cSeg.value !== pSeg.value) {
        if (!isSuspectedSegmentTypo(cSeg.value, pSeg.value, cRoute.segments.length === 1)) {
          return undefined;
        }
      }
    }
  }

  const sourceLocations = [...(consumer.source ?? []), ...(provider.source ?? [])];
  const limitations = mergeLimitations([
    rel.limitations,
    consumer.limitations,
    provider.limitations
  ]);

  const id = createFindingId({
    ruleId: "UND130",
    method: cMethod,
    route: cRoute,
    targetKey: formatRoutePattern(pRoute),
    consumerId: consumer.id,
    providerId: provider.id,
    observationIds: [consumer.id, provider.id],
    scopeUri: consumer.source[0]?.uri
  });

  const structuredExplanation = explainFinding({
    ruleId: "UND130",
    title: "Suspected route mismatch",
    method: cMethod,
    expectedDescription: formatRoutePattern(cRoute),
    observedDescription: formatRoutePattern(pRoute),
    evidenceStrength: "inferred",
    sourceLocations,
    limitations
  });

  return {
    id,
    ruleId: "UND130",
    category: "route",
    severity: "warning",
    state: "active",
    title: "Suspected route mismatch",
    summary: structuredExplanation.summary,
    explanation: formatExplanationText(structuredExplanation),
    evidenceStrength: "inferred",
    relationshipId: rel.id,
    observationIds: [consumer.id, provider.id],
    sourceLocations,
    expected: formatRoutePattern(cRoute),
    observed: formatRoutePattern(pRoute),
    impactStatement: structuredExplanation.possibleImpact,
    limitations,
    fixProposalIds: [],
    structuredExplanation
  };
}

/**
 * Evaluates UND100 (No compatible provider found / Missing Provider).
 * Requires known consumer method and route, sufficiently complete backend scope,
 * and no prior explanation by method conflict (UND120) or suspected route conflict (UND130).
 */
export function evaluateMissingProviderRule(
  rel: ContractRelationship,
  obsMap: Map<string, ApiObservation>,
  isBackendComplete: boolean,
  explainedConsumerIds: ReadonlySet<string>
): Finding | undefined {
  if (rel.matchKind !== "unmatched" || !rel.consumerId) {
    return undefined;
  }

  // Suppress duplicate UND100 if the consumer is already explained by UND120 or UND130
  if (explainedConsumerIds.has(rel.consumerId)) {
    return undefined;
  }

  // Coverage requirement: backend scan must be sufficiently complete
  if (!isBackendComplete) {
    return undefined;
  }

  const consumer = obsMap.get(rel.consumerId);
  if (!consumer) {
    return undefined;
  }

  // If consumer's own extraction had completeness-affecting limitations on route/method, do not assert missing provider
  if (
    consumer.limitations?.some(
      (lim) =>
        lim.affectsCompleteness &&
        (!lim.targetDimension ||
          lim.targetDimension === "route" ||
          lim.targetDimension === "method" ||
          lim.targetDimension === "all")
    )
  ) {
    return undefined;
  }

  const cMethod = getKnownMethod(consumer);
  if (!cMethod) {
    return undefined;
  }

  const cRoute = getKnownRoute(consumer);
  if (!cRoute) {
    return undefined;
  }

  // Do not treat dynamic or unresolved routes as known missing endpoints
  if (cRoute.segments.some((seg) => seg.kind === "unresolved")) {
    return undefined;
  }

  const sourceLocations = consumer.source ?? [];
  const limitations = mergeLimitations([rel.limitations, consumer.limitations]);

  const id = createFindingId({
    ruleId: "UND100",
    method: cMethod,
    route: cRoute,
    consumerId: consumer.id,
    observationIds: [consumer.id],
    scopeUri: consumer.source[0]?.uri
  });

  const summary = `No compatible provider found in the analyzed scope for ${cMethod} ${formatRoutePattern(cRoute)}`;
  const structuredExplanation = explainFinding({
    ruleId: "UND100",
    title: "No compatible provider found",
    summary,
    method: cMethod,
    route: formatRoutePattern(cRoute),
    evidenceStrength: "direct",
    sourceLocations,
    limitations
  });

  return {
    id,
    ruleId: "UND100",
    category: "existence",
    severity: "warning",
    state: "active",
    title: "No compatible provider found",
    summary,
    explanation: formatExplanationText(structuredExplanation),
    evidenceStrength: "direct",
    relationshipId: rel.id,
    observationIds: [consumer.id],
    sourceLocations,
    expected: `${cMethod} ${formatRoutePattern(cRoute)}`,
    observed: undefined,
    impactStatement: structuredExplanation.possibleImpact,
    limitations,
    fixProposalIds: [],
    structuredExplanation
  };
}

/**
 * Evaluates UND110 (Provider with no known consumer).
 * Requires known provider method and route, sufficiently complete consumer scope,
 * and confirms that the provider is unmatched in the analyzed scope.
 */
export function evaluateNoKnownConsumerRule(
  rel: ContractRelationship,
  obsMap: Map<string, ApiObservation>,
  isConsumerComplete: boolean,
  matchedProviderIds: ReadonlySet<string>
): Finding | undefined {
  if (rel.matchKind !== "unmatched" || !rel.providerId) {
    return undefined;
  }

  if (matchedProviderIds.has(rel.providerId)) {
    return undefined;
  }

  // Coverage requirement: consumer scan must be sufficiently complete
  if (!isConsumerComplete) {
    return undefined;
  }

  const provider = obsMap.get(rel.providerId);
  if (!provider) {
    return undefined;
  }

  // If provider's own extraction had completeness-affecting limitations on route/method, do not assert orphaned status
  if (
    provider.limitations?.some(
      (lim) =>
        lim.affectsCompleteness &&
        (!lim.targetDimension ||
          lim.targetDimension === "route" ||
          lim.targetDimension === "method" ||
          lim.targetDimension === "all")
    )
  ) {
    return undefined;
  }

  const pMethod = getKnownMethod(provider);
  if (!pMethod) {
    return undefined;
  }

  const pRoute = getKnownRoute(provider);
  if (!pRoute) {
    return undefined;
  }

  // Do not treat dynamic or unresolved routes as known endpoints
  if (pRoute.segments.some((seg) => seg.kind === "unresolved")) {
    return undefined;
  }

  const sourceLocations = provider.source ?? [];
  const limitations = mergeLimitations([rel.limitations, provider.limitations]);

  const id = createFindingId({
    ruleId: "UND110",
    method: pMethod,
    route: pRoute,
    providerId: provider.id,
    observationIds: [provider.id],
    scopeUri: provider.source[0]?.uri
  });

  const summary = `No known consumer found in the analyzed scope for ${pMethod} ${formatRoutePattern(pRoute)}`;
  const structuredExplanation = explainFinding({
    ruleId: "UND110",
    title: "Provider has no known consumer",
    summary,
    method: pMethod,
    route: formatRoutePattern(pRoute),
    evidenceStrength: "direct",
    sourceLocations,
    limitations
  });

  return {
    id,
    ruleId: "UND110",
    category: "existence",
    severity: "info",
    state: "active",
    title: "Provider has no known consumer",
    summary,
    explanation: formatExplanationText(structuredExplanation),
    evidenceStrength: "direct",
    relationshipId: rel.id,
    observationIds: [provider.id],
    sourceLocations,
    expected: undefined,
    observed: `${pMethod} ${formatRoutePattern(pRoute)}`,
    impactStatement: structuredExplanation.possibleImpact,
    limitations,
    fixProposalIds: [],
    structuredExplanation
  };
}

/**
 * Evaluates protocol drift rules (UND100, UND110, UND120, UND130) across candidate relationships
 * and observations, returning deterministically sorted and deduplicated findings.
 */
export function evaluateProtocolRules(input: ProtocolRuleEvaluationInput): Finding[];
export function evaluateProtocolRules(
  relationships: readonly ContractRelationship[],
  observations: readonly ApiObservation[],
  context?: ProtocolRuleContext
): Finding[];
export function evaluateProtocolRules(
  inputOrRelationships: ProtocolRuleEvaluationInput | readonly ContractRelationship[],
  maybeObservations?: readonly ApiObservation[],
  maybeContext?: ProtocolRuleContext
): Finding[] {
  let relationships: readonly ContractRelationship[];
  let observations: readonly ApiObservation[];
  let context: ProtocolRuleContext | undefined;

  if ("observations" in inputOrRelationships) {
    observations = inputOrRelationships.observations ?? [];
    relationships =
      inputOrRelationships.relationships ??
      (observations.length > 0 ? matchCandidates(observations) : []);
    context = inputOrRelationships.context;
  } else {
    relationships = inputOrRelationships;
    observations = maybeObservations ?? [];
    context = maybeContext;
  }

  if (observations.length === 0 && relationships.length === 0) {
    return [];
  }

  const sortedRelationships = [...relationships].sort((a, b) => a.id.localeCompare(b.id));

  const obsMap = new Map<string, ApiObservation>();
  for (const obs of observations) {
    obsMap.set(obs.id, obs);
  }

  const isBackendComplete = resolveScopeCompleteness(
    context?.backendScanComplete,
    context?.coverage?.backendComplete ?? context?.coverage?.complete
  );

  const isConsumerComplete = resolveScopeCompleteness(
    context?.consumerScanComplete,
    context?.coverage?.consumerComplete ?? context?.coverage?.complete
  );

  // Track explained consumers and matched providers to guarantee LLD suppression rules
  const explainedConsumerIds = new Set<string>();
  const matchedProviderIds = new Set<string>();

  for (const rel of sortedRelationships) {
    if (
      rel.matchKind === "exact" ||
      rel.matchKind === "method-conflict" ||
      rel.matchKind === "suspected-route-conflict" ||
      rel.matchKind === "ambiguous"
    ) {
      if (rel.consumerId) {
        explainedConsumerIds.add(rel.consumerId);
      }
      if (rel.providerId) {
        matchedProviderIds.add(rel.providerId);
      }
    }
  }

  const findings: Finding[] = [];
  const seenIds = new Set<string>();

  const addFinding = (f: Finding | undefined) => {
    if (f && !seenIds.has(f.id)) {
      seenIds.add(f.id);
      findings.push(f);
    }
  };

  // 1. Evaluate UND120 (Method Conflict)
  for (const rel of sortedRelationships) {
    if (rel.matchKind === "method-conflict") {
      addFinding(evaluateMethodConflictRule(rel, obsMap));
    }
  }

  // 2. Evaluate UND130 (Suspected Route Mismatch)
  for (const rel of sortedRelationships) {
    if (rel.matchKind === "suspected-route-conflict") {
      addFinding(evaluateSuspectedRouteMismatchRule(rel, obsMap));
    }
  }

  // 3. Evaluate UND100 (Missing Provider)
  for (const rel of sortedRelationships) {
    if (rel.matchKind === "unmatched" && rel.consumerId) {
      addFinding(evaluateMissingProviderRule(rel, obsMap, isBackendComplete, explainedConsumerIds));
    }
  }

  // 4. Evaluate UND110 (Provider with no known consumer)
  for (const rel of sortedRelationships) {
    if (rel.matchKind === "unmatched" && rel.providerId) {
      addFinding(evaluateNoKnownConsumerRule(rel, obsMap, isConsumerComplete, matchedProviderIds));
    }
  }

  // Sort findings deterministically by ID
  return findings.sort((a, b) => a.id.localeCompare(b.id));
}
