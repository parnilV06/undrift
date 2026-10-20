// Projection and canonicalization helper for integration golden test artifacts.
// Normalizes machine-dependent paths, timestamps, durations, and URIs into
// stable, deterministic projections adhering to LLD.md Section 19.7.

import type {
  AnalysisResult,
  AnalysisWarning,
  EvidenceRef,
  Finding,
  ObservedValue,
  SourceSpan,
  TypeShape
} from "../../packages/core/src/index";

/**
 * Normalizes absolute fixture workspace URIs to fixture-relative file paths.
 */
export function normalizeUri(uri: string, baseUri = "file:///workspace"): string {
  if (uri.startsWith(baseUri + "/")) {
    return uri.slice(baseUri.length + 1);
  }
  if (uri.startsWith(baseUri)) {
    return uri.slice(baseUri.length);
  }
  return uri;
}

/**
 * Normalizes source span URIs while strictly preserving line and character offsets.
 */
export function normalizeSpan(span: SourceSpan, baseUri = "file:///workspace"): SourceSpan {
  return {
    uri: normalizeUri(span.uri, baseUri),
    range: { start: span.range.start, end: span.range.end },
    start: { line: span.start.line, character: span.start.character },
    end: { line: span.end.line, character: span.end.character },
    byteRange: span.byteRange ? { start: span.byteRange.start, end: span.byteRange.end } : undefined
  };
}

/**
 * Recursively normalizes type shapes, ensuring embedded evidence source spans have normalized URIs.
 */
export function normalizeTypeShape(shape: TypeShape, baseUri = "file:///workspace"): TypeShape {
  if (shape.kind === "object") {
    return {
      ...shape,
      properties: shape.properties.map((p) => ({
        ...p,
        type: normalizeTypeShape(p.type, baseUri),
        evidence: p.evidence
          ? p.evidence.map((ev) => ({
              ...ev,
              source: normalizeSpan(ev.source, baseUri)
            }))
          : undefined
      }))
    };
  }
  if (shape.kind === "array") {
    return {
      ...shape,
      element: normalizeTypeShape(shape.element, baseUri)
    };
  }
  if (shape.kind === "union") {
    return {
      ...shape,
      members: shape.members.map((m) => normalizeTypeShape(m, baseUri))
    };
  }
  return shape;
}

/**
 * Normalizes warning source spans and strips machine-specific URI prefixes from warning messages.
 */
export function normalizeWarning(
  warning: AnalysisWarning,
  baseUri = "file:///workspace"
): AnalysisWarning {
  return {
    code: warning.code,
    message: warning.message.replace(new RegExp(baseUri + "/", "g"), ""),
    source: warning.source ? normalizeSpan(warning.source, baseUri) : undefined,
    analyzerId: warning.analyzerId,
    affectsCompleteness: warning.affectsCompleteness
  };
}

/**
 * Normalizes observation IDs containing workspace URIs into fixture-relative IDs.
 */
export function normalizeObsId(id: string, baseUri = "file:///workspace"): string {
  return id.replace(new RegExp(baseUri + "/", "g"), "");
}

/**
 * Normalizes relationship IDs containing workspace URIs into fixture-relative IDs.
 */
export function normalizeRelId(id: string, baseUri = "file:///workspace"): string {
  return id.replace(new RegExp(baseUri + "/", "g"), "");
}

export function normalizeObservedValue<T>(
  obsVal: ObservedValue<T> | undefined,
  baseUri = "file:///workspace"
): ObservedValue<T> | undefined {
  if (!obsVal) return obsVal;
  return {
    ...obsVal,
    evidence: Array.isArray(obsVal.evidence)
      ? obsVal.evidence.map((ev: EvidenceRef) => ({
          ...ev,
          source: normalizeSpan(ev.source, baseUri)
        }))
      : []
  };
}

/**
 * Projects an AnalysisResult into a stable, deterministic JSON structure suitable for golden comparisons.
 * Replaces nondeterministic timestamps and execution durations with stable placeholders.
 */
