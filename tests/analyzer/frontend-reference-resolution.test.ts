// Phase 2, Chunk 2.9: Integration Tests for Local Reference Resolution in Frontend Extraction.
// Verifies integration of LocalReferenceResolver into fetch and Axios extractors through
// JsTsAnalyzer and direct extractor execution.
// Asserts successful local const URL resolution, evidence provenance, uncertainty preservation,
// backward compatibility, and end-to-end AnalyzerInput pipeline behavior.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TreeSitterParserAdapter } from "../../packages/parser-tree-sitter/src/index";
import {
  AxiosExtractor,
  FetchExtractor,
  JsTsAnalyzer,
  LocalDeclarationIndex,
  createLocalDeclarationIndex,
  createLocalReferenceResolver,
  extractAxiosObservations,
  extractFetchObservations
} from "../../packages/analyzer-js-ts/src/index";
import type {
  AnalyzerInput,
  DocumentUri,
  ParsedDocument,
  SourceDocument
} from "../../packages/core/src/index";

describe("Frontend Reference Resolution Integration (Chunk 2.9)", () => {
  let parser: TreeSitterParserAdapter;

  beforeAll(() => {
    parser = new TreeSitterParserAdapter();
  });

  afterAll(() => {
    parser.dispose();
  });

  async function parseSource(
    text: string,
    languageId: "javascript" | "typescript" = "typescript",
    uri: DocumentUri = "file:///src/client.ts"
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

  describe("1. Successful Local URL Constant Resolution in Fetch and Axios", () => {
    it("resolves a const string URL in fetch() to a known route with 'resolved' evidence", async () => {
      const code = `
        const USERS_API = "/api/v1/users";
        fetch(USERS_API);
      `;
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractFetchObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(0);

      const obs = result.observations[0];
      expect(obs.role).toBe("consumer");
      expect(obs.framework).toBe("fetch");
      expect(obs.endpoint.method.state).toBe("known");
      if (obs.endpoint.method.state === "known") {
        expect(obs.endpoint.method.value).toBe("GET");
      }

      expect(obs.endpoint.path.state).toBe("known");
      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/v1/users");
        expect(obs.endpoint.path.value.segments).toHaveLength(3);
        expect(obs.endpoint.path.strength).toBe("resolved");

        // Verify evidence chaining: call site + declaration site
        expect(obs.endpoint.path.evidence).toHaveLength(2);

        const refEvidence = obs.endpoint.path.evidence[0];
        expect(refEvidence.kind).toBe("local-declaration");
        expect(refEvidence.strength).toBe("resolved");
        expect(refEvidence.source.uri).toBe(document.uri);
        expect(refEvidence.description).toContain("Resolved reference 'USERS_API'");

        const declEvidence = obs.endpoint.path.evidence[1];
        expect(declEvidence.kind).toBe("local-declaration");
        expect(declEvidence.strength).toBe("direct");
        expect(declEvidence.source.uri).toBe(document.uri);
        expect(declEvidence.description).toContain("const variable declaration 'USERS_API'");
      }

      // Verify snapshot provenance
      expect(obs.snapshot.uri).toBe(document.uri);
      expect(obs.snapshot.contentHash).toBe(document.contentHash);
    });

    it("resolves a const string URL in Axios method calls (axios.get, axios.post)", async () => {
      const code = `
        const POSTS_URL = "/api/posts";
        axios.get(POSTS_URL);
        axios.post(POSTS_URL, { title: "Test" });
      `;
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractAxiosObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(2);
      expect(result.warnings).toHaveLength(0);

      // 1. axios.get
      const getObs = result.observations[0];
      expect(getObs.endpoint.method.state).toBe("known");
      if (getObs.endpoint.method.state === "known") {
        expect(getObs.endpoint.method.value).toBe("GET");
      }
      expect(getObs.endpoint.path.state).toBe("known");
      if (getObs.endpoint.path.state === "known") {
        expect(getObs.endpoint.path.value.rawPath).toBe("/api/posts");
        expect(getObs.endpoint.path.strength).toBe("resolved");
        expect(getObs.endpoint.path.evidence).toHaveLength(2);
      }

      // 2. axios.post
      const postObs = result.observations[1];
      expect(postObs.endpoint.method.state).toBe("known");
      if (postObs.endpoint.method.state === "known") {
        expect(postObs.endpoint.method.value).toBe("POST");
      }
      expect(postObs.endpoint.path.state).toBe("known");
      if (postObs.endpoint.path.state === "known") {
        expect(postObs.endpoint.path.value.rawPath).toBe("/api/posts");
        expect(postObs.endpoint.path.strength).toBe("resolved");
      }
      expect(postObs.endpoint.request?.body?.shape.kind).toBe("object");
    });

    it("emits UNSUPPORTED_PATTERN and leaves path dynamic when constant resolves to a non-string value", async () => {
      const code = `
        const NUMERIC_PORT = 8080;
        fetch(NUMERIC_PORT);
      `;
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractFetchObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("UNSUPPORTED_PATTERN");
      expect(result.warnings[0].message).toContain("not a string URL");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });
  });

  describe("2. Backward Compatibility with Direct Literals and Missing Resolver", () => {
    it("preserves 'direct' strength for direct string literals when resolver is supplied", async () => {
      const code = 'fetch("/api/direct-literal");';
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractFetchObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("known");
      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/direct-literal");
        expect(obs.endpoint.path.strength).toBe("direct");
        expect(obs.endpoint.path.evidence[0].kind).toBe("literal-syntax");
      }
    });

    it("preserves 'direct' strength for static template literals without substitutions", async () => {
      const code = "axios.get(`/api/static-template`);";
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractAxiosObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("known");
      if (obs.endpoint.path.state === "known") {
        expect(obs.endpoint.path.value.rawPath).toBe("/api/static-template");
        expect(obs.endpoint.path.strength).toBe("direct");
      }
    });

    it("handles extraction safely when no resolver is provided to extractFetchObservations", async () => {
      const code = `
        const API_ROUTE = "/api/no-resolver";
        fetch(API_ROUTE);
      `;
      const { document, parsed } = await parseSource(code);

      // Call without resolver
      const result = extractFetchObservations(document, parsed);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });

    it("handles extraction safely when no resolver is provided to extractAxiosObservations", async () => {
      const code = `
        const API_ROUTE = "/api/no-resolver";
        axios.get(API_ROUTE);
      `;
      const { document, parsed } = await parseSource(code);

      // Call without resolver
      const result = extractAxiosObservations(document, parsed);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });

    it("works through class-based FetchExtractor and AxiosExtractor instances", async () => {
      const code = `
        const URL_PATH = "/api/v1/items";
        fetch(URL_PATH);
        axios.delete(URL_PATH);
      `;
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const fetchExtractor = new FetchExtractor(resolver);
      const axiosExtractor = new AxiosExtractor(resolver);

      const fetchRes = fetchExtractor.extract(document, parsed);
      const axiosRes = axiosExtractor.extract(document, parsed);

      expect(fetchRes.observations).toHaveLength(1);
      expect(fetchRes.observations[0].endpoint.path.state).toBe("known");

      expect(axiosRes.observations).toHaveLength(1);
      expect(axiosRes.observations[0].endpoint.path.state).toBe("known");
    });
  });

  describe("3. Uncertainty Preservation for Non-Resolvable References", () => {
    it("preserves dynamic state and emits DYNAMIC_ROUTE warning for mutable let variable", async () => {
      const code = `
        let mutableUrl = "/api/v1/users";
        fetch(mutableUrl);
      `;
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractFetchObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });

    it("preserves dynamic state and emits DYNAMIC_ROUTE warning for mutable var variable", async () => {
      const code = `
        var legacyUrl = "/api/v1/legacy";
        axios.get(legacyUrl);
      `;
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractAxiosObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });

    it("preserves dynamic state for constant initialized with dynamic expression", async () => {
      const code = `
        const dynamicEndpoint = getBaseUrl() + "/users";
        fetch(dynamicEndpoint);
      `;
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractFetchObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });

    it("preserves dynamic state for missing local declarations", async () => {
      const code = "fetch(UNDECLARED_ROUTE);";
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractFetchObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });

    it("preserves dynamic state for ambiguous duplicate local declarations", async () => {
      const code = `
        {
          const PATH = "/scope1";
        }
        {
          const PATH = "/scope2";
        }
        fetch(PATH);
      `;
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractFetchObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });

    it("preserves dynamic state for imported symbols (POC GATE)", async () => {
      const code = `
        import { API_URL } from "./config";
        axios.get(API_URL);
      `;
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractAxiosObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });

    it("preserves dynamic state for alias chains (POC GATE)", async () => {
      const code = `
        const BASE = "/api";
        const ROUTE = BASE;
        fetch(ROUTE);
      `;
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractFetchObservations(document, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });

    it("preserves dynamic state for cross-file declarations (POC GATE)", async () => {
      const doc1 = {
        uri: "file:///src/constants.ts",
        languageId: "typescript",
        text: 'export const REMOTE_PATH = "/api/remote";',
        contentHash: "hash-doc1"
      };
      const doc2 = {
        uri: "file:///src/client.ts",
        languageId: "typescript",
        text: "fetch(REMOTE_PATH);",
        contentHash: "hash-doc2"
      };

      const parsed1 = await parser.parse({ document: doc1 });
      const parsed2 = await parser.parse({ document: doc2 });

      const index = createLocalDeclarationIndex([
        { document: doc1, parsed: parsed1 },
        { document: doc2, parsed: parsed2 }
      ]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractFetchObservations(doc2, parsed2, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const obs = result.observations[0];
      expect(obs.endpoint.path.state).toBe("dynamic");
    });
  });

  describe("4. End-to-End JsTsAnalyzer Integration via AnalyzerInput", () => {
    it("automatically instantiates and uses LocalReferenceResolver when LocalDeclarationIndex is in projectIndex", async () => {
      const code = `
        const API_ENDPOINT = "/api/v2/products";
        fetch(API_ENDPOINT);
        axios.get(API_ENDPOINT);
      `;
      const { document, parsed } = await parseSource(code);
      const projectIndex = createLocalDeclarationIndex([{ document, parsed }]);

      const analyzer = new JsTsAnalyzer();
      const input: AnalyzerInput = {
        document,
        parsed,
        projectIndex,
        config: {}
      };

      const output = await analyzer.analyze(input);

      expect(output.observations).toHaveLength(2);
      expect(output.warnings).toHaveLength(0);

      // fetch observation
      const fetchObs = output.observations.find((o) => o.framework === "fetch");
      expect(fetchObs).toBeDefined();
      expect(fetchObs?.endpoint.path.state).toBe("known");
      if (fetchObs?.endpoint.path.state === "known") {
        expect(fetchObs.endpoint.path.value.rawPath).toBe("/api/v2/products");
        expect(fetchObs.endpoint.path.strength).toBe("resolved");
      }

      // axios observation
      const axiosObs = output.observations.find((o) => o.framework === "axios");
      expect(axiosObs).toBeDefined();
      expect(axiosObs?.endpoint.path.state).toBe("known");
      if (axiosObs?.endpoint.path.state === "known") {
        expect(axiosObs.endpoint.path.value.rawPath).toBe("/api/v2/products");
        expect(axiosObs.endpoint.path.strength).toBe("resolved");
      }
    });

    it("leaves Express route observations untouched while resolving frontend calls in mixed documents", async () => {
      const code = `
        const HEALTH_URL = "/api/health";
        fetch(HEALTH_URL);

        app.get("/api/health", (req, res) => {
          res.json({ status: "ok" });
        });
      `;
      const { document, parsed } = await parseSource(code);
      const projectIndex = createLocalDeclarationIndex([{ document, parsed }]);

      const analyzer = new JsTsAnalyzer();
      const input: AnalyzerInput = {
        document,
        parsed,
        projectIndex,
        config: {}
      };

      const output = await analyzer.analyze(input);

      expect(output.observations).toHaveLength(2);

      // Consumer fetch observation
      const fetchObs = output.observations.find((o) => o.role === "consumer");
      expect(fetchObs).toBeDefined();
      expect(fetchObs?.framework).toBe("fetch");
      expect(fetchObs?.endpoint.path.state).toBe("known");
      if (fetchObs?.endpoint.path.state === "known") {
        expect(fetchObs.endpoint.path.value.rawPath).toBe("/api/health");
        expect(fetchObs.endpoint.path.strength).toBe("resolved");
      }

      // Provider Express observation (remains direct literal)
      const expressObs = output.observations.find((o) => o.role === "provider");
      expect(expressObs).toBeDefined();
      expect(expressObs?.framework).toBe("express");
      expect(expressObs?.endpoint.path.state).toBe("known");
      if (expressObs?.endpoint.path.state === "known") {
        expect(expressObs.endpoint.path.value.rawPath).toBe("/api/health");
        expect(expressObs.endpoint.path.strength).toBe("direct");
      }
    });

    it("aggregates warnings cleanly when some calls resolve and others remain dynamic", async () => {
      const code = `
        const KNOWN_URL = "/api/v1/known";
        fetch(KNOWN_URL);
        fetch(UNKNOWN_DYNAMIC_URL);
      `;
      const { document, parsed } = await parseSource(code);
      const projectIndex = createLocalDeclarationIndex([{ document, parsed }]);

      const analyzer = new JsTsAnalyzer();
      const input: AnalyzerInput = {
        document,
        parsed,
        projectIndex,
        config: {}
      };

      const output = await analyzer.analyze(input);

      expect(output.observations).toHaveLength(2);
      expect(output.warnings).toHaveLength(1);
      expect(output.warnings[0].code).toBe("DYNAMIC_ROUTE");

      const knownObs = output.observations[0];
      expect(knownObs.endpoint.path.state).toBe("known");

      const dynamicObs = output.observations[1];
      expect(dynamicObs.endpoint.path.state).toBe("dynamic");
    });

    it("respects cancellation via AbortSignal", async () => {
      const code = 'const URL = "/api"; fetch(URL);';
      const { document, parsed } = await parseSource(code);
      const projectIndex = createLocalDeclarationIndex([{ document, parsed }]);

      const analyzer = new JsTsAnalyzer();
      const controller = new AbortController();
      controller.abort();

      const input: AnalyzerInput = {
        document,
        parsed,
        projectIndex,
        config: {}
      };

      await expect(analyzer.analyze(input, controller.signal)).rejects.toThrow();
    });

    it("gracefully functions with empty projectIndex without crashing or resolving unresolvable variables", async () => {
      const code = "fetch(SOME_VAR);";
      const { document, parsed } = await parseSource(code);

      const analyzer = new JsTsAnalyzer();
      const input: AnalyzerInput = {
        document,
        parsed,
        projectIndex: {},
        config: {}
      };

      const output = await analyzer.analyze(input);

      expect(output.observations).toHaveLength(1);
      expect(output.warnings).toHaveLength(1);
      expect(output.warnings[0].code).toBe("DYNAMIC_ROUTE");
      expect(output.observations[0].endpoint.path.state).toBe("dynamic");
    });

    it("resolves constants when index is provided via toProjectIndexView()", async () => {
      const code = 'const VIEW_PATH = "/api/view"; fetch(VIEW_PATH);';
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const projectIndex = index.toProjectIndexView();

      const analyzer = new JsTsAnalyzer();
      const input: AnalyzerInput = {
        document,
        parsed,
        projectIndex,
        config: {}
      };

      const output = await analyzer.analyze(input);
      expect(output.observations).toHaveLength(1);
      expect(output.observations[0].endpoint.path.state).toBe("known");
      if (output.observations[0].endpoint.path.state === "known") {
        expect(output.observations[0].endpoint.path.value.rawPath).toBe("/api/view");
        expect(output.observations[0].endpoint.path.strength).toBe("resolved");
      }
    });

    it("resolves constants when wrapped in composite index with declarationIndex", async () => {
      const code = 'const COMP_PATH = "/api/composite"; axios.get(COMP_PATH);';
      const { document, parsed } = await parseSource(code);
      const index = createLocalDeclarationIndex([{ document, parsed }]);
      const compositeProjectIndex = {
        declarationIndex: index,
        getDocument: (uri: DocumentUri) => index.getDocument(uri)
      };

      const analyzer = new JsTsAnalyzer();
      const input: AnalyzerInput = {
        document,
        parsed,
        projectIndex: compositeProjectIndex,
        config: {}
      };

      const output = await analyzer.analyze(input);
      expect(output.observations).toHaveLength(1);
      expect(output.observations[0].endpoint.path.state).toBe("known");
      if (output.observations[0].endpoint.path.state === "known") {
        expect(output.observations[0].endpoint.path.value.rawPath).toBe("/api/composite");
        expect(output.observations[0].endpoint.path.strength).toBe("resolved");
      }
    });

    it("safely ignores partial project-index implementation lacking lookupSymbols", async () => {
      const code = 'const UNK_PATH = "/api/unk"; fetch(UNK_PATH);';
      const { document, parsed } = await parseSource(code);
      // Partial index that only provides getDocument, but lacks lookupSymbols
      const partialIndex = {
        getDocument: () => undefined
      };

      const analyzer = new JsTsAnalyzer();
      const input: AnalyzerInput = {
        document,
        parsed,
        projectIndex: partialIndex,
        config: {}
      };

      const output = await analyzer.analyze(input);
      expect(output.observations).toHaveLength(1);
      expect(output.warnings).toHaveLength(1);
      expect(output.warnings[0].code).toBe("DYNAMIC_ROUTE");
      expect(output.observations[0].endpoint.path.state).toBe("dynamic");
    });
  });
});
