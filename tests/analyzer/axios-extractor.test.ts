// Phase 2, Chunk 2.5: Frontend Axios Call Extractor Unit Tests.
// Tests the real parser, syntax-node facade, and Axios-extractor path across JavaScript
// and TypeScript source documents with exact evidence, source positions, response types, and warnings.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AnalyzerInput,
  ApiObservation,
  DocumentUri,
  ParsedDocument,
  SourceDocument
} from "@undrift/core";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { JsTsAnalyzer } from "../../packages/analyzer-js-ts/src/index";

describe("Frontend Axios Call Extractor (Chunk 2.5)", () => {
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
      config: {
        rules: {},
        environments: {}
      }
    };

    return analyzer.analyze(input, signal);
  }

  describe("1. Positive Cases", () => {
    it("extracts basic axios.get(url) with default GET method, direct evidence, and positions", async () => {
      const code = 'axios.get("/api/users");';
      const output = await analyzeCode(code, "javascript", "file:///src/app.js");

      expect(output.warnings).toHaveLength(0);
      expect(output.observations).toHaveLength(1);

      const obs: ApiObservation = output.observations[0];
      expect(obs.role).toBe("consumer");
      expect(obs.languageId).toBe("javascript");
      expect(obs.framework).toBe("axios");
      expect(obs.extractorId).toBe("axios-extractor");
      expect(obs.id).toBe("obs:file:///src/app.js:0-23");

      // Verify Method
      expect(obs.endpoint.method.state).toBe("known");
      if (obs.endpoint.method.state === "known") {
        expect(obs.endpoint.method.value).toBe("GET");
        expect(obs.endpoint.method.strength).toBe("direct");
        expect(obs.endpoint.method.evidence[0].kind).toBe("literal-syntax");
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
      expect(obs.source[0].range).toEqual({ start: 0, end: 23 });
      expect(obs.source[0].start).toEqual({ line: 0, character: 0 });
      expect(obs.source[0].end).toEqual({ line: 0, character: 23 });
      expect(obs.snapshot.uri).toBe("file:///src/app.js");
      expect(obs.limitations).toHaveLength(0);
    });

    it("extracts axios.post(url, payload) with object literal request body", async () => {
      const code = `axios.post("/api/users", {
        name: "Alice",
        age: 30,
        isActive: true
      });`;
      const output = await analyzeCode(code);

      expect(output.warnings).toHaveLength(0);
      expect(output.observations).toHaveLength(1);

      const obs = output.observations[0];
      expect(obs.endpoint.method.state).toBe("known");
      if (obs.endpoint.method.state === "known") {
        expect(obs.endpoint.method.value).toBe("POST");
      }

      expect(obs.endpoint.request?.body).toBeDefined();
      const body = obs.endpoint.request!.body!;
      expect(body.completeness).toBe("complete");
      expect(body.shape.kind).toBe("object");

      if (body.shape.kind === "object") {
        expect(body.shape.additionalProperties).toBe("unknown");
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

    it("extracts supported HTTP methods: put, delete, patch, head, options", async () => {
      const cases: Array<{ code: string; expectedMethod: string }> = [
        { code: 'axios.put("/api/users/1", { name: "Bob" });', expectedMethod: "PUT" },
        { code: 'axios.delete("/api/users/1");', expectedMethod: "DELETE" },
        { code: 'axios.patch("/api/users/1", { role: "admin" });', expectedMethod: "PATCH" },
        { code: 'axios.head("/api/users");', expectedMethod: "HEAD" },
        { code: 'axios.options("/api/users");', expectedMethod: "OPTIONS" }
      ];

      for (const { code, expectedMethod } of cases) {
        const output = await analyzeCode(code);
        expect(output.observations).toHaveLength(1);
        const obs = output.observations[0];
        expect(obs.endpoint.method.state).toBe("known");
        if (obs.endpoint.method.state === "known") {
          expect(obs.endpoint.method.value).toBe(expectedMethod);
        }
      }
    });

    it("extracts literal string request body in axios.post", async () => {
      const code = 'axios.post("/api/raw", "raw text payload");';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const body = output.observations[0].endpoint.request?.body;
      expect(body).toBeDefined();
      expect(body?.shape).toEqual({ kind: "primitive", name: "string" });
      expect(body?.completeness).toBe("complete");
    });

    it("identifies trailing slash and query parameters correctly", async () => {
      const code = 'axios.get("/api/users/?sort=desc&limit=10");';
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
      const code = 'axios.get("/api/users/:userId/posts/:postId");';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];

      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.segments).toEqual([
          { kind: "static", value: "api" },
          { kind: "static", value: "users" },
          { kind: "parameter", name: "userId" },
          { kind: "static", value: "posts" },
          { kind: "parameter", name: "postId" }
        ]);
      }
    });

    it("extracts TypeScript generic response type array (axios.get<User[]>(url))", async () => {
      const code = 'axios.get<User[]>("/api/users");';
      const output = await analyzeCode(code, "typescript", "file:///src/api.ts");

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.languageId).toBe("typescript");
      expect(obs.endpoint.responses).toHaveLength(1);

      const responseObs = obs.endpoint.responses![0];
      expect(responseObs.body).toBeDefined();
      expect(responseObs.body!.completeness).toBe("complete");
      expect(responseObs.body!.shape).toEqual({
        kind: "array",
        element: {
          kind: "reference",
          displayName: "User",
          resolution: "unresolved"
        }
      });
      expect(responseObs.body!.evidence[0].kind).toBe("literal-syntax");
      expect(responseObs.body!.evidence[0].strength).toBe("direct");
    });

    it("extracts TypeScript generic response type single reference (axios.get<User>(url))", async () => {
      const code = 'axios.get<User>("/api/users/1");';
      const output = await analyzeCode(code, "typescript", "file:///src/api.ts");

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.responses).toHaveLength(1);

      const responseObs = obs.endpoint.responses![0];
      expect(responseObs.body?.shape).toEqual({
        kind: "reference",
        displayName: "User",
        resolution: "unresolved"
      });
    });

    it("extracts configured client pattern api.get<User>(url) with inferred evidence", async () => {
      const code = 'api.get<User>("/api/users/:id");';
      const output = await analyzeCode(code, "typescript", "file:///src/client.ts");

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.framework).toBe("axios");
      expect(obs.endpoint.method.state).toBe("known");
      if (obs.endpoint.method.state === "known") {
        expect(obs.endpoint.method.value).toBe("GET");
        expect(obs.endpoint.method.strength).toBe("inferred");
      }
      expect(obs.endpoint.responses).toHaveLength(1);
    });

    it("recognizes window.axios and globalThis.axios global references", async () => {
      const code = `
        window.axios.get("/api/window-call");
        globalThis.axios.post("/api/global-call", { data: 1 });
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(2);
      expect(output.observations[0].endpoint.path.state).toBe("known");
      expect(output.observations[1].endpoint.path.state).toBe("known");
    });

    it("extracts static template string literal without substitutions", async () => {
      const code = "axios.get(`/api/static-template`);";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.path.state).toBe("known");
      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/static-template");
      }
    });

    it("extracts multiple distinct Axios calls in a single file", async () => {
      const code = `
        axios.get("/api/users");
        axios.post("/api/posts", { title: "Hello" });
        axios.delete("/api/settings");
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(3);
      const ids = output.observations.map((o) => o.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe("2. Uncertainty and Negative Cases", () => {
    it("marks dynamic variable URL expression as dynamic with DYNAMIC_ROUTE warning", async () => {
      const code = "axios.get(apiEndpointUrl);";
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
      const code = "axios.get(`/api/users/${userId}/details`);";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
      expect(obs.limitations[0].code).toBe("DYNAMIC_ROUTE");
    });

    it("marks unresolved payload variable with PARTIAL_SHAPE warning", async () => {
      const code = 'axios.post("/api/users", userData);';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      const body = obs.endpoint.request?.body;
      expect(body).toBeDefined();
      expect(body?.completeness).toBe("partial");
      expect(body?.shape).toEqual({ kind: "unknown", reason: "unresolved-reference" });
      expect(obs.limitations[0].code).toBe("PARTIAL_SHAPE");
      expect(output.warnings[0].code).toBe("PARTIAL_SHAPE");
    });

    it("marks dynamic method dispatch as dynamic with UNSUPPORTED_PATTERN warning", async () => {
      const code = 'axios[dynamicMethod]("/api/users");';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.method.state).toBe("dynamic");
      expect(obs.limitations[0].code).toBe("UNSUPPORTED_PATTERN");
    });

    it("emits warning for axios.get() called without arguments", async () => {
      const code = "axios.get();";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(1);
      expect(output.warnings[0].code).toBe("UNSUPPORTED_PATTERN");
    });

    it("discards non-HTTP member calls like axios.create and axios.all", async () => {
      const code = `
        const instance = axios.create({ baseURL: "https://api.example.com" });
        axios.all([promise1, promise2]);
        axios.isAxiosError(err);
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(0);
    });

    it("discards unrelated objects with similar method names", async () => {
      const code = `
        myService.get("/api/users");
        client.get("/api/users");
        console.log("/api/users");
        const axios = "/api/not-a-call";
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(0);
    });

    it("discards commented-out Axios calls", async () => {
      const code = `
        // axios.get("/api/commented");
        /* axios.post("/api/block-commented", {}); */
        const str = 'axios.get("/api/in-string")';
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(0);
    });

    it("gracefully tolerates syntax errors elsewhere in document", async () => {
      const code = `
        const broken = ;
        axios.get("/api/surviving-call");
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/surviving-call");
      }
    });

    it("respects cancellation via AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        analyzeCode(
          'axios.get("/api/users");',
          "javascript",
          "file:///src/app.js",
          controller.signal
        )
      ).rejects.toThrow();
    });
  });

  describe("3. Coexistence with Fetch Extractor", () => {
    it("extracts both fetch and axios calls in a single document preserving their frameworks", async () => {
      const code = `
        fetch("/api/fetch-users");
        axios.get("/api/axios-posts");
        axios.post("/api/axios-create", { title: "New" });
        fetch("/api/fetch-posts", { method: "POST" });
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(4);

      const frameworks = output.observations.map((o) => o.framework);
      expect(frameworks).toEqual(["fetch", "fetch", "axios", "axios"]);

      const fetchCalls = output.observations.filter((o) => o.framework === "fetch");
      expect(fetchCalls).toHaveLength(2);
      expect(fetchCalls[0].extractorId).toBe("fetch-extractor");

      const axiosCalls = output.observations.filter((o) => o.framework === "axios");
      expect(axiosCalls).toHaveLength(2);
      expect(axiosCalls[0].extractorId).toBe("axios-extractor");
    });
  });
});