export function projectAnalysisResultForGolden(
  result: AnalysisResult,
  baseUri = "file:///workspace"
): Record<string, unknown> {
  return {
    workspaceId: result.workspaceId,
    generation: result.generation,
    generatedAt: "<TIMESTAMP>",
    complete: result.complete,
    statistics: {
      filesConsidered: result.statistics.filesConsidered,
      filesParsed: result.statistics.filesParsed,
      filesWithWarnings: result.statistics.filesWithWarnings,
      consumerObservations: result.statistics.consumerObservations,
      providerObservations: result.statistics.providerObservations,
      relationships: result.statistics.relationships,
      activeFindings: result.statistics.activeFindings,
      unresolvedPatterns: result.statistics.unresolvedPatterns,
      durationMs: "<DURATION>"
    },
    observations: result.observations.map((obs) => ({
      id: normalizeObsId(obs.id, baseUri),
      role: obs.role,
      languageId: obs.languageId,
      framework: obs.framework,
      extractorId: obs.extractorId,
      endpoint: {
        method: normalizeObservedValue(obs.endpoint.method, baseUri),
        path: normalizeObservedValue(obs.endpoint.path, baseUri),
        request: obs.endpoint.request
          ? {
              ...obs.endpoint.request,
              body: obs.endpoint.request.body
                ? {
                    ...obs.endpoint.request.body,
                    shape: normalizeTypeShape(obs.endpoint.request.body.shape, baseUri),
                    evidence: obs.endpoint.request.body.evidence.map((ev) => ({
                      ...ev,
                      source: normalizeSpan(ev.source, baseUri)
                    }))
                  }
                : undefined,
              pathParams: obs.endpoint.request.pathParams
                ? {
                    ...obs.endpoint.request.pathParams,
                    shape: normalizeTypeShape(obs.endpoint.request.pathParams.shape, baseUri),
                    evidence: obs.endpoint.request.pathParams.evidence.map((ev) => ({
                      ...ev,
                      source: normalizeSpan(ev.source, baseUri)
                    }))
                  }
                : undefined
            }
          : undefined,
        responses: obs.endpoint.responses?.map((resp) => ({
          ...resp,
          source: resp.source.map((s) => normalizeSpan(s, baseUri)),
          statusCode: normalizeObservedValue(resp.statusCode, baseUri),
          body: resp.body
            ? {
                ...resp.body,
                shape: normalizeTypeShape(resp.body.shape, baseUri),
                evidence: resp.body.evidence.map((ev) => ({
                  ...ev,
                  source: normalizeSpan(ev.source, baseUri)
                }))
              }
            : undefined
        }))
      },
      source: obs.source.map((s) => normalizeSpan(s, baseUri)),
      snapshot: {
        uri: normalizeUri(obs.snapshot.uri, baseUri),
        contentHash: obs.snapshot.contentHash
      },
      limitations: obs.limitations.map((l) => normalizeWarning(l, baseUri))
    })),
    relationships: result.relationships.map((rel) => ({
      id: normalizeRelId(rel.id, baseUri),
      consumerObservationId: rel.consumerObservationId
        ? normalizeObsId(rel.consumerObservationId, baseUri)
        : undefined,
      providerObservationId: rel.providerObservationId
        ? normalizeObsId(rel.providerObservationId, baseUri)
        : undefined,
      state: rel.state,
      matchKind: rel.matchKind,
      evidence: rel.evidence.map((ev) => ({
        ...ev,
        source: normalizeSpan(ev.source, baseUri)
      })),
      reasons: rel.reasons.map((r) => r.replace(new RegExp(baseUri + "/", "g"), "")),
      limitations: rel.limitations.map((l) => normalizeWarning(l, baseUri)),
      findingIds: rel.findingIds
    })),
    findings: result.findings.map((finding) => ({
      id: finding.id,
      ruleId: finding.ruleId,
      category: finding.category,
      severity: finding.severity,
      state: finding.state,
      title: finding.title,
      summary: finding.summary,
      explanation: finding.explanation,
      evidenceStrength: finding.evidenceStrength,
      relationshipId: finding.relationshipId
        ? normalizeRelId(finding.relationshipId, baseUri)
        : undefined,
      observationIds: finding.observationIds.map((id) => normalizeObsId(id, baseUri)),
      sourceLocations: finding.sourceLocations.map((s) => normalizeSpan(s, baseUri)),
      expected: finding.expected,
      observed: finding.observed,
      limitations: finding.limitations.map((l) => normalizeWarning(l, baseUri)),
      fixProposalIds: finding.fixProposalIds,
      structuredExplanation: finding.structuredExplanation
        ? {
            headline: finding.structuredExplanation.headline,
            summary: finding.structuredExplanation.summary,
            expectedDescription: finding.structuredExplanation.expectedDescription,
            observedDescription: finding.structuredExplanation.observedDescription,
            reason: finding.structuredExplanation.reason,
            possibleImpact: finding.structuredExplanation.possibleImpact,
            evidenceStrength: finding.structuredExplanation.evidenceStrength,
            sourceLocations: finding.structuredExplanation.sourceLocations.map((s) =>
              normalizeSpan(s, baseUri)
            ),
            limitations: finding.structuredExplanation.limitations.map((l) =>
              normalizeWarning(l, baseUri)
            ),
            suggestedNextSteps: finding.structuredExplanation.suggestedNextSteps
          }
        : undefined
    })),
    warnings: result.warnings.map((w) => normalizeWarning(w, baseUri))
  };
}
