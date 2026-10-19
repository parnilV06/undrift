// Phase 2, Chunk 2.3: Analyzer Registry Unit Tests.
// Verifies analyzer registration, duplicate identification handling, invalid registration guards,
// deterministic selection order, and unsupported document behavior.

import { describe, expect, it } from "vitest";
import {
  AnalyzerRegistrationError,
  AnalyzerRegistry
} from "../../packages/analyzer-js-ts/src/index";
import type {
  AnalyzerInput,
  AnalyzerOutput,
  DocumentUri,
  LanguageAnalyzerPort,
  ParsedDocument,
  ProjectIndexView,
  ResolvedUndriftConfig,
  SourceDocument,
  SyntaxNode
} from "../../packages/core/src/index";

describe("AnalyzerRegistry (Chunk 2.3)", () => {
  const dummyDoc: SourceDocument = {
    uri: "file:///workspace/src/app.ts",
    languageId: "typescript",
    text: "console.log('hello');",
    contentHash: "hash-12345"
  };

  const dummyNode: SyntaxNode = {
    kind: "program",
    range: { start: 0, end: 21 },
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

  const dummyIndex: ProjectIndexView = {};
  const dummyConfig: ResolvedUndriftConfig = {};

  const createMockAnalyzer = (
    id: string,
    supportedLanguages: readonly string[],
    supportedExtensions?: readonly string[]
  ): LanguageAnalyzerPort => ({
    id,
    supports: (languageId: string, uri: DocumentUri): boolean => {
      if (supportedLanguages.includes(languageId)) {
        return true;
      }
      if (supportedExtensions) {
        return supportedExtensions.some((ext) => uri.endsWith(ext));
      }
      return false;
    },
    analyze: async (input: AnalyzerInput, signal?: AbortSignal): Promise<AnalyzerOutput> => {
      signal?.throwIfAborted();
      // Verifies that required input fields are present
      if (!input.document || !input.parsed || !input.projectIndex || !input.config) {
        throw new Error("Missing required AnalyzerInput properties");
      }
      return { observations: [], warnings: [] };
    }
  });

  describe("1. Registration and Querying", () => {
    it("starts empty and reports count of 0", () => {
      const registry = new AnalyzerRegistry();
      expect(registry.count).toBe(0);
      expect(registry.getAll()).toHaveLength(0);
      expect(registry.get("any-id")).toBeUndefined();
      expect(registry.has("any-id")).toBe(false);
    });

    it("registers and retrieves an analyzer by id", () => {
      const registry = new AnalyzerRegistry();
      const analyzer = createMockAnalyzer("ts-analyzer", ["typescript"]);

      registry.register(analyzer);

      expect(registry.count).toBe(1);
      expect(registry.has("ts-analyzer")).toBe(true);
      expect(registry.get("ts-analyzer")).toBe(analyzer);
      expect(registry.getAll()).toEqual([analyzer]);
    });

    it("accepts an initial list of analyzers in constructor", () => {
      const a1 = createMockAnalyzer("a1", ["typescript"]);
      const a2 = createMockAnalyzer("a2", ["javascript"]);

      const registry = new AnalyzerRegistry([a1, a2]);

      expect(registry.count).toBe(2);
      expect(registry.get("a1")).toBe(a1);
      expect(registry.get("a2")).toBe(a2);
      expect(registry.getAll()).toEqual([a1, a2]);
    });

    it("supports unregistering an analyzer by id", () => {
      const registry = new AnalyzerRegistry();
      const analyzer = createMockAnalyzer("temp-analyzer", ["typescript"]);

      registry.register(analyzer);
      expect(registry.has("temp-analyzer")).toBe(true);

      const removed = registry.deregister("temp-analyzer");
      expect(removed).toBe(true);
      expect(registry.has("temp-analyzer")).toBe(false);
      expect(registry.count).toBe(0);

      expect(registry.deregister("temp-analyzer")).toBe(false);
    });

    it("supports clearing all registered analyzers", () => {
      const registry = new AnalyzerRegistry([
        createMockAnalyzer("a1", ["typescript"]),
        createMockAnalyzer("a2", ["javascript"])
      ]);

      expect(registry.count).toBe(2);
      registry.clear();
      expect(registry.count).toBe(0);
      expect(registry.getAll()).toHaveLength(0);
    });
  });

  describe("2. Error Handling and Validation", () => {
    it("throws AnalyzerRegistrationError on duplicate analyzer IDs", () => {
      const registry = new AnalyzerRegistry();
      const first = createMockAnalyzer("duplicate-id", ["typescript"]);
      const second = createMockAnalyzer("duplicate-id", ["javascript"]);

      registry.register(first);

      expect(() => registry.register(second)).toThrow(AnalyzerRegistrationError);
      expect(() => registry.register(second)).toThrow(/already registered/);
      expect(registry.count).toBe(1);
    });

    it("throws AnalyzerRegistrationError for invalid or null registrations", () => {
      const registry = new AnalyzerRegistry();

      expect(() => registry.register(null as unknown as LanguageAnalyzerPort)).toThrow(
        AnalyzerRegistrationError
      );
      expect(() => registry.register(undefined as unknown as LanguageAnalyzerPort)).toThrow(
        AnalyzerRegistrationError
      );
    });

    it("throws AnalyzerRegistrationError for missing or empty analyzer ID", () => {
      const registry = new AnalyzerRegistry();

      const noId = {
        supports: () => true,
        analyze: async () => ({ observations: [], warnings: [] })
      } as unknown as LanguageAnalyzerPort;

      const emptyId = {
        id: "   ",
        supports: () => true,
        analyze: async () => ({ observations: [], warnings: [] })
      } as LanguageAnalyzerPort;

      expect(() => registry.register(noId)).toThrow(AnalyzerRegistrationError);
      expect(() => registry.register(emptyId)).toThrow(AnalyzerRegistrationError);
    });

    it("throws AnalyzerRegistrationError for missing supports or analyze methods", () => {
      const registry = new AnalyzerRegistry();

      const missingSupports = {
        id: "missing-supports",
        analyze: async () => ({ observations: [], warnings: [] })
      } as unknown as LanguageAnalyzerPort;

      const missingAnalyze = {
        id: "missing-analyze",
        supports: () => true
      } as unknown as LanguageAnalyzerPort;

      expect(() => registry.register(missingSupports)).toThrow(AnalyzerRegistrationError);
      expect(() => registry.register(missingAnalyze)).toThrow(AnalyzerRegistrationError);
    });
  });

  describe("3. Analyzer Selection and Determinism", () => {
    it("selects analyzers that support the specified languageId and uri", () => {
      const registry = new AnalyzerRegistry();
      const tsAnalyzer = createMockAnalyzer("ts-analyzer", ["typescript"]);
      const jsAnalyzer = createMockAnalyzer("js-analyzer", ["javascript"]);
      const expressAnalyzer = createMockAnalyzer("express-analyzer", ["typescript", "javascript"]);

      registry.register(tsAnalyzer);
      registry.register(jsAnalyzer);
      registry.register(expressAnalyzer);

      const tsMatches = registry.getAnalyzersFor("typescript", "file:///src/service.ts");
      expect(tsMatches).toEqual([tsAnalyzer, expressAnalyzer]);

      const jsMatches = registry.getAnalyzersFor("javascript", "file:///src/service.js");
      expect(jsMatches).toEqual([jsAnalyzer, expressAnalyzer]);
    });

    it("preserves deterministic registration order during selection", () => {
      const registry = new AnalyzerRegistry();
      const a = createMockAnalyzer("first-analyzer", ["typescript"]);
      const b = createMockAnalyzer("second-analyzer", ["typescript"]);
      const c = createMockAnalyzer("third-analyzer", ["typescript"]);

      registry.register(a);
      registry.register(b);
      registry.register(c);

      const selected = registry.getAnalyzersFor("typescript", "file:///src/file.ts");
      expect(selected).toEqual([a, b, c]);
      expect(selected.map((s) => s.id)).toEqual([
        "first-analyzer",
        "second-analyzer",
        "third-analyzer"
      ]);
    });

    it("returns an empty array for unsupported documents without throwing", () => {
      const registry = new AnalyzerRegistry();
      const tsAnalyzer = createMockAnalyzer("ts-analyzer", ["typescript"]);

      registry.register(tsAnalyzer);

      const pythonMatches = registry.getAnalyzersFor("python", "file:///src/script.py");
      expect(pythonMatches).toEqual([]);
      expect(pythonMatches).toHaveLength(0);
    });

    it("returns an empty array when the registry is empty", () => {
      const registry = new AnalyzerRegistry();
      expect(registry.getAnalyzersFor("typescript", "file:///src/file.ts")).toEqual([]);
    });

    it("executes selected analyzer with full valid AnalyzerInput contract", async () => {
      const registry = new AnalyzerRegistry();
      const analyzer = createMockAnalyzer("ts-analyzer", ["typescript"]);
      registry.register(analyzer);

      const [selected] = registry.getAnalyzersFor("typescript", dummyDoc.uri);
      expect(selected).toBeDefined();

      const input: AnalyzerInput = {
        document: dummyDoc,
        parsed: dummyParsed,
        projectIndex: dummyIndex,
        config: dummyConfig
      };

      const result = await selected.analyze(input);
      expect(result.observations).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });
});
