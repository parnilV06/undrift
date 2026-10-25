// In-memory analysis engine orchestrating parsing, extraction, normalization,
// candidate matching, rule evaluation, and result assembly
// as specified in LLD.md Section 4.13, 5.4, 8.1–8.3, and ERD.md Section 6.1.

import type { SourceSpan } from "../domain/evidence";
import type { AnalysisWarning, Finding } from "../domain/finding";
import type { ApiObservation, RouteSegment, TypeShape } from "../domain/observation";
import type { ContractRelationship } from "../domain/relationship";
import type { AnalysisCoverageSummary, DocumentUri, SourceDocument } from "../domain/types";
import { ContractMatcher } from "../matching/contract-matcher";
import { normalizeHttpMethod } from "../normalization/method-normalizer";
import { normalizeRoute } from "../normalization/route-normalizer";
import { normalizeRequestShape, normalizeResponseShape } from "../normalization/shape-normalizer";
import type { AnalyzerInput, LanguageAnalyzerPort, ProjectIndexView } from "../ports/analyzer";
import type {
  AnalysisEngineDependencies,
  AnalysisEnginePort,
  AnalysisPipeline,
  AnalysisRequest,
  AnalysisResult,
  AnalysisStatistics
} from "../ports/engine";
import type { ParsedDocument, ParserPort } from "../ports/parser";
import { RuleEngine } from "../rules/rule-engine";

function inferDocumentScope(uri: DocumentUri): "consumer" | "provider" | "unknown" {
  const lower = uri.toLowerCase().replace(/\\/g, "/");
  if (
    lower.includes("/backend/") ||
    lower.includes("/server/") ||
    lower.includes("/controllers/") ||
    lower.includes("/routes/") ||
    lower.includes("/pages/api/") ||
    lower.includes("/app/api/") ||
    lower.includes("express")
  ) {
    return "provider";
  }
  if (
    lower.includes("/frontend/") ||
    lower.includes("/client/") ||
    lower.includes("/src/components/") ||
    lower.includes("/components/") ||
    lower.includes("/views/") ||
    lower.includes("/hooks/")
  ) {
    return "consumer";
  }
  return "unknown";
}

/**
 * Standard in-memory AnalysisEngine implementing the core analysis pipeline.
 * Coordinates syntax parsing, language analyzers, contract matching, and drift rules
 * without coupling to VS Code APIs, Tree-sitter objects, or the TypeScript compiler.
 */
export class AnalysisEngine implements AnalysisEnginePort, AnalysisPipeline {
  private readonly parsers: readonly ParserPort[];
  private readonly analyzers: readonly LanguageAnalyzerPort[];
  private readonly matcher: ContractMatcher;
  private readonly ruleEngine: RuleEngine;

  /**
   * Initializes the engine with optional injected ports and rule engine instances.
   */
  constructor(dependencies: AnalysisEngineDependencies = {}) {
    this.parsers = dependencies.parsers ?? [];
    this.analyzers = dependencies.analyzers ?? [];
    this.matcher = dependencies.matcher ?? new ContractMatcher();
    this.ruleEngine = dependencies.ruleEngine ?? new RuleEngine();
  }

