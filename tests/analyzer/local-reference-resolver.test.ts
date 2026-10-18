// Phase 2, Chunk 2.8: Local Reference Resolver Unit Tests.
// Tests resolution of local references to constant declarations, distinguishing
// direct literals, resolved references, dynamic values, and deferred POC gates.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  DocumentUri,
  ParsedDocument,
  SemanticResolutionRequest,
  SourceDocument
} from "@undrift/core";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import {
  LocalDeclarationIndex,
  LocalReferenceResolver,
  createLocalDeclarationIndex,
  createLocalReferenceResolver
} from "../../packages/analyzer-js-ts/src/index";

describe("LocalReferenceResolver (Chunk 2.8)", () => {
  let parser: TreeSitterParserAdapter;

  beforeAll(() => {
    parser = new TreeSitterParserAdapter();
  });

  afterAll(() => {
    parser.dispose();
  });

  async function parseAndIndex(
    text: string,
    languageId: "javascript" | "typescript" = "javascript",
    uri: DocumentUri = "file:///src/routes.js"
  ): Promise<{
    document: SourceDocument;
    parsed: ParsedDocument;
    index: LocalDeclarationIndex;
    resolver: LocalReferenceResolver;
  }> {
    const document: SourceDocument = {
      uri,
      languageId,
      text,
      contentHash: `hash-${text.length}`
    };

    const parsed = await parser.parse({ document });
    const index = createLocalDeclarationIndex([{ document, parsed }]);
    const resolver = createLocalReferenceResolver(index);

    return { document, parsed, index, resolver };
  }

  describe("1. Resolving Direct Local Constant Literals", () => {
    it("resolves string literal constant with 'resolved' evidence strength", async () => {
      const code = `
        const API_PATH = "/api/v1/users";
        fetch(API_PATH);
      `;
      const { document, resolver } = await parseAndIndex(code);

      const refRange = {
        start: code.indexOf("API_PATH", 25),
        end: code.indexOf("API_PATH", 25) + 8
      };
      const result = resolver.resolveConstant<string>("API_PATH", document.uri, refRange);

      expect(result.state).toBe("resolved");
      if (result.state === "resolved") {
        expect(result.value).toBe("/api/v1/users");
        expect(result.declaration.name).toBe("API_PATH");
        expect(result.declaration.documentUri).toBe(document.uri);
        expect(result.declaration.snapshotHash).toBe(document.contentHash);

        // Verify evidence
        expect(result.evidence).toHaveLength(2);
        const resolutionEvidence = result.evidence[0];
        expect(resolutionEvidence.kind).toBe("local-declaration");
        expect(resolutionEvidence.strength).toBe("resolved");
        expect(resolutionEvidence.source.range).toEqual(refRange);

        const declEvidence = result.evidence[1];
        expect(declEvidence.strength).toBe("direct");
      }
    });

    it("resolves number, boolean, and null constants", async () => {
      const code = `
        const DEFAULT_PORT = 3000;
        const IS_ENABLED = true;
        const INITIAL_DATA = null;
      `;
      const { document, resolver } = await parseAndIndex(code);

      const portRes = resolver.resolveConstant<number>("DEFAULT_PORT", document.uri);
      expect(portRes.state).toBe("resolved");
      if (portRes.state === "resolved") {
        expect(portRes.value).toBe(3000);
      }

      const boolRes = resolver.resolveConstant<boolean>("IS_ENABLED", document.uri);
      expect(boolRes.state).toBe("resolved");
      if (boolRes.state === "resolved") {
        expect(boolRes.value).toBe(true);
      }

      const nullRes = resolver.resolveConstant<null>("INITIAL_DATA", document.uri);
      expect(nullRes.state).toBe("resolved");
      if (nullRes.state === "resolved") {
        expect(nullRes.value).toBeNull();
      }
    });

    it("transforms resolved constant into canonical ObservedValue with known state", async () => {
      const code = 'const BASE_URL = "/api";';
      const { document, resolver } = await parseAndIndex(code);

      const obs = resolver.resolveObservedConstant<string>("BASE_URL", document.uri);
      expect(obs.state).toBe("known");
      if (obs.state === "known") {
        expect(obs.value).toBe("/api");
        expect(obs.strength).toBe("resolved");
        expect(obs.evidence[0].strength).toBe("resolved");
      }
    });
  });

  describe("2. Non-Constant and Dynamic Initializers", () => {
    it("returns 'unresolved' for mutable let and var variables", async () => {
      const code = `
        let mutableRoute = "/api/v1";
        var legacyRoute = "/api/v2";
      `;
      const { document, resolver } = await parseAndIndex(code);

      const letRes = resolver.resolveConstant("mutableRoute", document.uri);
      expect(letRes.state).toBe("unresolved");
      if (letRes.state === "unresolved") {
        expect(letRes.reason).toContain("mutable 'let'");
        expect(letRes.declaration?.name).toBe("mutableRoute");
      }

      const varRes = resolver.resolveConstant("legacyRoute", document.uri);
      expect(varRes.state).toBe("unresolved");
      if (varRes.state === "unresolved") {
        expect(varRes.reason).toContain("mutable 'var'");
      }
    });

    it("returns 'unresolved' for constant initialized with dynamic expression", async () => {
      const code = 'const dynamicPath = getDynamicPath("/users");';
      const { document, resolver } = await parseAndIndex(code);

      const result = resolver.resolveConstant("dynamicPath", document.uri);
      expect(result.state).toBe("unresolved");
      if (result.state === "unresolved") {
        expect(result.reason).toContain("dynamic expression 'getDynamicPath(\"/users\")'");
      }
    });

    it("transforms dynamic and unresolved initializers into unknown ObservedValue", async () => {
      const code = "let dynamicVal = 42;";
      const { document, resolver } = await parseAndIndex(code);

      const obs = resolver.resolveObservedConstant("dynamicVal", document.uri);
      expect(obs.state).toBe("unknown");
    });
  });

  describe("3. Missing and Ambiguous References", () => {
    it("returns 'unresolved' when reference identifier is not declared", async () => {
      const code = 'fetch("/api/users");';
      const { document, resolver } = await parseAndIndex(code);

      const result = resolver.resolveConstant("UNDECLARED_VAR", document.uri);
      expect(result.state).toBe("unresolved");
      if (result.state === "unresolved") {
        expect(result.reason).toContain("does not match any declaration");
      }
    });

    it("preserves ambiguity when multiple declarations share the same name in the same file", async () => {
      const code = `
        const PATH = "/first";
        {
          const PATH = "/second";
        }
      `;
      const { document, resolver } = await parseAndIndex(code);

      const result = resolver.resolveConstant("PATH", document.uri);
      expect(result.state).toBe("ambiguous");
      if (result.state === "ambiguous") {
        expect(result.reason).toContain("conflicting declarations");
        expect(result.candidates).toHaveLength(2);
      }
    });

    it("transforms ambiguous reference into unknown ObservedValue", async () => {
      const code = "const DUP = 1; { const DUP = 2; }";
      const { document, resolver } = await parseAndIndex(code);

      const obs = resolver.resolveObservedConstant("DUP", document.uri);
      expect(obs.state).toBe("unknown");
    });
  });

  describe("4. Deferred POC Gates and Non-Value Symbols", () => {
    it("returns 'unsupported' for imported symbols (ES module import)", async () => {
      const code = 'import { API_HOST } from "./config";';
      const { document, resolver } = await parseAndIndex(code);

      const result = resolver.resolveConstant("API_HOST", document.uri);
      expect(result.state).toBe("unsupported");
      if (result.state === "unsupported") {
        expect(result.reason).toContain("Cross-file import dereferencing");
        expect(result.reason).toContain("POC GATE");
      }
    });

    it("returns 'unsupported' for CommonJS require import bindings", async () => {
      const code = 'const { BASE_URL } = require("./config");';
      const { document, resolver } = await parseAndIndex(code);

      const result = resolver.resolveConstant("BASE_URL", document.uri);
      expect(result.state).toBe("unsupported");
      if (result.state === "unsupported") {
        expect(result.reason).toContain("Cross-file import dereferencing");
        expect(result.reason).toContain("POC GATE");
      }
    });

    it("returns 'unsupported' for cross-file symbols present only in another document", async () => {
      const doc1 = {
        uri: "file:///src/file1.js",
        languageId: "javascript",
        text: 'const REMOTE_VAL = "remote";',
        contentHash: "hash1"
      };
      const doc2 = {
        uri: "file:///src/file2.js",
        languageId: "javascript",
        text: "console.log(REMOTE_VAL);",
        contentHash: "hash2"
      };

      const parsed1 = await parser.parse({ document: doc1 });
      const parsed2 = await parser.parse({ document: doc2 });

      const index = createLocalDeclarationIndex([
        { document: doc1, parsed: parsed1 },
        { document: doc2, parsed: parsed2 }
      ]);
      const resolver = createLocalReferenceResolver(index);

      // Query from file2 for symbol defined in file1
      const result = resolver.resolveConstant("REMOTE_VAL", doc2.uri);
      expect(result.state).toBe("unsupported");
      if (result.state === "unsupported") {
        expect(result.reason).toContain("Cross-file symbol resolution");
        expect(result.reason).toContain("POC GATE");
      }
    });

    it("returns 'unsupported' when identifier refers to a function or type declaration", async () => {
      const code = `
        function routeHandler() {}
        interface UserConfig {}
      `;
      const { document, resolver } = await parseAndIndex(
        code,
        "typescript",
        "file:///src/types.ts"
      );

      const funcRes = resolver.resolveConstant("routeHandler", document.uri);
      expect(funcRes.state).toBe("unsupported");
      if (funcRes.state === "unsupported") {
        expect(funcRes.reason).toContain("function declaration");
      }

      const typeRes = resolver.resolveConstant("UserConfig", document.uri);
      expect(typeRes.state).toBe("unsupported");
      if (typeRes.state === "unsupported") {
        expect(typeRes.reason).toContain("type declaration");
      }
    });
  });

  describe("5. SemanticResolverPort Conformance (resolveType)", () => {
    it("resolves local interface and type alias references according to LLD Section 5.3", async () => {
      const code = `
        interface ApiResponse { id: string; }
        type Status = "active";
        type RawNumber = number;
      `;
      const { document, resolver, index } = await parseAndIndex(
        code,
        "typescript",
        "file:///src/models.ts"
      );

      const request: SemanticResolutionRequest = {
        document,
        referenceName: "ApiResponse",
        fromRange: { start: 0, end: 11 },
        projectIndex: index
      };

      const ifaceRes = await resolver.resolveType(request);
      expect(ifaceRes.state).toBe("resolved");
      if (ifaceRes.state === "resolved") {
        expect(ifaceRes.shape?.kind).toBe("reference");
        expect(ifaceRes.declaration?.uri).toBe(document.uri);
      }

      const primReq: SemanticResolutionRequest = {
        document,
        referenceName: "RawNumber",
        fromRange: { start: 0, end: 9 },
        projectIndex: index
      };
      const primRes = await resolver.resolveType(primReq);
      expect(primRes.state).toBe("resolved");
      if (primRes.state === "resolved") {
        expect(primRes.shape?.kind).toBe("primitive");
      }
    });

    it("respects cancellation via AbortSignal", async () => {
      const code = "interface User {}";
      const { document, resolver, index } = await parseAndIndex(
        code,
        "typescript",
        "file:///types.ts"
      );

      const controller = new AbortController();
      controller.abort();

      const request: SemanticResolutionRequest = {
        document,
        referenceName: "User",
        fromRange: { start: 0, end: 4 },
        projectIndex: index
      };

      await expect(resolver.resolveType(request, controller.signal)).rejects.toThrow();
    });
  });
});
