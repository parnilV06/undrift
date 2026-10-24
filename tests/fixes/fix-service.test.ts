// Phase 5, Chunk 5.3: FixProposalService Tests
// Verifies connection between accepted analysis state and core proposal generation,
// strict workspace and generation validation, and finding/document lookup.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisResult,
  ApiObservation,
  ContractRelationship,
  DocumentUri,
  Finding,
  FindingId,
  ObservationId,
  ObservationRole,
  RelationshipId,
  SourceDocument,
  SourceSpan,
  WorkspaceId
} from "@undrift/core";
import { normalizeRoute } from "@undrift/core";
import { FixProposalService } from "../../apps/vscode-extension/src/fixes/fix-service";
import type { AnalysisCoordinator } from "../../apps/vscode-extension/src/activation";

describe("FixProposalService (Chunk 5.3)", () => {
  const wsId: WorkspaceId = "file:///workspace/app" as WorkspaceId;
  const consumerUri: DocumentUri = "file:///workspace/app/src/consumer.ts" as DocumentUri;
  const providerUri: DocumentUri = "file:///workspace/app/src/provider.ts" as DocumentUri;

  const clientCode = 'fetch("/api/users", { method: "GET" });';
  const serverCode = 'app.post("/api/users", handler);';

  function createSourceDoc(uri: DocumentUri, text: string, version = 1): SourceDocument {
    return {
      uri,
      languageId: "typescript",
      text,
      contentHash: `hash-${uri}-${text.length}`,
      documentVersion: version
    };
  }

  function createSpan(
    uri: DocumentUri,
    range: { start: number; end: number },
    start: { line: number; character: number },
    end: { line: number; character: number }
  ): SourceSpan {
    return { uri, range, start, end };
  }

  function setupScenario(generation = 1) {
    const clientDoc = createSourceDoc(consumerUri, clientCode, 1);
    const serverDoc = createSourceDoc(providerUri, serverCode, 1);

    const clientMethodStart = clientCode.indexOf('"GET"');
    const clientMethodEnd = clientMethodStart + '"GET"'.length;

    const serverMethodStart = serverCode.indexOf("post");
    const serverMethodEnd = serverMethodStart + "post".length;

    const clientMethodSpan = createSpan(
      consumerUri,
      { start: clientMethodStart, end: clientMethodEnd },
      { line: 0, character: clientMethodStart },
      { line: 0, character: clientMethodEnd }
    );
    const clientCallSpan = createSpan(
      consumerUri,
      { start: 0, end: clientCode.length },
      { line: 0, character: 0 },
      { line: 0, character: clientCode.length }
    );

    const serverMethodSpan = createSpan(
      providerUri,
      { start: serverMethodStart, end: serverMethodEnd },
      { line: 0, character: serverMethodStart },
      { line: 0, character: serverMethodEnd }
    );
    const serverCallSpan = createSpan(
      providerUri,
      { start: 0, end: serverCode.length },
      { line: 0, character: 0 },
      { line: 0, character: serverCode.length }
    );

    const consumerObs: ApiObservation = {
      id: "obs:consumer:1" as ObservationId,
      role: "consumer" as ObservationRole,
      languageId: "typescript",
      framework: "fetch",
      extractorId: "fetch-extractor",
      source: [clientCallSpan],
      snapshot: {
        uri: consumerUri,
        contentHash: clientDoc.contentHash,
        documentVersion: clientDoc.documentVersion
      },
      endpoint: {
        method: {
          state: "known",
          value: "GET",
          strength: "direct",
          evidence: [
            {
              id: "ev-c-method",
              kind: "literal-syntax",
              strength: "direct",
              source: clientMethodSpan,
              description: "HTTP method GET"
            }
          ]
        },
        path: {
          state: "known",
          value: normalizeRoute("/api/users"),
          strength: "direct",
          evidence: [
            {
              id: "ev-c-path",
              kind: "literal-syntax",
              strength: "direct",
              source: clientCallSpan,
              description: "Route path /api/users"
            }
          ]
        },
        responses: []
      },
      limitations: []
    };

    const providerObs: ApiObservation = {
      id: "obs:provider:1" as ObservationId,
      role: "provider" as ObservationRole,
      languageId: "typescript",
      framework: "express",
      extractorId: "express-extractor",
      source: [serverCallSpan],
      snapshot: {
        uri: providerUri,
        contentHash: serverDoc.contentHash,
        documentVersion: serverDoc.documentVersion
      },
      endpoint: {
        method: {
          state: "known",
          value: "POST",
          strength: "direct",
          evidence: [
            {
              id: "ev-p-method",
              kind: "literal-syntax",
              strength: "direct",
              source: serverMethodSpan,
              description: "HTTP method POST"
            }
          ]
        },
        path: {
          state: "known",
          value: normalizeRoute("/api/users"),
          strength: "direct",
          evidence: [
            {
              id: "ev-p-path",
              kind: "literal-syntax",
              strength: "direct",
              source: serverCallSpan,
              description: "Route path /api/users"
            }
          ]
        },
        responses: []
      },
      limitations: []
    };

    const rel: ContractRelationship = {
      id: "rel:1" as RelationshipId,
      consumerId: consumerObs.id,
      providerId: providerObs.id,
      state: "matched",
      matchKind: "method-conflict",
      confidence: "high",
      reasons: ["Method mismatch"],
      evidence: [...consumerObs.source, ...providerObs.source],
      findingIds: ["finding:und120:users" as FindingId],
      limitations: []
    };

    const finding: Finding = {
      id: "finding:und120:users" as FindingId,
      ruleId: "UND120",
      category: "route",
      severity: "error",
      state: "active",
      title: "HTTP method mismatch for /api/users",
      summary: "Consumer calls GET but provider registers POST",
      explanation: "HTTP method mismatch between consumer GET and provider POST.",
      impactStatement: "Request will fail with HTTP 404 or 405.",
      evidenceStrength: "direct",
      relationshipId: rel.id,
      observationIds: [consumerObs.id, providerObs.id],
      sourceLocations: [...consumerObs.source, ...providerObs.source],
      observedAt: 1000,
      expected: "POST",
      observed: "GET",
      limitations: [],
      fixProposalIds: []
    };

    const sourceDocs = new Map<DocumentUri, SourceDocument>([
      [consumerUri, clientDoc],
      [providerUri, serverDoc]
    ]);

    const analysisResult: AnalysisResult = {
      status: "success",
      completeness: "complete",
      generation,
      generatedAt: 1000,
      findings: [finding],
      relationships: [rel],
      observations: [consumerObs, providerObs],
      warnings: []
    };

    return {
      clientDoc,
      serverDoc,
      finding,
      rel,
      consumerObs,
      providerObs,
      sourceDocs,
      analysisResult
    };
  }

  function createMockCoordinator(overrides?: {
    wsId?: WorkspaceId;
    analysisResult?: AnalysisResult | null;
    sourceDocs?: Map<DocumentUri, SourceDocument> | null;
  }): AnalysisCoordinator {
    const scenario = setupScenario(1);
    const activeWs = overrides?.wsId ?? wsId;
    const analysis =
      overrides?.analysisResult !== undefined ? overrides.analysisResult : scenario.analysisResult;
    const sourceDocs =
      overrides?.sourceDocs !== undefined ? overrides.sourceDocs : scenario.sourceDocs;

    return {
      getActiveWorkspaceId: vi.fn().mockReturnValue(activeWs),
      getLastAcceptedAnalysisResult: vi.fn().mockReturnValue(analysis),
      getLastAcceptedSourceDocuments: vi.fn().mockReturnValue(sourceDocs)
    } as unknown as AnalysisCoordinator;
  }

  it("generates both consumer and provider fix proposals from accepted analysis state", () => {
    const coordinator = createMockCoordinator();
    const service = new FixProposalService(coordinator);

    const proposals = service.getProposalsForFinding("finding:und120:users", wsId);

    expect(proposals).toHaveLength(2);

    const consumerProp = proposals.find((p) => p.targetRole === "consumer");
    const providerProp = proposals.find((p) => p.targetRole === "provider");

    expect(consumerProp).toBeDefined();
    expect(consumerProp?.targetRole).toBe("consumer");
    expect(consumerProp?.workspaceId).toBe(wsId);
    expect(consumerProp?.edits[0].documentUri).toBe(consumerUri);
    expect(consumerProp?.edits[0].newText).toBe('"POST"');

    expect(providerProp).toBeDefined();
    expect(providerProp?.targetRole).toBe("provider");
    expect(providerProp?.workspaceId).toBe(wsId);
    expect(providerProp?.edits[0].documentUri).toBe(providerUri);
    expect(providerProp?.edits[0].newText).toBe("get");
  });

  it("rejects proposal generation when workspace id is missing or empty", () => {
    const coordinator = createMockCoordinator({ wsId: undefined });
    const service = new FixProposalService(coordinator);

    const proposals = service.getProposalsForFinding("finding:und120:users", "" as WorkspaceId);
    expect(proposals).toEqual([]);

    const all = service.getAllProposals("" as WorkspaceId);
    expect(all.size).toBe(0);
  });

  it("returns empty when accepted analysis result is missing", () => {
    const coordinator = createMockCoordinator({ analysisResult: null });
    const service = new FixProposalService(coordinator);

    const proposals = service.getProposalsForFinding("finding:und120:users", wsId);
    expect(proposals).toEqual([]);
  });

  it("returns empty when accepted source documents are missing", () => {
    const coordinator = createMockCoordinator({ sourceDocs: null });
    const service = new FixProposalService(coordinator);

    const proposals = service.getProposalsForFinding("finding:und120:users", wsId);
    expect(proposals).toEqual([]);
  });

  it("retrieves a proposal by its ID correctly", () => {
    const coordinator = createMockCoordinator();
    const service = new FixProposalService(coordinator);

    const proposals = service.getProposalsForFinding("finding:und120:users", wsId);
    expect(proposals.length).toBeGreaterThan(0);

    const targetProp = proposals[0];
    const retrieved = service.getProposalById(targetProp.id, wsId);

    expect(retrieved).toBeDefined();
    expect(retrieved?.proposal.id).toBe(targetProp.id);
    expect(retrieved?.finding.id).toBe("finding:und120:users");
  });

  it("finds proposals matching a document URI and span range", () => {
    const coordinator = createMockCoordinator();
    const service = new FixProposalService(coordinator);

    const matches = service.getProposalsForDocument(consumerUri, {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 40 }
    });

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].proposal.workspaceId).toBe(wsId);
    expect(matches[0].finding.id).toBe("finding:und120:users");
  });

  it("returns empty when querying proposals for an unrelated document", () => {
    const coordinator = createMockCoordinator();
    const service = new FixProposalService(coordinator);

    const matches = service.getProposalsForDocument("file:///workspace/app/src/other.ts");
    expect(matches).toEqual([]);
  });
});
