// Phase 2, Chunk 2.6: Express Route Extractor Unit Tests.
// Tests the real parser, syntax-node facade, and Express-extractor path across JavaScript
// and TypeScript source documents with exact evidence, source positions, route patterns, and warnings.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AnalyzerInput,
  ApiObservation,
  DocumentUri,
  ParsedDocument,
  SourceDocument
} from "@undrift/core";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { JsTsAnalyzer, extractExpressObservations } from "../../packages/analyzer-js-ts/src/index";

describe("Backend Express Route Extractor (Chunk 2.6)", () => {
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
    uri: DocumentUri = "file:///src/routes.js"
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
    uri: DocumentUri = "file:///src/routes.js",
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

  describe("1. Positive Cases: Supported Route Declarations", () => {
    it("extracts basic app.get(path, handler) route declaration with provider role", async () => {
      const code = 'app.get("/api/users", (req, res) => { res.json({ users: [] }); });';
      const output = await analyzeCode(code, "javascript", "file:///src/app.js");

      expect(output.warnings).toHaveLength(0);
      expect(output.observations).toHaveLength(1);

      const obs: ApiObservation = output.observations[0];
      expect(obs.role).toBe("provider");
      expect(obs.languageId).toBe("javascript");
      expect(obs.framework).toBe("express");
      expect(obs.extractorId).toBe("express-extractor");
      expect(obs.id).toBe("obs:file:///src/app.js:0-65");

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

      // Verify Responses from inline handler
      expect(obs.endpoint.responses).toHaveLength(1);
      const resp = obs.endpoint.responses![0];
      expect(resp.statusCode?.state).toBe("known");
      if (resp.statusCode?.state === "known") {
        expect(resp.statusCode.value).toBe(200);
        expect(resp.statusCode.evidence[0].kind).toBe("framework-convention");
      }
      expect(resp.body?.shape.kind).toBe("object");

      // Verify Source Position and Snapshot
      expect(obs.source).toHaveLength(1);
      expect(obs.source[0].range).toEqual({ start: 0, end: 65 });
      expect(obs.source[0].start).toEqual({ line: 0, character: 0 });
      expect(obs.source[0].end).toEqual({ line: 0, character: 65 });
      expect(obs.snapshot.uri).toBe("file:///src/app.js");
      expect(obs.limitations).toHaveLength(0);
    });

    it("extracts router.post(path, handler) with chained res.status(201).json(body)", async () => {
      const code = `router.post("/api/users", (req, res) => {
        res.status(201).json({ id: 1, name: "Alice" });
      });`;
      const output = await analyzeCode(code);

      expect(output.warnings).toHaveLength(0);
      expect(output.observations).toHaveLength(1);

      const obs = output.observations[0];
      expect(obs.role).toBe("provider");
      expect(obs.endpoint.method.state).toBe("known");
      if (obs.endpoint.method.state === "known") {
        expect(obs.endpoint.method.value).toBe("POST");
      }

      expect(obs.endpoint.responses).toHaveLength(1);
      const resp = obs.endpoint.responses![0];
      expect(resp.statusCode?.state).toBe("known");
      if (resp.statusCode?.state === "known") {
        expect(resp.statusCode.value).toBe(201);
        expect(resp.statusCode.evidence[0].kind).toBe("literal-syntax");
      }

      expect(resp.body).toBeDefined();
      expect(resp.body?.completeness).toBe("complete");
      expect(resp.body?.shape.kind).toBe("object");
      if (resp.body?.shape.kind === "object") {
        expect(resp.body.shape.properties).toHaveLength(2);
        const propNames = resp.body.shape.properties.map((p) => p.name);
        expect(propNames).toContain("id");
        expect(propNames).toContain("name");
      }
    });

    it("extracts all supported HTTP verbs: get, post, put, patch, delete, head, options", async () => {
      const methods = ["get", "post", "put", "patch", "delete", "head", "options"];

      for (const method of methods) {
        const code = `app.${method}("/api/resource", handler);`;
        const output = await analyzeCode(code);

        expect(output.observations).toHaveLength(1);
        const obs = output.observations[0];
        expect(obs.endpoint.method.state).toBe("known");
        if (obs.endpoint.method.state === "known") {
          expect(obs.endpoint.method.value).toBe(method.toUpperCase());
        }
      }
    });

    it("anchors route method evidence to the exact method identifier token span", async () => {
      const code = 'app.post("/api/users", handler);';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.method.state).toBe("known");
      if (obs.endpoint.method.state === "known") {
        const ev = obs.endpoint.method.evidence[0];
        expect(ev.kind).toBe("literal-syntax");
        const tokenText = code.slice(ev.source.range.start, ev.source.range.end);
        expect(tokenText).toBe("post");
        expect(ev.source.start.line).toBe(0);
        expect(ev.source.start.character).toBe(4);
        expect(ev.source.end.character).toBe(8);
      }
    });

    it("extracts route path parameters and populates request.pathParams", async () => {
      const code = 'app.get("/api/users/:userId/roles/:roleId", handler);';
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

      expect(obs.endpoint.request?.pathParams).toBeDefined();
      const pathParams = obs.endpoint.request!.pathParams!;
      expect(pathParams.completeness).toBe("complete");
      if (pathParams.shape.kind === "object") {
        expect(pathParams.shape.properties).toHaveLength(2);
        expect(pathParams.shape.properties.map((p) => p.name)).toEqual(["userId", "roleId"]);
      }
    });

    it("extracts wildcard route segment correctly", async () => {
      const code = 'app.get("/static/*", handler);';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];

      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.segments).toEqual([
          { kind: "static", value: "static" },
          { kind: "wildcard" }
        ]);
      }
    });

    it("extracts trailing slash and query exclusion correctly", async () => {
      const code = 'router.get("/api/users/?sort=desc", handler);';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];

      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/users/");
        expect(obs.endpoint.path.value.trailingSlash).toBe("present");
        expect(obs.endpoint.path.value.queryHandling).toBe("excluded-from-path");
      }
    });

    it("extracts route declaration with external handler reference without response shapes", async () => {
      const code = 'app.get("/api/users", getUsersHandler);';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.responses).toHaveLength(0);
    });

    it("extracts TypeScript typed route handler", async () => {
      const code = `
        import { Request, Response } from "express";
        app.get("/api/users", (req: Request, res: Response) => {
          res.json({ active: true });
        });
      `;
      const output = await analyzeCode(code, "typescript", "file:///src/routes.ts");

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.languageId).toBe("typescript");
      expect(obs.role).toBe("provider");
      expect(obs.endpoint.responses).toHaveLength(1);
    });

    it("extracts res.send with string literal response body", async () => {
      const code = 'app.get("/health", (req, res) => res.send("OK"));';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const resp = output.observations[0].endpoint.responses![0];
      expect(resp.body?.shape).toEqual({ kind: "primitive", name: "string" });
    });

    it("extracts res.sendStatus with numeric status code", async () => {
      const code = "app.delete('/api/users/:id', (req, res) => res.sendStatus(204));";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const resp = output.observations[0].endpoint.responses![0];
      if (resp.statusCode?.state === "known") {
        expect(resp.statusCode.value).toBe(204);
      }
    });

    it("extracts multiple distinct Express routes in a single file", async () => {
      const code = `
        app.get("/api/users", handler);
        app.post("/api/users", handler);
        router.delete("/api/users/:id", handler);
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(3);
      const ids = output.observations.map((o) => o.id);
      expect(new Set(ids).size).toBe(3);
    });
  });

  describe("2. Uncertainty and Negative Cases", () => {
    it("marks dynamic route path variable as dynamic with DYNAMIC_ROUTE warning", async () => {
      const code = "app.get(userPath, handler);";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      expect(output.warnings).toHaveLength(1);

      const obs = output.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
      if (obs.endpoint.path.state === "dynamic") {
        expect(obs.endpoint.path.expression).toBe("userPath");
      }

      expect(obs.limitations).toHaveLength(1);
      expect(obs.limitations[0].code).toBe("DYNAMIC_ROUTE");
      expect(output.warnings[0].code).toBe("DYNAMIC_ROUTE");
    });

    it("marks dynamic template string in route path as dynamic with warning", async () => {
      const code = "app.get(`/api/${version}/users`, handler);";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
      expect(obs.limitations[0].code).toBe("DYNAMIC_ROUTE");
    });

    it("marks dynamic method dispatch as dynamic with UNSUPPORTED_PATTERN warning", async () => {
      const code = 'app[dynamicMethod]("/api/users", handler);';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      expect(obs.endpoint.method.state).toBe("dynamic");
      expect(obs.limitations[0].code).toBe("UNSUPPORTED_PATTERN");
    });

    it("marks unresolved response payload variable with PARTIAL_SHAPE warning", async () => {
      const code = 'app.get("/api/users", (req, res) => res.json(usersList));';
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      const resp = obs.endpoint.responses![0];
      expect(resp.body?.completeness).toBe("partial");
      expect(resp.body?.shape).toEqual({ kind: "unknown", reason: "unresolved-reference" });
      expect(obs.limitations[0].code).toBe("PARTIAL_SHAPE");
    });

    it("emits warning for app.get() called without arguments", async () => {
      const code = "app.get();";
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(1);
      expect(output.warnings[0].code).toBe("UNSUPPORTED_PATTERN");
    });

    it("discards Express configuration getter app.get('env')", async () => {
      const code = `
        const env = app.get("env");
        const port = app.get("port");
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(0);
    });

    it("discards non-HTTP methods like app.use, app.listen, app.set", async () => {
      const code = `
        app.use("/api", router);
        app.listen(3000);
        app.set("view engine", "pug");
        router.use(authMiddleware);
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(0);
    });

    it("discards unrelated objects with similar method names", async () => {
      const code = `
        myService.get("/api/users", handler);
        map.get("key");
        console.log("/api/users");
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(0);
    });

    it("discards commented-out route declarations", async () => {
      const code = `
        // app.get("/api/commented", handler);
        /* router.post("/api/block-commented", handler); */
        const str = 'app.get("/api/in-string", handler)';
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(0);
      expect(output.warnings).toHaveLength(0);
    });

    it("gracefully tolerates syntax errors elsewhere in document", async () => {
      const code = `
        const malformed = ;
        app.get("/api/surviving-route", handler);
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(1);
      const obs = output.observations[0];
      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/surviving-route");
      }
    });

    it("respects cancellation via AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        analyzeCode(
          'app.get("/api/users", handler);',
          "javascript",
          "file:///src/app.js",
          controller.signal
        )
      ).rejects.toThrow();
    });
  });

  describe("3. Coexistence Across Frontend and Backend Extractors", () => {
    it("extracts fetch, axios, and express calls together with their respective roles and frameworks", async () => {
      const code = `
        // Frontend consumer calls
        fetch("/api/fetch-endpoint");
        axios.get("/api/axios-endpoint");

        // Backend provider route
        app.get("/api/backend-route", (req, res) => {
          res.json({ message: "Hello from server" });
        });
      `;
      const output = await analyzeCode(code);

      expect(output.observations).toHaveLength(3);

      const fetchObs = output.observations.find((o) => o.framework === "fetch")!;
      expect(fetchObs).toBeDefined();
      expect(fetchObs.role).toBe("consumer");
      expect(fetchObs.extractorId).toBe("fetch-extractor");

      const axiosObs = output.observations.find((o) => o.framework === "axios")!;
      expect(axiosObs).toBeDefined();
      expect(axiosObs.role).toBe("consumer");
      expect(axiosObs.extractorId).toBe("axios-extractor");

      const expressObs = output.observations.find((o) => o.framework === "express")!;
      expect(expressObs).toBeDefined();
      expect(expressObs.role).toBe("provider");
      expect(expressObs.extractorId).toBe("express-extractor");
      if (expressObs.endpoint.path.state === "known") {
        expect(expressObs.endpoint.path.value.rawPath).toBe("/api/backend-route");
      }
    });
  });
});
