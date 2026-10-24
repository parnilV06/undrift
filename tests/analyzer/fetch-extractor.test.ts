// Phase 2, Chunk 2.4: Frontend Fetch Call Extractor Unit Tests.
// Tests the real parser, syntax-node facade, and fetch-extractor path across JavaScript
// and TypeScript source documents with exact evidence, source positions, and warnings.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AnalyzerInput,
  ApiObservation,
  DocumentUri,
  ParsedDocument,
  SourceDocument
} from "@undrift/core";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { JsTsAnalyzer, extractFetchObservations } from "../../packages/analyzer-js-ts/src/index";

describe("Frontend Fetch Call Extractor (Chunk 2.4)", () => {
  let parser: TreeSitterParserAdapter;
  let analyzer: JsTsAnalyzer;

  beforeAll(() => {
    parser = new TreeSitterParserAdapter();
    analyzer = new JsTsAnalyzer();
  });

  afterAll(() => {
    parser.dispose();
  });

  // Helper to parse source text into a real ParsedDocument using the Tree-sitter adapter
  async function parseCode(
    text: string,
    languageId: "javascript" | "typescript" = "javascript",
    uri: DocumentUri = "file:///src/app.js"
  ): Promise<{ document: SourceDocument; parsed: ParsedDocument }> {
    const document: SourceDocument = {
      uri,
      languageId,
      text,
      contentHash: `hash-${text.length}`
    };

    const parsed = await parser.parse({ document });
    return { document, parsed };
  }

  // Helper to execute analyzer with minimal required input contracts
  async function analyzeCode(
    text: string,
    languageId: "javascript" | "typescript" = "javascript",
    uri: DocumentUri = "file:///src/app.js",
    signal?: AbortSignal
  ) {
    const { document, parsed } = await parseCode(text, languageId, uri);
    const input: AnalyzerInput = {
      document,
      parsed,
      projectIndex: {},
      config: {}
    };
    return analyzer.analyze(input, signal);
  }

  describe("1. Positive Cases: Standard fetch() Invocations", () => {
    it("extracts basic fetch(url) call in JavaScript with default GET method", async () => {
      const code = 'fetch("/api/users");';
      const output = await analyzeCode(code, "javascript", "file:///src/app.js");

      expect(output.warnings).toHaveLength(0);
      expect(output.observations).toHaveLength(1);

      const obs: ApiObservation = output.observations[0];
      expect(obs.role).toBe("consumer");
      expect(obs.languageId).toBe("javascript");
      expect(obs.framework).toBe("fetch");
      expect(obs.extractorId).toBe("fetch-extractor");
      expect(obs.id).toBe("obs:file:///src/app.js:0-19");

      // Verify Method
      expect(obs.endpoint.method.state).toBe("known");
      if (obs.endpoint.method.state === "known") {
        expect(obs.endpoint.method.value).toBe("GET");
        expect(obs.endpoint.method.strength).toBe("direct");
        expect(obs.endpoint.method.evidence[0].kind).toBe("framework-convention");
      }

      // Verify Path
      expect(obs.endpoint.path.state).toBe("known");
      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/users");
        expect(obs.endpoint.path.value.trailingSlash).toBe("absent");
        expect(obs.endpoint.path.value.queryHandling).toBe("excluded-from-path");
        expect(obs.endpoint.path.value.segments).toEqual([
          { kind: "static", value: "api" },
          { kind: "static", value: "users" }
        ]);
        expect(obs.endpoint.path.strength).toBe("direct");
        expect(obs.endpoint.path.evidence[0].kind).toBe("literal-syntax");
      }

      // Verify Source Position and Snapshot
      expect(obs.source).toHaveLength(1);
      expect(obs.source[0].range).toEqual({ start: 0, end: 19 });
      expect(obs.source[0].start).toEqual({ line: 0, character: 0 });
      expect(obs.source[0].end).toEqual({ line: 0, character: 19 });
      expect(obs.snapshot.uri).toBe("file:///src/app.js");
      expect(obs.limitations).toHaveLength(0);
    });

    it("extracts basic fetch(url) in TypeScript with accurate source positions", async () => {
      const code = 'const res = await fetch("/api/v1/posts");';
      const output = await analyzeCode(code, "typescript", "file:///src/service.ts");

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.languageId).toBe("typescript");
      expect(obs.snapshot.uri).toBe("file:///src/service.ts");

      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/v1/posts");
        expect(obs.endpoint.path.value.segments).toHaveLength(3);
      }
    });

    it("extracts explicit HTTP method options (POST, PUT, DELETE, PATCH)", async () => {
      const methods = ["POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

      for (const method of methods) {
        const code = `fetch("/api/resource", { method: "${method}" });`;
        const output = await analyzeCode(code);

        expect(output.observations).toHaveLength(1);
        const obs = output.observations[0];
        expect(obs.endpoint.method.state).toBe("known");
        if (obs.endpoint.method.state === "known") {
          expect(obs.endpoint.method.value).toBe(method);
          expect(obs.endpoint.method.evidence[0].kind).toBe("literal-syntax");
        }
      }
    });

    it("normalizes lowercase method strings to uppercase", async () => {
      const code = 'fetch("/api/login", { method: "post" });';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      if (obs.endpoint.method.state === "known") {
        expect(obs.endpoint.method.value).toBe("POST");
      }
    });

    it("anchors explicit method evidence to the exact method literal span", async () => {
      const code = 'fetch("/api/users", { method: "GET" });';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.method.state).toBe("known");
      if (obs.endpoint.method.state === "known") {
        const ev = obs.endpoint.method.evidence[0];
        expect(ev.kind).toBe("literal-syntax");
        const literalText = code.slice(ev.source.range.start, ev.source.range.end);
        expect(literalText).toBe('"GET"');
        expect(ev.source.start.line).toBe(0);
        expect(ev.source.start.character).toBe(30);
        expect(ev.source.end.character).toBe(35);
      }
    });

    it("identifies trailing slash and query parameters correctly", async () => {
      const code = 'fetch("/api/users/?sort=desc&limit=10");';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];

      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/users/");
        expect(obs.endpoint.path.value.trailingSlash).toBe("present");
        expect(obs.endpoint.path.value.queryHandling).toBe("excluded-from-path");
      }
    });

    it("identifies route path parameters with colon syntax", async () => {
      const code = 'fetch("/api/users/:userId/roles/:roleId");';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];

      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.segments).toEqual([
          { kind: "static", value: "api" },
          { kind: "static", value: "users" },
          { kind: "parameter", name: "userId" },
          { kind: "static", value: "roles" },
          { kind: "parameter", name: "roleId" }
        ]);
      }
    });

    it("extracts JSON.stringify object literal request body and properties", async () => {
      const code = `fetch("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name: "Alice",
          age: 30,
          isActive: true
        })
      });`;

      const output = await analyzeCode(code);
      expect(output.observations).toHaveLength(1);

      const obs = output.observations[0];
      expect(obs.endpoint.request).toBeDefined();
      expect(obs.endpoint.request?.body).toBeDefined();

      const body = obs.endpoint.request!.body!;
      expect(body.completeness).toBe("complete");
      expect(body.shape.kind).toBe("object");

      if (body.shape.kind === "object") {
        expect(body.shape.properties).toHaveLength(3);
        const propNames = body.shape.properties.map((p) => p.name);
        expect(propNames).toContain("name");
        expect(propNames).toContain("age");
        expect(propNames).toContain("isActive");

        const nameField = body.shape.properties.find((p) => p.name === "name")!;
        expect(nameField.type).toEqual({ kind: "literal", value: "Alice" });
        expect(nameField.presence).toBe("required");
        expect(nameField.nullable).toBe("no");
      }
    });

    it("extracts literal string request body", async () => {
      const code = 'fetch("/api/raw", { method: "POST", body: "raw payload data" });';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const body = output.observations[0].endpoint.request?.body;
      expect(body).toBeDefined();
      expect(body?.shape).toEqual({ kind: "primitive", name: "string" });
      expect(body?.completeness).toBe("complete");
    });

    it("extracts multiple distinct fetch calls in a single file", async () => {
      const code = `
        fetch("/api/users");
        fetch("/api/posts", { method: "POST" });
        fetch("/api/settings", { method: "PUT" });
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(3);
      expect(output.observations[0].endpoint.path.state).toBe("known");
      expect(output.observations[1].endpoint.path.state).toBe("known");
      expect(output.observations[2].endpoint.path.state).toBe("known");

      if (
        output.observations[0].endpoint.path.state === "known" &&
        output.observations[1].endpoint.path.state === "known" &&
        output.observations[2].endpoint.path.state === "known"
      ) {
        expect(output.observations[0].endpoint.path.value.rawPath).toBe("/api/users");
        expect(output.observations[1].endpoint.path.value.rawPath).toBe("/api/posts");
        expect(output.observations[2].endpoint.path.value.rawPath).toBe("/api/settings");
      }

      // Ensure distinct IDs and source spans
      const ids = output.observations.map((o) => o.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("recognizes window.fetch and globalThis.fetch global references", async () => {
      const code = `
        window.fetch("/api/window-call");
        globalThis.fetch("/api/global-call");
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(2);
      if (
        output.observations[0].endpoint.path.state === "known" &&
        output.observations[1].endpoint.path.state === "known"
      ) {
        expect(output.observations[0].endpoint.path.value.rawPath).toBe("/api/window-call");
        expect(output.observations[1].endpoint.path.value.rawPath).toBe("/api/global-call");
      }
    });

    it("extracts static template string literal without substitutions", async () => {
      const code = "fetch(`/api/static-template`);";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.path.state).toBe("known");
      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/static-template");
      }
    });
  });

  describe("2. Uncertainty and Negative Cases", () => {
    it("marks dynamic variable URL expression as dynamic with DYNAMIC_ROUTE warning", async () => {
      const code = "fetch(apiEndpointUrl);";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      expect(output.warnings).toHaveLength(1);

      const obs = output.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
      if (obs.endpoint.path.state === "dynamic") {
        expect(obs.endpoint.path.expression).toBe("apiEndpointUrl");
      }

      expect(obs.limitations).toHaveLength(1);
      expect(obs.limitations[0].code).toBe("DYNAMIC_ROUTE");
      expect(obs.limitations[0].affectsCompleteness).toBe(true);
      expect(output.warnings[0].code).toBe("DYNAMIC_ROUTE");
    });

    it("marks dynamic template string with interpolation as dynamic with warning", async () => {
      const code = "fetch(`/api/users/${userId}/details`);";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
      expect(obs.limitations[0].code).toBe("DYNAMIC_ROUTE");
    });

    it("marks non-object options argument as dynamic with UNSUPPORTED_PATTERN warning", async () => {
      const code = 'fetch("/api/users", customFetchOptions);';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.method.state).toBe("dynamic");
      expect(obs.limitations[0].code).toBe("UNSUPPORTED_PATTERN");
    });

    it("marks dynamic method expression as dynamic with UNSUPPORTED_PATTERN warning", async () => {
      const code = 'fetch("/api/users", { method: getMethod() });';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.method.state).toBe("dynamic");
      expect(obs.limitations[0].code).toBe("UNSUPPORTED_PATTERN");
    });

    it("marks unresolved JSON.stringify payload variable with PARTIAL_SHAPE warning", async () => {
      const code = 'fetch("/api/users", { method: "POST", body: JSON.stringify(userData) });';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      const body = obs.endpoint.request?.body;
      expect(body).toBeDefined();
      expect(body?.completeness).toBe("partial");
      expect(body?.shape).toEqual({ kind: "unknown", reason: "unresolved-reference" });
      expect(obs.limitations[0].code).toBe("PARTIAL_SHAPE");
    });

    it("emits warning for fetch() called without arguments", async () => {
      const code = "fetch();";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(1);
      expect(output.warnings[0].code).toBe("UNSUPPORTED_PATTERN");
    });

    it("gracefully tolerates syntax errors elsewhere in document", async () => {
      const code = `
        const malformed = ;
        fetch("/api/surviving-call");
      `;
      const output = await analyzeCode(code);

      // Tree-sitter error recovery isolates the broken statement and extracts the valid call
      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/surviving-call");
      }
    });

    it("does not extract axios calls as standard fetch calls", async () => {
      const code = `
        axios.get("/api/users");
        axios.post("/api/posts", { title: "Hello" });
      `;
      const { document, parsed } = await parseCode(code);
      const fetchResult = extractFetchObservations(document, parsed);

      expect(fetchResult.observations).toHaveLength(0);
      expect(fetchResult.warnings).toHaveLength(0);

      // Verify integrated analyzer does not emit any fetch observations for axios calls
      const output = await analyzeCode(code);
      const fetchObservations = output.observations.filter((o) => o.framework === "fetch");
      expect(fetchObservations).toHaveLength(0);
    });

    it("does not extract custom client member calls or unrelated function names", async () => {
      const code = `
        apiClient.fetch("/api/users");
        customFetch("/api/users");
        fetcher("/api/users");
        const fetch = "/api/not-a-call";
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(0);
    });

    it("does not extract commented-out fetch calls", async () => {
      const code = `
        // fetch("/api/commented");
        /* fetch("/api/block-commented"); */
        const str = 'fetch("/api/in-string")';
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(0);
    });

    it("respects cancellation via AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        analyzeCode('fetch("/api/users");', "javascript", "file:///src/app.js", controller.signal)
      ).rejects.toThrow();
    });
  });

  describe("3. Support and Registration Integration", () => {
    it("reports supports() = true for JS, TS, and JSX/TSX documents", () => {
      expect(analyzer.supports("javascript", "file:///src/app.js")).toBe(true);
      expect(analyzer.supports("typescript", "file:///src/app.ts")).toBe(true);
      expect(analyzer.supports("javascriptreact", "file:///src/app.jsx")).toBe(true);
      expect(analyzer.supports("typescriptreact", "file:///src/app.tsx")).toBe(true);
      expect(analyzer.supports("", "file:///src/app.mjs")).toBe(true);
      expect(analyzer.supports("", "file:///src/app.cjs")).toBe(true);

      // Unsupported languages
      expect(analyzer.supports("python", "file:///src/app.py")).toBe(false);
      expect(analyzer.supports("go", "file:///src/main.go")).toBe(false);
      expect(analyzer.supports("rust", "file:///src/main.rs")).toBe(false);
    });
  });
});
