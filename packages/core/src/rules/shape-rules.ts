// Directional shape drift rules for UND200–UND220 and UND300–UND330
// as specified in LLD.md Section 11.1, 11.2, 11.3, and 11.4.

import type { ShapeComparatorOptions, ShapeDifference } from "../comparison/shape-comparator";
import { compareShapes } from "../comparison/shape-comparator";
import type { AnalysisWarning, Finding, FindingCategory, FindingSeverity } from "../domain/finding";
import { createFindingId } from "../domain/finding";
import type { ApiObservation, ResponseShapeObservation } from "../domain/observation";
import type { ContractRelationship } from "../domain/relationship";
import type { RuleId } from "../domain/types";
import { explainFinding, formatExplanationText } from "../explaining/finding-explainer";
import { getKnownMethod, getKnownRoute, matchCandidates } from "../matching/contract-matcher";
import { formatRoutePattern } from "../normalization/route-normalizer";

/**
 * Supported directional request and response shape drift rule identifiers
 * defined in LLD.md Section 11.1.
 */
export const SHAPE_RULE_IDS = {
  UND200: "UND200",
  UND210: "UND210",
  UND220: "UND220",
  UND300: "UND300",
  UND310: "UND310",
  UND320: "UND320",
  UND330: "UND330"
} as const;

export type ShapeRuleId = (typeof SHAPE_RULE_IDS)[keyof typeof SHAPE_RULE_IDS];

/**
 * Input parameters for shape drift rule evaluation.
 */
