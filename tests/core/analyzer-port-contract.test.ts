// Phase 2, Chunk 2.2: Analyzer Port Contract Unit Tests.
// Verifies structural integrity, interface conformity, cancellation signal propagation,
// and boundary semantics for AnalyzerPort, AnalyzerInput, and AnalyzerOutput.

import { describe, expect, it } from "vitest";
import type {
  AnalysisWarning,
  AnalyzerInput,
  AnalyzerOutput,
  AnalyzerPort,
  ApiObservation,
  DocumentUri,
  LanguageAnalyzerPort,
  ParsedDocument,
  ProjectIndexView,
  ResolvedUndriftConfig,
  SourceDocument,
  SyntaxNode
} from "../../packages/core/src/index";

describe("Analyzer Port Contract (Chunk 2.2)", () => {
  const dummyDoc: SourceDocument = {
    uri: "file:///workspace/src/app.ts",
    languageId: "typescript",
    text: "export const api = '/users';",
    contentHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
  };

  const dummyNode: SyntaxNode = {
    kind: "program",
    range: { start: 0, end: 28 },
    text: () => dummyDoc.text,
    children: () => [],
    namedChildren: () => [],
    childForField: () => undefined,
    parent: () => undefined
  };

  const dummyParsed: ParsedDocument = {
    source: dummyDoc,
    root: dummyNode,
    issues: [],
    dispose: () => {}
  };

  const dummyObservation: ApiObservation = {
    id: "obs-1",
    role: "consumer",
    languageId: "typescript",
    extractorId: "test-extractor",
    source: [
      {
        uri: dummyDoc.uri,
        range: { start: 0, end: 28 },
        start: { line: 0, character: 0 },
        end: { line: 0, character: 28 }
      }
    ],
    snapshot: {
      uri: dummyDoc.uri,
      contentHash: dummyDoc.contentHash
    },
    endpoint: {
      method: {
        state: "known",
        value: "GET",
        evidence: {
          id: "ev-1",
          kind: "literal-syntax",
          strength: "direct",
          source: {
            uri: dummyDoc.uri,
            range: { start: 0, end: 28 },
            start: { line: 0, character: 0 },
            end: { line: 0, character: 28 }
          }
        }
      },
      path: {
        state: "known",
        value: {
          segments: [{ kind: "static", value: "users" }],
          trailingSlash: "absent",
          queryHandling: "excluded-from-path",
          rawPath: "/users"
        },
        evidence: {
          id: "ev-2",
          kind: "literal-syntax",
          strength: "direct",
          source: {
            uri: dummyDoc.uri,
            range: { start: 0, end: 28 },
            start: { line: 0, character: 0 },
            end: { line: 0, character: 28 }
          }
        }
      }
    },
    limitations: []
  };

  const dummyWarning: AnalysisWarning = {
    code: "UNRESOLVED_REFERENCE",
    message: "Dynamic reference could not be resolved",
    affectsCompleteness: true
  };

  describe("1. Contract Conformance and Implementation", () => {
    it("allows implementing AnalyzerPort with LanguageAnalyzerPort type compatibility", () => {
      class MockAnalyzer implements AnalyzerPort {
        readonly id = "mock-analyzer";

        supports(languageId: string, uri: DocumentUri): boolean {
          return languageId === "typescript" && uri.endsWith(".ts");
        }

        async analyze(input: AnalyzerInput, signal?: AbortSignal): Promise<AnalyzerOutput> {
          signal?.throwIfAborted();
          return {
            observations: [dummyObservation],
            warnings: []
          };
        }
      }

      const analyzer: LanguageAnalyzerPort = new MockAnalyzer();
      expect(analyzer.id).toBe("mock-analyzer");
      expect(analyzer.supports("typescript", "file:///app.ts")).toBe(true);
      expect(analyzer.supports("javascript", "file:///app.js")).toBe(false);
    });

    it("accepts AnalyzerInput with document, parsed syntax tree, projectIndex, and config", async () => {
      const mockIndex: ProjectIndexView = {
        getDocument: (uri: DocumentUri) => (uri === dummyDoc.uri ? dummyDoc : undefined),
        lookupSymbol: (name: string) => (name === "api" ? { type: "string" } : undefined)
      };

      const mockConfig: ResolvedUndriftConfig = {
        version: 1,
        include: ["src/**/*"],
        exclude: ["node_modules/**"],
        analyzers: {
          "mock-analyzer": true
        }
      };

      const input: AnalyzerInput = {
        document: dummyDoc,
        parsed: dummyParsed,
        projectIndex: mockIndex,
        config: mockConfig
      };

      expect(input.document.uri).toBe("file:///workspace/src/app.ts");
      expect(input.parsed.root.kind).toBe("program");
      expect(input.projectIndex.getDocument?.("file:///workspace/src/app.ts")).toBe(dummyDoc);
      expect(input.projectIndex.lookupSymbol?.("api")).toEqual({ type: "string" });
      expect(input.config.version).toBe(1);
    });

    it("accepts minimal valid fixtures for projectIndex and config on AnalyzerInput", () => {
      const minimalIndex: ProjectIndexView = {};
      const minimalConfig: ResolvedUndriftConfig = {};

      const minimalInput: AnalyzerInput = {
        document: dummyDoc,
        parsed: dummyParsed,
        projectIndex: minimalIndex,
        config: minimalConfig
      };

      expect(minimalInput.document).toBeDefined();
      expect(minimalInput.parsed).toBeDefined();
      expect(minimalInput.projectIndex).toBe(minimalIndex);
      expect(minimalInput.config).toBe(minimalConfig);
    });

    it("structures AnalyzerOutput to contain both extracted observations and analysis warnings", () => {
      const output: AnalyzerOutput = {
        observations: [dummyObservation],
        warnings: [dummyWarning]
      };

      expect(output.observations).toHaveLength(1);
      expect(output.observations[0].id).toBe("obs-1");
      expect(output.warnings).toHaveLength(1);
      expect(output.warnings[0].code).toBe("UNRESOLVED_REFERENCE");
      expect(output.warnings[0].affectsCompleteness).toBe(true);
    });
  });

  describe("2. Cancellation and Signal Semantics", () => {
    it("respects AbortSignal cancellation during analyzer execution", async () => {
      const controller = new AbortController();
      controller.abort();

      const cancellableAnalyzer: AnalyzerPort = {
        id: "cancellable-analyzer",
        supports: () => true,
        analyze: async (_input: AnalyzerInput, signal?: AbortSignal) => {
          signal?.throwIfAborted();
          return { observations: [], warnings: [] };
        }
      };

      const input: AnalyzerInput = {
        document: dummyDoc,
        parsed: dummyParsed,
        projectIndex: {},
        config: {}
      };

      await expect(cancellableAnalyzer.analyze(input, controller.signal)).rejects.toThrow();
    });
  });
});
