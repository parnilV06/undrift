import { describe, expect, it, vi } from "vitest";
import type {
  AnalysisRequest,
  AnalysisResult,
  AnalysisWarning,
  ApiObservation,
  HttpMethod,
  ObservationRole,
  ParseIssue,
  ParserPort,
  RoutePattern,
  SourceDocument,
  SourceSpan,
  SyntaxNode,
  TypeShape
} from "../../packages/core/src/index";
import {
  AnalysisEngine,
  ContractMatcher,
  formatRoutePattern,
  RuleEngine
} from "../../packages/core/src/index";
import type { AnalyzerInput, LanguageAnalyzerPort } from "../../packages/core/src/ports/analyzer";

describe("Phase 3, Chunk 3.7: Analysis Pipeline & Result Assembler (Strict LLD Alignment)", () => {
  // Helper to create a dummy SyntaxNode facade
  function createDummySyntaxNode(): SyntaxNode {
    return {
      kind: "program",
      range: { start: 0, end: 10 },
      text: () => "dummy",
      children: () => [],
      namedChildren: () => [],
      childForField: () => undefined,
      parent: () => undefined
    };
  }

  // Helper to create a fake parser port
  function createFakeParser(
    options: {
      id?: string;
      languages?: string[];
      parseThrows?: Error;
      issues?: ParseIssue[];
      onParse?: (doc: SourceDocument) => void;
    } = {}
  ): ParserPort & { parseCount: number; disposed: boolean } {
    let parseCount = 0;
    let disposed = false;
    const supportedLangs = new Set(options.languages ?? ["typescript", "javascript"]);

    return {
      id: options.id ?? "fake-parser",
      get parseCount() {
        return parseCount;
      },
      get disposed() {
        return disposed;
      },
      supports: (lang: string) => supportedLangs.has(lang),
      parse: async (req) => {
        parseCount++;
        options.onParse?.(req.document);
        if (options.parseThrows) {
          throw options.parseThrows;
        }
        return {
          source: req.document,
          root: createDummySyntaxNode(),
          issues: options.issues ?? [],
          dispose: () => {
            disposed = true;
          }
        };
      },
      dispose: () => {
        disposed = true;
      }
    };
  }

  // Helper to create a fake analyzer port
  function createFakeAnalyzer(
    options: {
      id?: string;
      languages?: string[];
      observations?: ApiObservation[];
      warnings?: AnalysisWarning[];
      analyzeThrows?: Error;
      onAnalyze?: (input: AnalyzerInput) => void;
    } = {}
  ): LanguageAnalyzerPort & { analyzeCount: number } {
    let analyzeCount = 0;
    const supportedLangs = new Set(options.languages ?? ["typescript", "javascript"]);

    return {
      id: options.id ?? "fake-analyzer",
      get analyzeCount() {
        return analyzeCount;
      },
      supports: (lang: string) => supportedLangs.has(lang),
      analyze: async (input) => {
        analyzeCount++;
        options.onAnalyze?.(input);
        if (options.analyzeThrows) {
          throw options.analyzeThrows;
        }
        return {
          observations: options.observations ?? [],
          warnings: options.warnings ?? []
        };
      }
    };
  }

  // Helper to construct a canonical ApiObservation
  function createObservation(options: {
    id: string;
    role: ObservationRole;
    method: HttpMethod;
    path: string;
    uri?: string;
    requestBody?: TypeShape;
    responseBody?: TypeShape;
    responseCompleteness?: "complete" | "partial" | "unknown";
    limitations?: AnalysisWarning[];
  }): ApiObservation {
    const segments = options.path
      .split("/")
      .filter(Boolean)
      .map((s) =>
        s.startsWith(":")
          ? { kind: "parameter" as const, name: s.slice(1) }
          : { kind: "static" as const, value: s }
      );

    const routePattern: RoutePattern = {
      segments,
      trailingSlash: "absent",
      queryHandling: "excluded-from-path",
      rawPath: options.path
    };

    const source: SourceSpan[] = [
      {
        uri: options.uri ?? "src/endpoint.ts",
        range: { start: 0, end: 20 },
        start: { line: 1, character: 0 },
        end: { line: 1, character: 20 }
      }
    ];

    return {
      id: options.id,
      role: options.role,
      languageId: "typescript",
      extractorId: options.role === "consumer" ? "fetch-extractor" : "express-extractor",
      source,
      snapshot: { contentHash: "hash-1" },
      endpoint: {
        method: { state: "known", value: options.method, strength: "direct", evidence: [] },
        path: { state: "known", value: routePattern, strength: "direct", evidence: [] },
        request: options.requestBody
          ? {
              body: {
                shape: options.requestBody,
                completeness: "complete",
                evidence: []
              }
            }
          : undefined,
        responses: options.responseBody
          ? [
              {
                statusCode: { state: "known", value: 200, strength: "direct", evidence: [] },
                body: {
                  shape: options.responseBody,
                  completeness: options.responseCompleteness ?? "complete",
                  evidence: []
                },
                source
              }
            ]
          : undefined
      },
      limitations: options.limitations ?? []
    };
  }

  // Standard documented AnalysisRequest generator
  function createTestRequest(overrides?: Partial<AnalysisRequest>): AnalysisRequest {
    return {
      workspaceId: "ws-test",
      workspaceRootUris: ["file:///workspace"],
      generation: 1,
      documents: [
        {
          uri: "src/client.ts",
          languageId: "typescript",
          text: "fetch('/api/users');",
          contentHash: "hash-client"
        },
        {
          uri: "src/server.ts",
          languageId: "typescript",
          text: "app.get('/api/users', (req, res) => {});",
          contentHash: "hash-server"
        }
      ],
      config: {
        version: "1.0",
        matching: { trailingSlash: "preserve" },
        rules: {}
      },
      mode: "workspace",
      ...overrides
    };
  }

  // =========================================================================
  // 1. Request / Result Contracts & Statistics (LLD §4.4, §4.13)
  // =========================================================================

  describe("Request / Result Contracts & Statistics", () => {
    it("1. handles documented request configuration without extraneous fields", async () => {
      const engine = new AnalysisEngine();
      const request: AnalysisRequest = {
        workspaceId: "ws-test",
        workspaceRootUris: ["file:///workspace"],
        generation: 1,
        documents: [],
        config: {
          version: "1.0",
          matching: { trailingSlash: "preserve" },
          rules: {}
        },
        mode: "workspace"
      };

      const result = await engine.analyze(request);

      expect(result.workspaceId).toBe("ws-test");
      expect(result.generation).toBe(1);
      expect(typeof result.generatedAt).toBe("number");
      expect(result.complete).toBe(true);
    });

    it("2. produces AnalysisResult strictly adhering to LLD §4.13 without undocumented fields", async () => {
      const engine = new AnalysisEngine();
      const request = createTestRequest({ documents: [] });
      const result = await engine.analyze(request);

      // Verify all documented LLD §4.13 fields exist
      expect(result).toHaveProperty("workspaceId");
      expect(result).toHaveProperty("generation");
      expect(result).toHaveProperty("generatedAt");
      expect(result).toHaveProperty("complete");
      expect(result).toHaveProperty("observations");
      expect(result).toHaveProperty("relationships");
      expect(result).toHaveProperty("findings");
      expect(result).toHaveProperty("warnings");
      expect(result).toHaveProperty("statistics");

      // Verify undocumented fields are not present on AnalysisResult
      expect(result).not.toHaveProperty("status");
      expect(result).not.toHaveProperty("coverage");

      // Verify JSON serializability
      const serialized = JSON.stringify(result);
      expect(typeof serialized).toBe("string");
      const parsed = JSON.parse(serialized);
      expect(parsed.workspaceId).toBe("ws-test");
      expect(parsed.complete).toBe(true);
    });

    it("3. computes statistics using documented counting semantics", async () => {
      const obs1 = createObservation({
        id: "obs-1",
        role: "consumer",
        method: "GET",
        path: "/api/items"
      });
      const obs2 = createObservation({
        id: "obs-2",
        role: "provider",
        method: "GET",
        path: "/api/items"
      });

      const parser = createFakeParser({ id: "p1" });
      const analyzer = createFakeAnalyzer({
        id: "a1",
        observations: [obs1, obs2],
        warnings: [{ code: "DYNAMIC_ROUTE", message: "dynamic path", affectsCompleteness: false }]
      });

      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });
      const request = createTestRequest({
        documents: [{ uri: "file1.ts", languageId: "typescript", text: "code1", contentHash: "h1" }]
      });

      const result = await engine.analyze(request);
      const stats = result.statistics;

      expect(stats.filesConsidered).toBe(1);
      expect(stats.filesParsed).toBe(1);
      expect(stats.consumerObservations).toBe(1);
      expect(stats.providerObservations).toBe(1);
      expect(stats.relationships).toBe(1);
      expect(stats.unresolvedPatterns).toBeGreaterThanOrEqual(1);
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("4. handles valid empty input producing clean complete status", async () => {
      const engine = new AnalysisEngine();
      const request = createTestRequest({ documents: [] });
      const result = await engine.analyze(request);

      expect(result.complete).toBe(true);
      expect(result.observations).toEqual([]);
      expect(result.relationships).toEqual([]);
      expect(result.findings).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.statistics.filesConsidered).toBe(0);
      expect(result.statistics.filesParsed).toBe(0);
      expect(result.statistics.activeFindings).toBe(0);
    });
  });

  // =========================================================================
  // 2. Pipeline Orchestration & Normalization (LLD §8.1)
  // =========================================================================

  describe("Pipeline Orchestration & Normalization", () => {
    it("5. passes parser output to matching language analyzers", async () => {
      let passedDocUri = "";
      const parser = createFakeParser({ id: "p-ts", languages: ["typescript"] });
      const analyzer = createFakeAnalyzer({
        id: "a-ts",
        languages: ["typescript"],
        onAnalyze: (input) => {
          passedDocUri = input.document.uri;
        }
      });

      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });
      const request = createTestRequest({
        documents: [
          { uri: "app.ts", languageId: "typescript", text: "const x = 1;", contentHash: "h" }
        ]
      });

      await engine.analyze(request);

      expect(parser.parseCount).toBe(1);
      expect(analyzer.analyzeCount).toBe(1);
      expect(passedDocUri).toBe("app.ts");
    });

    it("6. collects and preserves analyzer observations and warnings across multiple files", async () => {
      const obs1 = createObservation({ id: "c1", role: "consumer", method: "GET", path: "/a" });
      const obs2 = createObservation({ id: "p1", role: "provider", method: "GET", path: "/b" });
      const warning: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: "Regex route unsupported",
        affectsCompleteness: false
      };

      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({
        observations: [obs1, obs2],
        warnings: [warning]
      });

      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });
      const request = createTestRequest({
        documents: [{ uri: "app.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);

      expect(result.observations).toHaveLength(2);
      expect(result.warnings).toContainEqual(warning);
    });

    it("7. normalizes route, method, and shape observations before matching", async () => {
      // Raw observation with non-normalized method (lowercase) and un-normalized route path with query
      const rawObs: ApiObservation = {
        id: "raw-obs",
        role: "consumer",
        languageId: "typescript",
        extractorId: "test",
        source: [],
        snapshot: { contentHash: "h" },
        endpoint: {
          method: {
            state: "known",
            value: "get" as unknown as HttpMethod,
            strength: "direct",
            evidence: []
          },
          path: {
            state: "known",
            strength: "direct",
            value: {
              segments: [{ kind: "static", value: "users" }],
              trailingSlash: "unknown",
              queryHandling: "unknown",
              rawPath: "/users?page=1"
            },
            evidence: []
          }
        },
        limitations: []
      };

      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({ observations: [rawObs] });
      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });

      const request = createTestRequest({
        documents: [{ uri: "client.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);
      const normalized = result.observations[0];

      // Method normalized to uppercase GET
      expect(normalized.endpoint.method.value).toBe("GET");
      // Path normalized to remove query parameter
      expect(normalized.endpoint.path.value.queryHandling).toBe("excluded-from-path");
      expect(formatRoutePattern(normalized.endpoint.path.value)).toBe("/users");
    });

    it("8. generates relationships using ContractMatcher through normal pipeline flow", async () => {
      const consumer = createObservation({
        id: "c1",
        role: "consumer",
        method: "GET",
        path: "/api/data"
      });
      const provider = createObservation({
        id: "p1",
        role: "provider",
        method: "GET",
        path: "/api/data"
      });

      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({ observations: [consumer, provider] });
      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });

      const request = createTestRequest({
        documents: [{ uri: "api.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);

      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].state).toBe("matched");
      expect(result.relationships[0].matchKind).toBe("exact");
    });

    it("9. includes protocol drift findings (UND120 method conflict)", async () => {
      const consumer = createObservation({
        id: "c1",
        role: "consumer",
        method: "POST",
        path: "/api/data"
      });
      const provider = createObservation({
        id: "p1",
        role: "provider",
        method: "GET",
        path: "/api/data"
      });

      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({ observations: [consumer, provider] });
      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });

      const request = createTestRequest({
        documents: [{ uri: "api.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);
      const und120 = result.findings.find((f) => f.ruleId === "UND120");

      expect(und120).toBeDefined();
      expect(und120?.category).toBe("route");
      expect(und120?.severity).toBe("error");
    });

    it("10. includes shape drift findings (UND310 response type mismatch)", async () => {
      const consumer = createObservation({
        id: "c1",
        role: "consumer",
        method: "GET",
        path: "/api/data",
        responseBody: {
          kind: "object",
          properties: [
            {
              name: "count",
              type: { kind: "primitive", name: "number" },
              presence: "required",
              nullable: "no",
              evidence: []
            }
          ],
          additionalProperties: "allowed"
        }
      });

      const provider = createObservation({
        id: "p1",
        role: "provider",
        method: "GET",
        path: "/api/data",
        responseBody: {
          kind: "object",
          properties: [
            {
              name: "count",
              type: { kind: "primitive", name: "string" }, // mismatch: string vs number
              presence: "required",
              nullable: "no",
              evidence: []
            }
          ],
          additionalProperties: "allowed"
        }
      });

      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({ observations: [consumer, provider] });
      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });

      const request = createTestRequest({
        documents: [{ uri: "api.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);
      const und310 = result.findings.find((f) => f.ruleId === "UND310");

      expect(und310).toBeDefined();
      expect(und310?.severity).toBe("error");
    });

    it("11. includes limitation findings (UND900/UND910) from warnings", async () => {
      const warning: AnalysisWarning = {
        code: "UNSUPPORTED_PATTERN",
        message: "Dynamic Express router unsupported",
        affectsCompleteness: false
      };

      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({ warnings: [warning] });
      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });

      const request = createTestRequest({
        documents: [{ uri: "route.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);
      const limitationFinding = result.findings.find(
        (f) => f.ruleId === "UND900" || f.ruleId === "UND910"
      );

      expect(limitationFinding).toBeDefined();
      expect(limitationFinding?.category).toBe("analysis-limit");
    });

    it("12. does not execute matcher or RuleEngine redundantly", async () => {
      const mockMatcher = new ContractMatcher();
      const matchSpy = vi.spyOn(mockMatcher, "match");

      const mockRuleEngine = new RuleEngine();
      const evaluateSpy = vi.spyOn(mockRuleEngine, "evaluate");

      const obs = createObservation({ id: "c1", role: "consumer", method: "GET", path: "/test" });
      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({ observations: [obs] });

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [analyzer],
        matcher: mockMatcher,
        ruleEngine: mockRuleEngine
      });

      const request = createTestRequest({
        documents: [{ uri: "app.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      await engine.analyze(request);

      expect(matchSpy).toHaveBeenCalledTimes(1);
      expect(evaluateSpy).toHaveBeenCalledTimes(1);
    });

    it("13. preserves source evidence, observation references, and limitations in result assembly", async () => {
      const warning: AnalysisWarning = {
        code: "PARTIAL_SHAPE",
        message: "Shape extraction truncated",
        affectsCompleteness: false
      };

      const obs = createObservation({
        id: "c-ev",
        role: "consumer",
        method: "GET",
        path: "/evidence-check",
        uri: "client/api.ts",
        limitations: [warning]
      });

      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({ observations: [obs] });
      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });

      const request = createTestRequest({
        documents: [
          { uri: "client/api.ts", languageId: "typescript", text: "...", contentHash: "h" }
        ]
      });

      const result = await engine.analyze(request);

      expect(result.observations[0].source[0].uri).toBe("client/api.ts");
      expect(result.observations[0].limitations).toContainEqual(warning);
    });

    it("14. produces identical findings and IDs regardless of input document ordering", async () => {
      const obsC = createObservation({
        id: "c1",
        role: "consumer",
        method: "POST",
        path: "/order"
      });
      const obsP = createObservation({ id: "p1", role: "provider", method: "GET", path: "/order" });

      const parser = createFakeParser();
      const analyzerC = createFakeAnalyzer({
        id: "analyzer-c",
        observations: [obsC],
        languages: ["typescript"]
      });
      const analyzerP = createFakeAnalyzer({
        id: "analyzer-p",
        observations: [obsP],
        languages: ["typescript"]
      });

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [analyzerC, analyzerP]
      });

      const reqA = createTestRequest({
        documents: [
          { uri: "client.ts", languageId: "typescript", text: "c", contentHash: "h1" },
          { uri: "server.ts", languageId: "typescript", text: "p", contentHash: "h2" }
        ]
      });
      const reqB = createTestRequest({
        documents: [
          { uri: "server.ts", languageId: "typescript", text: "p", contentHash: "h2" },
          { uri: "client.ts", languageId: "typescript", text: "c", contentHash: "h1" }
        ]
      });

      const resultA = await engine.analyze(reqA);
      const resultB = await engine.analyze(reqB);

      expect(resultA.findings.map((f) => f.id)).toEqual(resultB.findings.map((f) => f.id));
      expect(resultA.findings.map((f) => f.ruleId)).toEqual(resultB.findings.map((f) => f.ruleId));
    });
  });

  // =========================================================================
  // 3. Coverage, Completeness, & Failure Semantics (LLD §10.6, §10.7)
  // =========================================================================

  describe("Coverage, Completeness, & Failure Semantics", () => {
    it("15. updates completeness and records warning on parse failure", async () => {
      const parser = createFakeParser({
        parseThrows: new Error("Syntax error in line 42")
      });

      const engine = new AnalysisEngine({ parsers: [parser] });
      const request = createTestRequest({
        documents: [{ uri: "bad.ts", languageId: "typescript", text: "bad", contentHash: "h" }]
      });

      const result = await engine.analyze(request);

      expect(result.complete).toBe(false);
      expect(result.warnings.some((w) => w.code === "PARSE_ERROR" && w.affectsCompleteness)).toBe(
        true
      );
    });

    it("16. updates completeness when analyzer emits completeness-affecting warning", async () => {
      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({
        warnings: [
          {
            code: "INCOMPLETE_SCOPE",
            message: "Missing backend route declarations in scanned scope",
            affectsCompleteness: true
          }
        ]
      });

      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });
      const request = createTestRequest({
        documents: [{ uri: "app.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);

      expect(result.complete).toBe(false);
    });

    it("17. does not mark analysis incomplete for non-completeness-affecting warnings", async () => {
      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({
        warnings: [
          {
            code: "PARTIAL_SHAPE",
            message: "Some optional properties omitted",
            affectsCompleteness: false
          }
        ]
      });

      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });
      const request = createTestRequest({
        documents: [{ uri: "app.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);

      expect(result.complete).toBe(true);
      expect(result.warnings).toHaveLength(1);
    });

    it("18. marks scoped analysis mode incomplete conservatively", async () => {
      const engine = new AnalysisEngine();
      const request = createTestRequest({
        documents: [],
        mode: "scoped"
      });

      const result = await engine.analyze(request);

      expect(result.complete).toBe(false);
    });

    it("19. suppresses UND100 (missing provider) when provider/backend coverage is incomplete", async () => {
      const consumer = createObservation({
        id: "c1",
        role: "consumer",
        method: "GET",
        path: "/api/unknown"
      });

      // Parser throws on backend file, causing backend coverage failure
      const parser = createFakeParser({
        languages: ["typescript"],
        parseThrows: new Error("Backend parse failure")
      });
      const analyzer = createFakeAnalyzer({
        observations: [consumer]
      });

      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });
      const request = createTestRequest({
        documents: [{ uri: "server.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);

      // UND100 must be withheld because backend coverage is incomplete
      const und100 = result.findings.find((f) => f.ruleId === "UND100");
      expect(und100).toBeUndefined();
    });

    it("20. suppresses UND110 (orphaned provider) when consumer coverage is incomplete", async () => {
      const provider = createObservation({
        id: "p1",
        role: "provider",
        method: "GET",
        path: "/api/orphan"
      });

      // Parser throws on frontend file, causing consumer coverage failure
      const parser = createFakeParser({
        languages: ["typescript"],
        parseThrows: new Error("Frontend parse failure")
      });
      const analyzer = createFakeAnalyzer({
        observations: [provider]
      });

      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });
      const request = createTestRequest({
        documents: [{ uri: "client.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);

      // UND110 must be withheld because consumer coverage is incomplete
      const und110 = result.findings.find((f) => f.ruleId === "UND110");
      expect(und110).toBeUndefined();
    });

    it("21. does not produce falsely complete result when an analyzer throws unexpectedly", async () => {
      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({
        analyzeThrows: new Error("Fatal extractor crash")
      });

      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });
      const request = createTestRequest({
        documents: [{ uri: "crash.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);

      expect(result.complete).toBe(false);
      expect(result.warnings.some((w) => w.code === "ANALYZER_FAILURE")).toBe(true);
    });
  });

  // =========================================================================
  // 4. Cancellation Semantics (LLD §5.4, §8.1)
  // =========================================================================

  describe("Cancellation Semantics", () => {
    it("22. handles pre-aborted request returning incomplete result with cancellation warning", async () => {
      const controller = new AbortController();
      controller.abort();

      const engine = new AnalysisEngine();
      const request = createTestRequest();

      const result = await engine.analyze(request, controller.signal);

      expect(result.complete).toBe(false);
      expect(result.findings).toEqual([]);
      expect(result.statistics.filesParsed).toBe(0);
      expect(result.warnings.some((w) => w.code === "INCOMPLETE_SCOPE")).toBe(true);
    });

    it("23. cancels during document processing without marking result complete", async () => {
      const controller = new AbortController();
      let docCount = 0;

      const parser = createFakeParser({
        onParse: () => {
          docCount++;
          if (docCount === 1) {
            controller.abort();
          }
        }
      });

      const engine = new AnalysisEngine({ parsers: [parser] });
      const request = createTestRequest({
        documents: [
          { uri: "doc1.ts", languageId: "typescript", text: "1", contentHash: "h1" },
          { uri: "doc2.ts", languageId: "typescript", text: "2", contentHash: "h2" },
          { uri: "doc3.ts", languageId: "typescript", text: "3", contentHash: "h3" }
        ]
      });

      const result = await engine.analyze(request, controller.signal);

      expect(result.complete).toBe(false);
      expect(parser.parseCount).toBeLessThan(3);
      expect(result.warnings.some((w) => w.code === "INCOMPLETE_SCOPE")).toBe(true);
    });

    it("24. does not emit unsupported absence assertions when cancelled", async () => {
      const controller = new AbortController();
      controller.abort();

      const consumer = createObservation({
        id: "c1",
        role: "consumer",
        method: "GET",
        path: "/lone"
      });

      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({ observations: [consumer] });
      const engine = new AnalysisEngine({ parsers: [parser], analyzers: [analyzer] });

      const request = createTestRequest({
        documents: [{ uri: "app.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request, controller.signal);

      expect(result.findings).toHaveLength(0);
      expect(result.complete).toBe(false);
    });
  });

  // =========================================================================
  // 5. Normal Candidate Matching & Resource Lifecycle
  // =========================================================================

  describe("Normal Candidate Matching & Resource Lifecycle", () => {
    it("25. runs candidate matching exactly once through normal pipeline flow", async () => {
      const mockMatcher = new ContractMatcher();
      const matchSpy = vi.spyOn(mockMatcher, "match");

      const consumer = createObservation({
        id: "c1",
        role: "consumer",
        method: "GET",
        path: "/test"
      });
      const provider = createObservation({
        id: "p1",
        role: "provider",
        method: "GET",
        path: "/test"
      });

      const parser = createFakeParser();
      const analyzer = createFakeAnalyzer({ observations: [consumer, provider] });

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [analyzer],
        matcher: mockMatcher
      });

      const request = createTestRequest({
        documents: [{ uri: "app.ts", languageId: "typescript", text: "...", contentHash: "h" }]
      });

      const result = await engine.analyze(request);

      expect(matchSpy).toHaveBeenCalledTimes(1);
      expect(result.relationships).toHaveLength(1);
      expect(result.relationships[0].state).toBe("matched");
    });

    it("26. handles missing optional inputs and empty documents conservatively", async () => {
      const engine = new AnalysisEngine();
      const request: AnalysisRequest = {
        workspaceId: "ws-minimal",
        workspaceRootUris: [],
        generation: 42,
        documents: [],
        config: {
          version: "1.0",
          matching: { trailingSlash: "preserve" },
          rules: {}
        },
        mode: "workspace"
      };

      const result = await engine.analyze(request);

      expect(result.workspaceId).toBe("ws-minimal");
      expect(result.generation).toBe(42);
      expect(result.observations).toEqual([]);
      expect(result.relationships).toEqual([]);
      expect(result.findings).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.statistics.filesConsidered).toBe(0);
    });

    it("27. disposes registered parsers on engine.dispose()", async () => {
      const parser1 = createFakeParser({ id: "p1" });
      const parser2 = createFakeParser({ id: "p2" });

      const engine = new AnalysisEngine({ parsers: [parser1, parser2] });
      await engine.dispose();

      expect(parser1.disposed).toBe(true);
      expect(parser2.disposed).toBe(true);
    });
  });
});
