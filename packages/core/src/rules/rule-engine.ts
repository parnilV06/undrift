// Rule evaluation engine coordinating drift rules and limitation rules
// as specified in LLD.md Section 11 and Section 19.

import type { AnalysisWarning, Finding } from "../domain/finding";
import type { ApiObservation } from "../domain/observation";
import type { ContractRelationship } from "../domain/relationship";
import type { AnalysisCoverageSummary } from "../domain/types";
import { matchCandidates } from "../matching/contract-matcher";
import type { LimitationWarningContext } from "./limitation-rules";
import { evaluateLimitationRules } from "./limitation-rules";
import type { ProtocolRuleContext } from "./protocol-rules";
import { evaluateProtocolRules } from "./protocol-rules";
import type { ShapeComparatorOptions } from "../comparison/shape-comparator";
import { evaluateShapeRules } from "./shape-rules";

/**
 * Input parameters for complete rule evaluation across observations, relationships, and warnings.
 */
export interface RuleEngineEvaluationInput {
  observations: readonly ApiObservation[];
  relationships?: readonly ContractRelationship[];
  warnings?: readonly AnalysisWarning[];
  coverage?: AnalysisCoverageSummary;
  backendScanComplete?: boolean;
  consumerScanComplete?: boolean;
  shapeOptions?: ShapeComparatorOptions;
}

/**
 * Lightweight, deterministic rule evaluation engine coordinating protocol drift
 * rules and analysis limitation rules.
 */
export class RuleEngine {
  /**
   * Evaluates all active drift rules and limitation rules on the provided inputs.
   * Execution is fully deterministic and independent of input array ordering.
   *
   * @param input Observations, optional pre-computed relationships, warnings, and coverage flags.
   * @returns Deterministically sorted, deduplicated findings.
   */
  public evaluate(input: RuleEngineEvaluationInput): Finding[] {
    const { observations, warnings = [] } = input;
    const relationships =
      input.relationships ?? (observations.length > 0 ? matchCandidates(observations) : []);

    // 1. Evaluate protocol drift rules (UND100, UND110, UND120, UND130)
    const protocolContext: ProtocolRuleContext = {
      coverage: input.coverage,
      backendScanComplete: input.backendScanComplete,
      consumerScanComplete: input.consumerScanComplete
    };

    const protocolFindings = evaluateProtocolRules({
      relationships,
      observations,
      context: protocolContext
    });

    // 2. Evaluate limitation rules (UND900, UND910, UND920)
    const limitationContexts: LimitationWarningContext[] = [];

    // Global warnings
    for (const w of warnings) {
      limitationContexts.push({ warning: w });
    }

    // Observation-level limitations
    for (const obs of observations) {
      if (obs.limitations) {
        for (const w of obs.limitations) {
          limitationContexts.push({
            warning: w,
            observationId: obs.id,
            uri: obs.source[0]?.uri
          });
        }
      }
    }

    // Relationship-level limitations
    for (const rel of relationships) {
      if (rel.limitations) {
        for (const w of rel.limitations) {
          limitationContexts.push({
            warning: w,
            relationshipId: rel.id,
            observationId: rel.consumerId ?? rel.providerId
          });
        }
      }
    }

    const limitationFindings = evaluateLimitationRules(limitationContexts);

    // 3. Evaluate directional shape drift rules (UND200–UND220, UND300–UND330)
    const shapeFindings = evaluateShapeRules({
      relationships,
      observations,
      options: input.shapeOptions
    });

    // 4. Deduplicate by FindingId and sort deterministically
    const seenIds = new Set<string>();
    const allFindings: Finding[] = [];

    for (const f of [...protocolFindings, ...shapeFindings, ...limitationFindings]) {
      if (!seenIds.has(f.id)) {
        seenIds.add(f.id);
        allFindings.push(f);
      }
    }

    return allFindings.sort((a, b) => a.id.localeCompare(b.id));
  }
}

/**
 * Standalone convenience function invoking the RuleEngine.
 */
export function evaluateRules(input: RuleEngineEvaluationInput): Finding[] {
  const engine = new RuleEngine();
  return engine.evaluate(input);
}