export interface ShapeRuleEvaluationInput {
  relationships?: readonly ContractRelationship[];
  observations: readonly ApiObservation[];
  options?: ShapeComparatorOptions;
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
 * Evaluates request shape differences between an observed consumer and provider.
 */
function evaluateRequestDifferences(
  consumer: ApiObservation,
  provider: ApiObservation,
  options?: ShapeComparatorOptions
): ShapeDifference[] {
  const cReq = consumer.endpoint.request;
  const pReq = provider.endpoint.request;

  if (!pReq) {
    return [];
  }

  const diffs: ShapeDifference[] = [];

  // 1. Request body comparison
  if (pReq.body) {
    if (cReq?.body) {
      const bodyDiffs = compareShapes(cReq.body, pReq.body, "request", options);
      diffs.push(...bodyDiffs);
    } else if (cReq && (cReq.pathParams || cReq.queryParams || cReq.headers)) {
      // Consumer has request information but no body: if provider requires fields, compare against empty complete body
      const emptyCompleteBody = {
        shape: {
          kind: "object" as const,
          properties: [],
          additionalProperties: "unknown" as const
        },
        completeness: "complete" as const,
        evidence: []
      };
      const bodyDiffs = compareShapes(emptyCompleteBody, pReq.body, "request", options);
      diffs.push(...bodyDiffs);
    }
  }

  // 2. Query parameters comparison (if both or provider defines required query parameters)
  if (pReq.queryParams) {
    if (cReq?.queryParams) {
      const qDiffs = compareShapes(cReq.queryParams, pReq.queryParams, "request", options);
      for (const d of qDiffs) {
        diffs.push({
          ...d,
          path: d.path ? `query.${d.path}` : "query"
        });
      }
    }
  }

  return diffs;
}

/**
 * Matches consumer and provider response observations by status code or default success.
 */
function matchResponsePairs(
  cResponses: readonly ResponseShapeObservation[],
  pResponses: readonly ResponseShapeObservation[]
): Array<{ consumerResp: ResponseShapeObservation; providerResp: ResponseShapeObservation }> {
  const pairs: Array<{
    consumerResp: ResponseShapeObservation;
    providerResp: ResponseShapeObservation;
  }> = [];

  for (const cResp of cResponses) {
    const cStatus = cResp.statusCode?.state === "known" ? cResp.statusCode.value : undefined;

    // Find provider response with exact status code match, or default 200/success match
    let matchedProviderResp: ResponseShapeObservation | undefined;

    if (cStatus !== undefined) {
      matchedProviderResp = pResponses.find((p) => {
        const pStatus = p.statusCode?.state === "known" ? p.statusCode.value : undefined;
        return pStatus === cStatus;
      });
    }

    if (!matchedProviderResp) {
      // Match by default 200 or first provider response if status is unspecified or 200
      matchedProviderResp = pResponses.find((p) => {
        const pStatus = p.statusCode?.state === "known" ? p.statusCode.value : undefined;
        return pStatus === 200 || pStatus === undefined;
      });
    }

    if (matchedProviderResp) {
      pairs.push({ consumerResp: cResp, providerResp: matchedProviderResp });
    }
  }

  return pairs;
}

/**
 * Evaluates response shape differences between an observed provider and consumer.
 */
function evaluateResponseDifferences(
  consumer: ApiObservation,
  provider: ApiObservation,
  options?: ShapeComparatorOptions
): ShapeDifference[] {
  const cResponses = consumer.endpoint.responses ?? [];
  const pResponses = provider.endpoint.responses ?? [];

  if (cResponses.length === 0 || pResponses.length === 0) {
    return [];
  }

  const pairs = matchResponsePairs(cResponses, pResponses);
  const diffs: ShapeDifference[] = [];

  for (const { consumerResp, providerResp } of pairs) {
    if (providerResp.body && consumerResp.body) {
      const bodyDiffs = compareShapes(providerResp.body, consumerResp.body, "response", options);
      diffs.push(...bodyDiffs);
    } else if (!providerResp.body && consumerResp.body) {
      // Provider produced no body; if provider response is complete, consumer expected fields are missing
      const emptyCompleteBody = {
        shape: {
          kind: "object" as const,
          properties: [],
          additionalProperties: "unknown" as const
        },
        completeness: "complete" as const,
        evidence: []
      };
      const bodyDiffs = compareShapes(emptyCompleteBody, consumerResp.body, "response", options);
      diffs.push(...bodyDiffs);
    }
  }

  return diffs;
}

interface RuleMetadata {
  ruleId: RuleId;
  title: string;
  category: FindingCategory;
  severity: FindingSeverity;
}

/**
 * Maps a structural difference to its canonical rule metadata per LLD.md Section 11.1.
 */
function mapDifferenceToRule(diff: ShapeDifference): RuleMetadata | undefined {
  if (diff.direction === "request") {
    switch (diff.kind) {
      case "missing-field":
        return {
          ruleId: "UND200",
          title: "Required request field not supplied/observed",
          category: "request-shape",
          severity: "error"
        };
      case "type-mismatch":
        return {
          ruleId: "UND210",
          title: "Request field type mismatch",
          category: "request-shape",
          severity: "error"
        };
      case "optionality-conflict":
      case "nullability-conflict":
        return {
          ruleId: "UND220",
          title: "Request nullability/optionality conflict",
          category: "request-shape",
          severity: "warning"
        };
      case "forbidden-extra-field":
        // LLD Section 11.1 does not define an extra-field drift rule in the canonical catalog
        return undefined;
    }
  } else {
    switch (diff.kind) {
      case "missing-field":
        return {
          ruleId: "UND300",
          title: "Provider response lacks expected field",
          category: "response-shape",
          severity: "error"
        };
      case "type-mismatch":
        return {
          ruleId: "UND310",
          title: "Response field type mismatch",
          category: "response-shape",
          severity: "error"
        };
      case "optionality-conflict":
        return {
          ruleId: "UND320",
          title: "Response optionality conflict",
          category: "response-shape",
          severity: "warning"
        };
      case "nullability-conflict":
        return {
          ruleId: "UND330",
          title: "Response nullability conflict",
          category: "response-shape",
          severity: "warning"
        };
      case "forbidden-extra-field":
        return undefined;
    }
  }
}

/**
 * Evaluates directional request and response shape drift rules (UND200–UND220, UND300–UND330)
 * across matched contract relationships and observations.
 *
 * Runs strictly on matched relationships ("exact" matchKind and "matched" state).
 * Deduplicates and sorts findings deterministically by FindingId.
 */
export function evaluateShapeRules(input: ShapeRuleEvaluationInput): Finding[] {
  const { observations, options } = input;
  const relationships =
    input.relationships ?? (observations.length > 0 ? matchCandidates(observations) : []);

  if (observations.length === 0 || relationships.length === 0) {
    return [];
  }

  const obsMap = new Map<string, ApiObservation>();
  for (const obs of observations) {
    obsMap.set(obs.id, obs);
  }

  // Filter only eligible matched relationships with exact route & method match
  const eligibleRels = [...relationships]
    .filter((rel) => rel.state === "matched" && rel.matchKind === "exact")
    .sort((a, b) => a.id.localeCompare(b.id));

  const findings: Finding[] = [];
  const seenIds = new Set<string>();

  for (const rel of eligibleRels) {
    if (!rel.consumerId || !rel.providerId) {
      continue;
    }

    const consumer = obsMap.get(rel.consumerId);
    const provider = obsMap.get(rel.providerId);
    if (!consumer || !provider) {
      continue;
    }

    const cMethod = getKnownMethod(consumer);
    const cRoute = getKnownRoute(consumer);
    if (!cMethod || !cRoute) {
      continue;
    }

    const sourceLocations = [...(consumer.source ?? []), ...(provider.source ?? [])];
    const limitations = mergeLimitations([
      rel.limitations,
      consumer.limitations,
      provider.limitations
    ]);

    // 1. Evaluate request differences (consumer -> provider)
    const requestDiffs = evaluateRequestDifferences(consumer, provider, options);

    // 2. Evaluate response differences (provider -> consumer)
    const responseDiffs = evaluateResponseDifferences(consumer, provider, options);

    const allDiffs = [...requestDiffs, ...responseDiffs];

    for (const diff of allDiffs) {
      const meta = mapDifferenceToRule(diff);
      if (!meta) {
        continue;
      }

      const id = createFindingId({
        ruleId: meta.ruleId,
        method: cMethod,
        route: cRoute,
        targetKey: diff.path,
        consumerId: consumer.id,
        providerId: provider.id,
        observationIds: [consumer.id, provider.id],
        scopeUri: consumer.source[0]?.uri
      });

      if (seenIds.has(id)) {
        continue;
      }
      seenIds.add(id);

      const structuredExplanation = explainFinding({
        ruleId: meta.ruleId,
        title: meta.title,
        method: cMethod,
        route: formatRoutePattern(cRoute),
        targetKey: diff.path,
        expectedDescription: diff.expectedDescription,
        observedDescription: diff.observedDescription,
        evidenceStrength: "direct",
        sourceLocations,
        limitations
      });

      findings.push({
        id,
        ruleId: meta.ruleId,
        category: meta.category,
        severity: meta.severity,
        state: "active",
        title: meta.title,
        summary: structuredExplanation.summary,
        explanation: formatExplanationText(structuredExplanation),
        evidenceStrength: "direct",
        relationshipId: rel.id,
        observationIds: [consumer.id, provider.id],
        sourceLocations,
        expected: diff.expectedDescription,
        observed: diff.observedDescription === "missing" ? undefined : diff.observedDescription,
        impactStatement: structuredExplanation.possibleImpact,
        limitations,
        fixProposalIds: [],
        structuredExplanation
      });
    }
  }

  // Sort findings deterministically by ID
  return findings.sort((a, b) => a.id.localeCompare(b.id));
}
