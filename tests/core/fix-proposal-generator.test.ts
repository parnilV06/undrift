// Phase 5, Chunk 5.1: Core Fix Proposal Model & Method Mismatch Generator Tests
// Strictly adhering to LLD.md Section 13.1, PRD.md Section 13, and Chunk 5.1 specification.

import { describe, expect, it } from "vitest";
import type {
  AnalysisWarning,
  ApiObservation,
  ContractRelationship,
  DocumentUri,
  EvidenceRef,
  Finding,
  FixGenerationContext,
  FixProposal,
  HttpMethod,
  ObservationRole,
  RoutePattern,
  SourceDocument,
  SourceSpan
} from "../../packages/core/src/index";
import {
  createDefaultFixGeneratorRegistry,
  createFindingId,
  createFixProposalId,
  createProposedEditId,
  createRelationshipId,
  evaluateMethodConflictRule,
  FixGeneratorRegistry,
  formatRoutePattern,
  MethodMismatchFixGenerator,
  normalizeRoute
} from "../../packages/core/src/index";

describe("Phase 5, Chunk 5.1: Core Fix Proposal Model & Method Mismatch Generator", () => {
  // --------------------------------------------------------------------------
  // Fixture Builders
  // --------------------------------------------------------------------------

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
    return {
      uri,
      range,
      start,
      end
    };
  }

  function createObservation(
    id: string,
    role: ObservationRole,
    method: HttpMethod,
    routePath: string,
    sourceDoc: SourceDocument,
    methodTokenRange: { start: number; end: number },
    methodTokenPos: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    },
    options?: {
      framework?: string;
      evidenceKind?: "literal-syntax" | "framework-convention";
      strength?: "direct" | "inferred";
      methodState?: "known" | "dynamic" | "unknown";
      pathState?: "known" | "dynamic" | "unknown";
      limitations?: AnalysisWarning[];
    }
  ): ApiObservation {
    const routePattern = normalizeRoute(routePath);
    const methodSpan = createSpan(
      sourceDoc.uri,
      methodTokenRange,
      methodTokenPos.start,
      methodTokenPos.end
    );
    const callSpan = createSpan(
      sourceDoc.uri,
      { start: 0, end: sourceDoc.text.length },
      { line: 0, character: 0 },
      { line: 0, character: sourceDoc.text.length }
    );

    const evidenceKind = options?.evidenceKind ?? "literal-syntax";
    const strength = options?.strength ?? "direct";

    const methodEvidence: EvidenceRef = {
      id: `ev-method-${id}`,
      kind: evidenceKind,
      strength,
      source: methodSpan,
      description: `HTTP method '${method}'`
    };

    const pathEvidence: EvidenceRef = {
      id: `ev-path-${id}`,
      kind: "literal-syntax",
      strength: "direct",
      source: callSpan,
      description: `Route path '${routePath}'`
    };

    return {
      id: `obs:${role}:${id}`,
      role,
      languageId: "typescript",
      framework: options?.framework ?? (role === "consumer" ? "fetch" : "express"),
      extractorId: role === "consumer" ? "fetch-extractor" : "express-extractor",
      source: [callSpan],
      snapshot: {
        uri: sourceDoc.uri,
        contentHash: sourceDoc.contentHash,
        documentVersion: sourceDoc.documentVersion
      },
      endpoint: {
        method:
          options?.methodState && options.methodState !== "known"
            ? {
                state: options.methodState,
                reason: "dynamic method dispatch",
                evidence: [methodEvidence]
              }
            : {
                state: "known",
                value: method,
                strength,
                evidence: [methodEvidence]
              },
        path:
          options?.pathState && options.pathState !== "known"
            ? {
                state: options.pathState,
                reason: "dynamic route",
                evidence: [pathEvidence]
              }
            : {
                state: "known",
                value: routePattern,
                strength: "direct",
                evidence: [pathEvidence]
              },
        responses: []
      },
      limitations: options?.limitations ?? []
    };
  }

  function setupMethodConflictScenario(options?: {
    consumerQuote?: '"' | "'" | "`";
    consumerMethod?: HttpMethod;
    providerMethod?: HttpMethod;
    consumerMethodKind?: "literal-syntax" | "framework-convention";
    consumerStrength?: "direct" | "inferred";
    providerStrength?: "direct" | "inferred";
    consumerMethodState?: "known" | "dynamic" | "unknown";
    providerMethodState?: "known" | "dynamic" | "unknown";
    pathState?: "known" | "dynamic";
    consumerLimitations?: AnalysisWarning[];
    providerLimitations?: AnalysisWarning[];
  }) {
    const cMethod = options?.consumerMethod ?? "GET";
    const pMethod = options?.providerMethod ?? "POST";
    const quote = options?.consumerQuote ?? '"';

    const clientCode = `fetch("/api/users", { method: ${quote}${cMethod}${quote} });`;
    const serverCode = `app.${pMethod.toLowerCase()}("/api/users", handler);`;

    const clientDoc = createSourceDoc("file:///workspace/src/client.ts", clientCode, 2);
    const serverDoc = createSourceDoc("file:///workspace/src/server.ts", serverCode, 3);

    const clientMethodStart = clientCode.indexOf(`${quote}${cMethod}${quote}`);
    const clientMethodEnd = clientMethodStart + `${quote}${cMethod}${quote}`.length;

    const serverMethodStart = serverCode.indexOf(pMethod.toLowerCase());
    const serverMethodEnd = serverMethodStart + pMethod.toLowerCase().length;

    const consumerObs = createObservation(
      "client-1",
      "consumer",
      cMethod,
      "/api/users",
      clientDoc,
      { start: clientMethodStart, end: clientMethodEnd },
      {
        start: { line: 0, character: clientMethodStart },
        end: { line: 0, character: clientMethodEnd }
      },
      {
        evidenceKind: options?.consumerMethodKind ?? "literal-syntax",
        strength: options?.consumerStrength ?? "direct",
        methodState: options?.consumerMethodState,
        pathState: options?.pathState,
        limitations: options?.consumerLimitations
      }
    );

    const providerObs = createObservation(
      "server-1",
      "provider",
      pMethod,
      "/api/users",
      serverDoc,
      { start: serverMethodStart, end: serverMethodEnd },
      {
        start: { line: 0, character: serverMethodStart },
        end: { line: 0, character: serverMethodEnd }
      },
      {
        strength: options?.providerStrength ?? "direct",
        methodState: options?.providerMethodState,
        pathState: options?.pathState,
        limitations: options?.providerLimitations
      }
    );

    const rel: ContractRelationship = {
      id: createRelationshipId("rel-1", consumerObs.id, providerObs.id),
      consumerId: consumerObs.id,
      providerId: providerObs.id,
      state: "matched",
      matchKind: "method-conflict",
      confidence: "high",
      reasons: ["Route matches but HTTP method differs"],
      evidence: [...consumerObs.source, ...providerObs.source],
      findingIds: [],
      limitations: []
    };

    const obsMap = new Map<string, ApiObservation>([
      [consumerObs.id, consumerObs],
      [providerObs.id, providerObs]
    ]);

    const finding = evaluateMethodConflictRule(rel, obsMap) ?? {
      id: createFindingId({
        ruleId: "UND120",
        method: cMethod,
        route: consumerObs.endpoint.path.state === "known" ? consumerObs.endpoint.path.value : null,
        consumerId: consumerObs.id,
        providerId: providerObs.id,
        observationIds: [consumerObs.id, providerObs.id]
      }),
      ruleId: "UND120" as const,
      category: "route" as const,
      severity: "error" as const,
      state: "active" as const,
      title: "HTTP method conflict",
      summary: "HTTP method conflict",
      explanation: "HTTP method conflict",
      evidenceStrength:
        options?.consumerStrength === "inferred" || options?.providerStrength === "inferred"
          ? ("inferred" as const)
          : ("direct" as const),
      relationshipId: rel.id,
      observationIds: [consumerObs.id, providerObs.id],
      sourceLocations: [...consumerObs.source, ...providerObs.source],
      expected: cMethod,
      observed: pMethod,
      limitations: [
        ...(options?.consumerLimitations ?? []),
        ...(options?.providerLimitations ?? [])
      ],
      fixProposalIds: []
    };

    const context: FixGenerationContext = {
      observations: obsMap,
      relationships: new Map([[rel.id, rel]]),
      sourceDocuments: new Map([
        [clientDoc.uri, clientDoc],
        [serverDoc.uri, serverDoc]
      ]),
      generation: 5
    };

    return {
      clientDoc,
      serverDoc,
      consumerObs,
      providerObs,
      rel,
      finding,
      context
    };
  }

  // --------------------------------------------------------------------------
  // Tests
  // --------------------------------------------------------------------------

  describe("1. Domain Model Construction & Proposal Semantics", () => {
    it("creates deterministic proposal IDs based on semantic inputs", () => {
      const id1 = createFixProposalId({
        findingId: "find:UND120:12345",
        targetRole: "consumer",
        targetUri: "file:///workspace/client.ts",
        rangeStart: 30,
        rangeEnd: 35,
        newText: '"POST"'
      });

      const id2 = createFixProposalId({
        findingId: "find:UND120:12345",
        targetRole: "consumer",
        targetUri: "file:///workspace/client.ts",
        rangeStart: 30,
        rangeEnd: 35,
        newText: '"POST"'
      });

      expect(id1).toBe(id2);
      expect(id1).toMatch(/^prop:consumer:[a-f0-9]{16}$/);
    });

    it("generates distinct proposal IDs for consumer-side vs provider-side alternatives", () => {
      const consumerId = createFixProposalId({
        findingId: "find:UND120:12345",
        targetRole: "consumer",
        targetUri: "file:///workspace/client.ts",
        rangeStart: 30,
        rangeEnd: 35,
        newText: '"POST"'
      });

      const providerId = createFixProposalId({
        findingId: "find:UND120:12345",
        targetRole: "provider",
        targetUri: "file:///workspace/server.ts",
        rangeStart: 4,
        rangeEnd: 8,
        newText: "get"
      });

      expect(consumerId).not.toBe(providerId);
      expect(consumerId).toContain("prop:consumer:");
      expect(providerId).toContain("prop:provider:");
    });

    it("generates deterministic edit IDs within a proposal", () => {
      const editId0 = createProposedEditId("prop:consumer:abcdef1234567890", 0);
      const editId1 = createProposedEditId("prop:consumer:abcdef1234567890", 1);

      expect(editId0).toBe("prop:consumer:abcdef1234567890:edit:0");
      expect(editId1).toBe("prop:consumer:abcdef1234567890:edit:1");
    });
  });

  describe("2. Method Mismatch Fix Generator (UND120)", () => {
    it("generates both consumer-side and provider-side proposals when both sides are literal", () => {
      const { finding, context, clientDoc, serverDoc } = setupMethodConflictScenario();
      const generator = new MethodMismatchFixGenerator();

      const proposals = generator.generateProposals(finding, context);

      expect(proposals).toHaveLength(2);

      const consumerProp = proposals.find((p) => p.targetRole === "consumer");
      const providerProp = proposals.find((p) => p.targetRole === "provider");

      expect(consumerProp).toBeDefined();
      expect(providerProp).toBeDefined();

      // Verify Consumer Proposal details
      expect(consumerProp!.risk).toBe("mechanical");
      expect(consumerProp!.status).toBe("proposed");
      expect(consumerProp!.generation).toBe(5);
      expect(consumerProp!.findingId).toBe(finding.id);
      expect(consumerProp!.title).toBe("Change frontend request method to POST");
      expect(consumerProp!.rationale).toContain(
        "expects HTTP method POST, but the frontend call specifies GET"
      );
      expect(consumerProp!.assumptions).toHaveLength(2);
      expect(consumerProp!.assumptions[0]).toContain(
        "Assumes the backend provider's HTTP method (POST) is the authoritative contract"
      );
      expect(consumerProp!.verificationDescription).toContain("resolving rule UND120");

      expect(consumerProp!.edits).toHaveLength(1);
      const cEdit = consumerProp!.edits[0];
      expect(cEdit.documentUri).toBe(clientDoc.uri);
      expect(cEdit.expectedContentHash).toBe(clientDoc.contentHash);
      expect(cEdit.expectedDocumentVersion).toBe(clientDoc.documentVersion);
      expect(cEdit.newText).toBe('"POST"');
      expect(cEdit.range.start).toBe(30);
      expect(cEdit.range.end).toBe(35);
      expect(cEdit.start).toEqual({ line: 0, character: 30 });
      expect(cEdit.end).toEqual({ line: 0, character: 35 });

      // Verify Provider Proposal details
      expect(providerProp!.risk).toBe("mechanical");
      expect(providerProp!.status).toBe("proposed");
      expect(providerProp!.generation).toBe(5);
      expect(providerProp!.findingId).toBe(finding.id);
      expect(providerProp!.title).toBe("Change backend endpoint method to GET");
      expect(providerProp!.rationale).toContain(
        "sends HTTP method GET, but the backend route handler expects POST"
      );
      expect(providerProp!.assumptions).toHaveLength(2);
      expect(providerProp!.assumptions[0]).toContain(
        "Assumes the frontend consumer's HTTP method (GET) is the authoritative contract"
      );

      expect(providerProp!.edits).toHaveLength(1);
      const pEdit = providerProp!.edits[0];
      expect(pEdit.documentUri).toBe(serverDoc.uri);
      expect(pEdit.expectedContentHash).toBe(serverDoc.contentHash);
      expect(pEdit.expectedDocumentVersion).toBe(serverDoc.documentVersion);
      expect(pEdit.newText).toBe("get");
      expect(pEdit.range.start).toBe(4);
      expect(pEdit.range.end).toBe(8);
      expect(pEdit.start).toEqual({ line: 0, character: 4 });
      expect(pEdit.end).toEqual({ line: 0, character: 8 });
    });

    it("leaves all surrounding text completely intact when applying the proposed replacement", () => {
      const { finding, context, clientDoc, serverDoc } = setupMethodConflictScenario();
      const generator = new MethodMismatchFixGenerator();

      const [consumerProp, providerProp] = generator.generateProposals(finding, context);

      // Verify consumer edit application
      const cEdit = consumerProp.edits[0];
      const appliedClient =
        clientDoc.text.slice(0, cEdit.range.start) +
        cEdit.newText +
        clientDoc.text.slice(cEdit.range.end);
      expect(appliedClient).toBe('fetch("/api/users", { method: "POST" });');

      // Verify provider edit application
      const pEdit = providerProp.edits[0];
      const appliedServer =
        serverDoc.text.slice(0, pEdit.range.start) +
        pEdit.newText +
        serverDoc.text.slice(pEdit.range.end);
      expect(appliedServer).toBe('app.get("/api/users", handler);');
    });

    it("preserves single-quote convention for frontend method literals", () => {
      const { finding, context, clientDoc } = setupMethodConflictScenario({
        consumerQuote: "'"
      });
      const generator = new MethodMismatchFixGenerator();

      const proposals = generator.generateProposals(finding, context);
      const consumerProp = proposals.find((p) => p.targetRole === "consumer")!;

      expect(consumerProp.edits[0].newText).toBe("'POST'");
      const applied =
        clientDoc.text.slice(0, consumerProp.edits[0].range.start) +
        consumerProp.edits[0].newText +
        clientDoc.text.slice(consumerProp.edits[0].range.end);
      expect(applied).toBe("fetch(\"/api/users\", { method: 'POST' });");
    });

    it("preserves template backtick quote convention for frontend method literals", () => {
      const { finding, context, clientDoc } = setupMethodConflictScenario({
        consumerQuote: "`"
      });
      const generator = new MethodMismatchFixGenerator();

      const proposals = generator.generateProposals(finding, context);
      const consumerProp = proposals.find((p) => p.targetRole === "consumer")!;

      expect(consumerProp.edits[0].newText).toBe("`POST`");
      const applied =
        clientDoc.text.slice(0, consumerProp.edits[0].range.start) +
        consumerProp.edits[0].newText +
        clientDoc.text.slice(consumerProp.edits[0].range.end);
      expect(applied).toBe('fetch("/api/users", { method: `POST` });');
    });

    it("respects targetRole filter when specified in context", () => {
      const { finding, context } = setupMethodConflictScenario();
      const generator = new MethodMismatchFixGenerator();

      const consumerOnly = generator.generateProposals(finding, {
        ...context,
        targetRole: "consumer"
      });
      expect(consumerOnly).toHaveLength(1);
      expect(consumerOnly[0].targetRole).toBe("consumer");

      const providerOnly = generator.generateProposals(finding, {
        ...context,
        targetRole: "provider"
      });
      expect(providerOnly).toHaveLength(1);
      expect(providerOnly[0].targetRole).toBe("provider");
    });

    it("declines consumer proposal for implicit default fetch GET methods without synthesizing inserts", () => {
      const { finding, context } = setupMethodConflictScenario({
        consumerMethodKind: "framework-convention"
      });
      const generator = new MethodMismatchFixGenerator();

      const proposals = generator.generateProposals(finding, context);

      // Only provider proposal is possible; implicit fetch has no exact literal token to edit
      expect(proposals).toHaveLength(1);
      expect(proposals[0].targetRole).toBe("provider");
      expect(proposals[0].edits[0].newText).toBe("get");
    });

    it("declines proposals when consumer evidence is inferred (e.g. configured client)", () => {
      const { finding, context } = setupMethodConflictScenario({
        consumerStrength: "inferred"
      });
      const generator = new MethodMismatchFixGenerator();

      const proposals = generator.generateProposals(finding, context);
      expect(proposals).toHaveLength(0);
    });

    it("declines proposals when provider evidence is inferred", () => {
      const { finding, context } = setupMethodConflictScenario({
        providerStrength: "inferred"
      });
      const generator = new MethodMismatchFixGenerator();

      const proposals = generator.generateProposals(finding, context);
      expect(proposals).toHaveLength(0);
    });

    it("declines proposals when method state is dynamic", () => {
      const { finding, context } = setupMethodConflictScenario({
        consumerMethodState: "dynamic"
      });
      const generator = new MethodMismatchFixGenerator();

      const proposals = generator.generateProposals(finding, context);
      expect(proposals).toHaveLength(0);
    });

    it("declines proposals when route path state is dynamic", () => {
      const { finding, context } = setupMethodConflictScenario({
        pathState: "dynamic"
      });
      const generator = new MethodMismatchFixGenerator();

      const proposals = generator.generateProposals(finding, context);
      expect(proposals).toHaveLength(0);
    });

    it("declines proposals when observations carry completeness-affecting limitations", () => {
      const { finding, context } = setupMethodConflictScenario({
        consumerLimitations: [
          {
            code: "UNSUPPORTED_PATTERN",
            message: "Dynamic options argument",
            affectsCompleteness: true
          }
        ]
      });
      const generator = new MethodMismatchFixGenerator();

      const proposals = generator.generateProposals(finding, context);
      expect(proposals).toHaveLength(0);
    });

    it("declines proposals when finding state is not active", () => {
      const { finding, context } = setupMethodConflictScenario();
      const generator = new MethodMismatchFixGenerator();

      const resolvedFinding: Finding = {
        ...finding,
        state: "resolved"
      };

      const proposals = generator.generateProposals(resolvedFinding, context);
      expect(proposals).toHaveLength(0);
    });

    it("declines proposals for findings from unsupported rules", () => {
      const { finding, context } = setupMethodConflictScenario();
      const generator = new MethodMismatchFixGenerator();

      const unrelatedFinding: Finding = {
        ...finding,
        ruleId: "UND100"
      };

      const proposals = generator.generateProposals(unrelatedFinding, context);
      expect(proposals).toHaveLength(0);
    });

    it("fails closed when source document text at span does not match extracted method", () => {
      const { finding, context, clientDoc } = setupMethodConflictScenario();
      const generator = new MethodMismatchFixGenerator();

      // Corrupt clientDoc text so the span no longer points to GET
      const corruptedDoc: SourceDocument = {
        ...clientDoc,
        text: 'fetch("/api/users", { method: "PUT" });'
      };

      const corruptedContext: FixGenerationContext = {
        ...context,
        sourceDocuments: new Map([
          [clientDoc.uri, corruptedDoc],
          [
            context.sourceDocuments!.get(finding.sourceLocations[1].uri)!.uri,
            context.sourceDocuments!.get(finding.sourceLocations[1].uri)!
          ]
        ])
      };

      const proposals = generator.generateProposals(finding, corruptedContext);

      // Consumer proposal declined due to source mismatch; provider proposal still valid
      expect(proposals).toHaveLength(1);
      expect(proposals[0].targetRole).toBe("provider");
    });
  });

  describe("3. Fix Generator Registry & Dispatch", () => {
    it("registers and dispatches proposals by rule ID", () => {
      const registry = new FixGeneratorRegistry();
      const generator = new MethodMismatchFixGenerator();

      expect(registry.getGenerators("UND120")).toHaveLength(0);

      registry.register(generator);

      expect(registry.getGenerators("UND120")).toHaveLength(1);
      expect(registry.getGenerators("UND120")[0].id).toBe("und120-method-conflict-generator");
      expect(registry.getGenerators("UND100")).toHaveLength(0);

      const { finding, context } = setupMethodConflictScenario();
      const proposals = registry.generateProposals(finding, context);

      expect(proposals).toHaveLength(2);
    });

    it("returns empty proposals array for unsupported rule IDs in registry", () => {
      const registry = new FixGeneratorRegistry();
      registry.register(new MethodMismatchFixGenerator());

      const { finding, context } = setupMethodConflictScenario();
      const unsupportedFinding: Finding = {
        ...finding,
        ruleId: "UND300"
      };

      const proposals = registry.generateProposals(unsupportedFinding, context);
      expect(proposals).toEqual([]);
    });

    it("createDefaultFixGeneratorRegistry includes MethodMismatchFixGenerator", () => {
      const defaultRegistry = createDefaultFixGeneratorRegistry();
      const generators = defaultRegistry.getGenerators("UND120");

      expect(generators).toHaveLength(1);
      expect(generators[0].id).toBe("und120-method-conflict-generator");
    });

    it("forwards workspaceId from FixGenerationContext to generated proposals", () => {
      const generator = new MethodMismatchFixGenerator();
      const { finding, context } = setupMethodConflictScenario();
      const contextWithWs = {
        ...context,
        workspaceId: "ws:test-workspace" as const
      };

      const proposals = generator.generateProposals(finding, contextWithWs);
      expect(proposals).toHaveLength(2);
      expect(proposals[0].workspaceId).toBe("ws:test-workspace");
      expect(proposals[1].workspaceId).toBe("ws:test-workspace");
    });
  });
});