  /**
   * Pipeline run entry point satisfying the AnalysisPipeline interface.
   */
  public async run(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisResult> {
    return this.analyze(request, signal);
  }

  /**
   * Primary analysis entry point satisfying the AnalysisEnginePort interface.
   */
  public async analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisResult> {
    const startTime = Date.now();

    // 1. Initial request validation and default fallbacks
    const documents = Array.isArray(request.documents) ? request.documents : [];
    const mode = request.mode === "scoped" ? "scoped" : "workspace";

    // 2. Cancellation check before starting any pipeline stage
    if (signal?.aborted) {
      return this.assembleCancelledResult(request, documents.length, startTime);
    }

    const allWarnings: AnalysisWarning[] = [];
    const extractedObservations: ApiObservation[] = [];
    const filesWithWarnings = new Set<DocumentUri>();

    let filesParsedCount = 0;
    let hasHardParseError = false;
    let hasAnalyzerFailure = false;
    let isCancelled = false;

    // Track scope-specific failures for conservative coverage gating
    let backendScopeHasFailures = false;
    let consumerScopeHasFailures = false;

    // 3. Build lightweight project index view from available document snapshots
    const docMap = new Map<DocumentUri, SourceDocument>();
    for (const doc of documents) {
      docMap.set(doc.uri, doc);
    }
    const parsedDocMap = new Map<DocumentUri, ParsedDocument>();
    const parsedEntries: Array<{ document: SourceDocument; parsed: ParsedDocument }> = [];

    const projectIndex: ProjectIndexView = {
      getDocument: (uri: DocumentUri) => docMap.get(uri),
      getParsedDocument: (uri: DocumentUri) => parsedDocMap.get(uri),
      getAllParsedDocuments: () => parsedEntries
    };

    // 4. Phase 1: Per-document parsing and diagnostic collection
    for (const doc of documents) {
      // Check cancellation at document boundary
      if (signal?.aborted) {
        isCancelled = true;
        break;
      }

      // Find an eligible parser for this document
      const parser = this.parsers.find((p) => p.supports(doc.languageId, doc.uri));
      if (!parser) {
        // Unparsed or unsupported document in workspace snapshot
        continue;
      }

      let parsedDoc: ParsedDocument | undefined;
      let docParseFailed = false;

      try {
        parsedDoc = await parser.parse({ document: doc }, signal);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const docScope = inferDocumentScope(doc.uri);
        allWarnings.push({
          code: "PARSE_ERROR",
          message: `Failed to parse document ${doc.uri}: ${message}`,
          source: this.createFallbackSpan(doc.uri),
          scope: docScope === "unknown" ? "workspace" : docScope,
          affectsCompleteness: true
        });
        filesWithWarnings.add(doc.uri);
        hasHardParseError = true;
        docParseFailed = true;
        if (docScope === "provider") {
          backendScopeHasFailures = true;
        } else if (docScope === "consumer") {
          consumerScopeHasFailures = true;
        } else {
          backendScopeHasFailures = true;
          consumerScopeHasFailures = true;
        }
      }

      if (parsedDoc) {
        // Process parser diagnostics and syntax issues
        if (Array.isArray(parsedDoc.issues)) {
          for (const issue of parsedDoc.issues) {
            const docScope = inferDocumentScope(doc.uri);
            allWarnings.push({
              code: "PARSE_ERROR",
              message: issue.message,
              source: issue.source ?? this.createFallbackSpan(doc.uri),
              scope: docScope === "unknown" ? "workspace" : docScope,
              affectsCompleteness: issue.isError
            });
            filesWithWarnings.add(doc.uri);
            if (issue.isError) {
              hasHardParseError = true;
              docParseFailed = true;
              if (docScope === "provider") {
                backendScopeHasFailures = true;
              } else if (docScope === "consumer") {
                consumerScopeHasFailures = true;
              } else {
                backendScopeHasFailures = true;
                consumerScopeHasFailures = true;
              }
            }
          }
        }

        if (!docParseFailed) {
          filesParsedCount++;
          parsedDocMap.set(doc.uri, parsedDoc);
          parsedEntries.push({ document: doc, parsed: parsedDoc });
        }
      }
    }

    // 5. Phase 2: Per-document analyzer extraction across parsed documents
    try {
      for (const { document: doc, parsed: parsedDoc } of parsedEntries) {
        if (signal?.aborted) {
          isCancelled = true;
          break;
        }

        // Find matching language analyzers
        const matchingAnalyzers = this.analyzers.filter((a) => a.supports(doc.languageId, doc.uri));

        for (const analyzer of matchingAnalyzers) {
          if (signal?.aborted) {
            isCancelled = true;
            break;
          }

          const analyzerInput: AnalyzerInput = {
            document: doc,
            parsed: parsedDoc,
            projectIndex,
            config: request.config
          };

          try {
            const output = await analyzer.analyze(analyzerInput, signal);
            if (output) {
              if (Array.isArray(output.observations)) {
                extractedObservations.push(...output.observations);
              }
              if (Array.isArray(output.warnings)) {
                for (const w of output.warnings) {
                  allWarnings.push(w);
                  filesWithWarnings.add(doc.uri);
                  if (w.affectsCompleteness) {
                    const affectsRouteOrScope =
                      !w.targetDimension ||
                      w.targetDimension === "route" ||
                      w.targetDimension === "method" ||
                      w.targetDimension === "all";
                    if (affectsRouteOrScope) {
                      if (w.scope === "provider") {
                        backendScopeHasFailures = true;
                      } else if (w.scope === "consumer") {
                        consumerScopeHasFailures = true;
                      } else if (w.scope === "workspace" || w.scope === "unknown") {
                        backendScopeHasFailures = true;
                        consumerScopeHasFailures = true;
                      } else {
                        // Fallback scope inference
                        if (
                          analyzer.id.includes("backend") ||
                          analyzer.id.includes("express") ||
                          w.message.toLowerCase().includes("backend") ||
                          w.message.toLowerCase().includes("provider")
                        ) {
                          backendScopeHasFailures = true;
                        } else if (
                          analyzer.id.includes("frontend") ||
                          analyzer.id.includes("fetch") ||
                          analyzer.id.includes("axios") ||
                          w.message.toLowerCase().includes("frontend") ||
                          w.message.toLowerCase().includes("consumer")
                        ) {
                          consumerScopeHasFailures = true;
                        } else {
                          backendScopeHasFailures = true;
                          consumerScopeHasFailures = true;
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            const docScope = inferDocumentScope(doc.uri);
            allWarnings.push({
              code: "ANALYZER_FAILURE",
              message: `Analyzer '${analyzer.id}' failed on document ${doc.uri}: ${message}`,
              source: this.createFallbackSpan(doc.uri),
              analyzerId: analyzer.id,
              scope: docScope === "unknown" ? "workspace" : docScope,
              affectsCompleteness: true
            });
            filesWithWarnings.add(doc.uri);
            hasAnalyzerFailure = true;

            if (
              docScope === "provider" ||
              analyzer.id.includes("backend") ||
              analyzer.id.includes("express")
            ) {
              backendScopeHasFailures = true;
            } else if (
              docScope === "consumer" ||
              analyzer.id.includes("frontend") ||
              analyzer.id.includes("fetch") ||
              analyzer.id.includes("axios")
            ) {
              consumerScopeHasFailures = true;
            } else {
              backendScopeHasFailures = true;
              consumerScopeHasFailures = true;
            }
          }
        }

        if (isCancelled) {
          break;
        }
      }
    } finally {
      // Dispose all parsed documents
      for (const parsed of parsedDocMap.values()) {
        try {
          parsed.dispose();
        } catch {
          // Resource disposal error suppressed
        }
      }
    }

    // Record cancellation warning if cancelled during processing
    if (isCancelled) {
      allWarnings.push({
        code: "INCOMPLETE_SCOPE",
        message: "Analysis was cancelled before completion.",
        scope: "workspace",
        affectsCompleteness: true
      });
    }

    // 5. Deduplicate extracted observations by ObservationId
    const observationMap = new Map<string, ApiObservation>();
    for (const obs of extractedObservations) {
      observationMap.set(obs.id, obs);
    }
    const combinedObservations = Array.from(observationMap.values());

    // 6. Normalize route patterns, HTTP methods, and shapes
    const normalizedObservations = combinedObservations.map((obs) =>
      this.normalizeObservation(obs)
    );

    // 7. Candidate relationship matching
    let relationships: ContractRelationship[] = [];
    if (!isCancelled && normalizedObservations.length > 0) {
      relationships = this.matcher.match(normalizedObservations);
    }

    // Check cancellation before rule evaluation
    if (signal?.aborted && !isCancelled) {
      isCancelled = true;
      allWarnings.push({
        code: "INCOMPLETE_SCOPE",
        message: "Analysis was cancelled before completion.",
        scope: "workspace",
        affectsCompleteness: true
      });
    }

    // 8. Coverage and completeness evaluation
    const hasCompletenessAffectingWarning = allWarnings.some(
      (w) =>
        w.affectsCompleteness &&
        (!w.targetDimension ||
          w.targetDimension === "route" ||
          w.targetDimension === "method" ||
          w.targetDimension === "all")
    );
    const hasIncompleteScopeWarning = allWarnings.some((w) => w.code === "INCOMPLETE_SCOPE");

    const isComplete =
      !isCancelled &&
      !hasHardParseError &&
      !hasAnalyzerFailure &&
      !hasCompletenessAffectingWarning &&
      !hasIncompleteScopeWarning &&
      mode !== "scoped";

    const backendScanComplete =
      !isCancelled &&
      mode !== "scoped" &&
      !backendScopeHasFailures &&
      !allWarnings.some(
        (w) =>
          w.affectsCompleteness &&
          (!w.targetDimension ||
            w.targetDimension === "route" ||
            w.targetDimension === "method" ||
            w.targetDimension === "all") &&
          (w.scope === "provider" ||
            w.scope === "workspace" ||
            (w.scope === undefined &&
              (w.analyzerId?.includes("backend") ||
                w.analyzerId?.includes("express") ||
                w.message.toLowerCase().includes("backend") ||
                w.message.toLowerCase().includes("provider"))))
      );

    const consumerScanComplete =
      !isCancelled &&
      mode !== "scoped" &&
      !consumerScopeHasFailures &&
      !allWarnings.some(
        (w) =>
          w.affectsCompleteness &&
          (!w.targetDimension ||
            w.targetDimension === "route" ||
            w.targetDimension === "method" ||
            w.targetDimension === "all") &&
          (w.scope === "consumer" ||
            w.scope === "workspace" ||
            (w.scope === undefined &&
              (w.analyzerId?.includes("frontend") ||
                w.analyzerId?.includes("fetch") ||
                w.analyzerId?.includes("axios") ||
                w.message.toLowerCase().includes("frontend") ||
                w.message.toLowerCase().includes("consumer"))))
      );

    const unresolvedPatternsCount = this.calculateUnresolvedPatterns(
      normalizedObservations,
      allWarnings
    );

    const coverage: AnalysisCoverageSummary = {
      complete: isComplete,
      backendComplete: backendScanComplete,
      consumerComplete: consumerScanComplete,
      filesScanned: documents.length,
      filesWithWarnings: filesWithWarnings.size,
      unresolvedPatterns: unresolvedPatternsCount,
      warnings: [...allWarnings]
    };

    // 9. Rule evaluation across protocol, shape, and limitation rules
    let findings: Finding[] = [];
    if (!isCancelled) {
      findings = this.ruleEngine.evaluate({
        observations: normalizedObservations,
        relationships,
        warnings: allWarnings,
        coverage,
        backendScanComplete,
        consumerScanComplete
      });
    }

    // 10. Assemble statistics strictly adhering to LLD.md Section 4.13
    const consumerCount = normalizedObservations.filter((o) => o.role === "consumer").length;
    const providerCount = normalizedObservations.filter((o) => o.role === "provider").length;
    const activeFindingsCount = findings.filter((f) => f.state === "active").length;

    const statistics: AnalysisStatistics = {
      filesConsidered: documents.length,
      filesParsed: filesParsedCount,
      filesWithWarnings: filesWithWarnings.size,
      consumerObservations: consumerCount,
      providerObservations: providerCount,
      relationships: relationships.length,
      activeFindings: activeFindingsCount,
      unresolvedPatterns: unresolvedPatternsCount,
      durationMs: Math.max(0, Date.now() - startTime)
    };

    // Return strictly documented AnalysisResult without undocumented fields
    return {
      workspaceId: request.workspaceId,
      generation: request.generation,
      generatedAt: Date.now(),
      complete: isComplete,
      observations: normalizedObservations,
      relationships,
      findings,
      warnings: allWarnings,
      statistics
    };
  }

  /**
   * Releases engine resources and disposes registered parsers.
   */
  public async dispose(): Promise<void> {
    for (const parser of this.parsers) {
      try {
        parser.dispose();
      } catch {
        // Resource disposal error suppressed
      }
    }
  }

  /**
   * Normalizes an individual ApiObservation using completed Chunk 3.1 & 3.2 normalizers.
   */
  private normalizeObservation(obs: ApiObservation): ApiObservation {
    let normMethodObs = obs.endpoint?.method;
    if (obs.endpoint?.method && obs.endpoint.method.state === "known") {
      const normMethod = normalizeHttpMethod(obs.endpoint.method.value);
      if (normMethod) {
        normMethodObs = {
          ...obs.endpoint.method,
          value: normMethod
        };
      }
    }

    let normPathObs = obs.endpoint?.path;
    if (obs.endpoint?.path && obs.endpoint.path.state === "known") {
      const rawPath: unknown = obs.endpoint.path.value;
      const pathString =
        typeof rawPath === "string"
          ? rawPath
          : rawPath && typeof rawPath === "object" && "rawPath" in rawPath
            ? (rawPath as { rawPath: unknown }).rawPath
            : undefined;

      if (typeof pathString === "string") {
        normPathObs = {
          ...obs.endpoint.path,
          value: normalizeRoute(pathString)
        };
      }
    }

    const normRequest = obs.endpoint?.request
      ? normalizeRequestShape(obs.endpoint.request)
      : undefined;

    const normResponses = obs.endpoint?.responses
      ? obs.endpoint.responses.map((resp) => normalizeResponseShape(resp))
      : undefined;

    return {
      ...obs,
      endpoint: {
        ...obs.endpoint,
        method: normMethodObs,
        path: normPathObs,
        request: normRequest ?? obs.endpoint.request,
        responses: normResponses ?? obs.endpoint.responses
      }
    };
  }

  /**
   * Calculates the number of unresolved, dynamic, or unsupported patterns across
   * observations and warnings.
   */
  private calculateUnresolvedPatterns(
    observations: readonly ApiObservation[],
    warnings: readonly AnalysisWarning[]
  ): number {
    let count = 0;

    // Count unresolved warnings
    for (const w of warnings) {
      if (
        w.code === "UNRESOLVED_REFERENCE" ||
        w.code === "UNSUPPORTED_PATTERN" ||
        w.code === "DYNAMIC_ROUTE"
      ) {
        count++;
      }
    }

    // Count unresolved route segments and unknown shapes
    for (const obs of observations) {
      if (obs.endpoint?.path && obs.endpoint.path.state === "known") {
        const segments: RouteSegment[] = obs.endpoint.path.value?.segments ?? [];
        for (const seg of segments) {
          if (seg.kind === "unresolved") {
            count++;
          }
        }
      } else if (
        obs.endpoint?.path &&
        (obs.endpoint.path.state === "dynamic" || obs.endpoint.path.state === "unknown")
      ) {
        count++;
      }

      if (obs.endpoint?.request?.body?.shape) {
        if (this.isUnknownShape(obs.endpoint.request.body.shape)) {
          count++;
        }
      }

      if (obs.endpoint?.responses) {
        for (const resp of obs.endpoint.responses) {
          if (resp.body?.shape && this.isUnknownShape(resp.body.shape)) {
            count++;
          }
        }
      }
    }

    return count;
  }

  /**
   * Helper determining if a TypeShape represents an unobserved or unknown pattern.
   */
  private isUnknownShape(shape: TypeShape): boolean {
    return shape.kind === "unknown" && shape.reason !== "not-observed";
  }

  /**
   * Creates a zero-width fallback SourceSpan for an included document.
   */
  private createFallbackSpan(uri: DocumentUri): SourceSpan {
    return {
      uri,
      range: { start: 0, end: 0 },
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 }
    };
  }

  /**
   * Assembles a structured AnalysisResult for a pre-aborted request adhering strictly to LLD §4.13.
   */
  private assembleCancelledResult(
    request: AnalysisRequest,
    filesConsidered: number,
    startTime: number
  ): AnalysisResult {
    const cancelWarning: AnalysisWarning = {
      code: "INCOMPLETE_SCOPE",
      message: "Analysis was cancelled before completion.",
      affectsCompleteness: true
    };

    return {
      workspaceId: request.workspaceId,
      generation: request.generation,
      generatedAt: Date.now(),
      complete: false,
      observations: [],
      relationships: [],
      findings: [],
      warnings: [cancelWarning],
      statistics: {
        filesConsidered,
        filesParsed: 0,
        filesWithWarnings: 0,
        consumerObservations: 0,
        providerObservations: 0,
        relationships: 0,
        activeFindings: 0,
        unresolvedPatterns: 0,
        durationMs: Math.max(0, Date.now() - startTime)
      }
    };
  }
}
