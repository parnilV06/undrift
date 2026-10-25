// Comprehensive regression tests for real-world stack scan reliability and V1 compatibility
// covering Workstreams A through F from real-world application audits (MERN and PERN).

import { describe, expect, it } from "vitest";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import {
  extractAxiosObservations,
  extractExpressObservations,
  createLocalDeclarationIndex,
  createLocalReferenceResolver,
  JsTsAnalyzer
} from "@undrift/analyzer-js-ts";
import {
  AnalysisEngine,
  ContractMatcher,
  evaluateProtocolRules,
  extractCoverageSummary,
  normalizeHttpMethod,
  normalizeRoute,
  type ApiObservation,
  type SourceDocument,
  type SourceSpan
} from "@undrift/core";
import {
  DEFAULT_EXCLUDE_GLOBS,
  isPathExcluded,
  isSupportedSourceFile
} from "../../apps/vscode-extension/src/workspace/source-snapshot-provider";

const parser = new TreeSitterParserAdapter();

function makeDoc(uri: string, text: string, languageId = "javascript"): SourceDocument {
  return {
    uri,
    languageId,
    text,
    contentHash: "hash-" + uri
  };
}

function makeObservation(
  id: string,
  role: "consumer" | "provider",
  methodStr: string,
  pathInput: string
): ApiObservation {
  const normMethod = normalizeHttpMethod(methodStr);
  const normPath = normalizeRoute(pathInput);
  const span: SourceSpan = {
    uri: `src/${role}.js`,
    range: { start: 1, end: 10 },
    start: { line: 1, character: 1 },
    end: { line: 1, character: 10 }
  };

  return {
    id,
    role,
    languageId: "javascript",
    extractorId: role === "consumer" ? "extractor-axios" : "extractor-express",
    source: [span],
    snapshot: { uri: `src/${role}.js`, contentHash: "hash-" + id },
    endpoint: {
      path: {
        state: "known",
        value: normPath,
        strength: "direct",
        evidence: [{ id: `ev-p-${id}`, kind: "literal-syntax", strength: "direct", source: span }]
      },
      method: {
        state: "known",
        value: normMethod,
        strength: "direct",
        evidence: [{ id: `ev-m-${id}`, kind: "literal-syntax", strength: "direct", source: span }]
      }
    },
    limitations: []
  };
}

describe("Real-World Stack Scan Reliability & V1 Compatibility", () => {
  describe("Workstream A: Chained Express Router Route Declarations", () => {
    it("extracts all chained router.route() and app.route() methods and paths accurately", async () => {
      const serverCode = `
        const express = require('express');
        const router = express.Router();

        router.route('/')
          .get((req, res) => res.json({ posts: [] }))
          .post((req, res) => res.json({ created: true }));

        router.route('/:id')
          .get((req, res) => res.json({ post: null }))
          .put((req, res) => res.json({ updated: true }))
          .delete((req, res) => res.json({ deleted: true }));

        module.exports = router;
      `;

      const doc = makeDoc("server/routes/postRoutes.js", serverCode);
      const parsed = await parser.parse({ document: doc });
      const result = extractExpressObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(5);

      const endpoints = result.observations.map((obs) => ({
        method: obs.endpoint.method.value,
        path: obs.endpoint.path.value?.rawPath
      }));

      expect(endpoints).toContainEqual({ method: "GET", path: "/" });
      expect(endpoints).toContainEqual({ method: "POST", path: "/" });
      expect(endpoints).toContainEqual({ method: "GET", path: "/:id" });
      expect(endpoints).toContainEqual({ method: "PUT", path: "/:id" });
      expect(endpoints).toContainEqual({ method: "DELETE", path: "/:id" });
    });
  });

  describe("Workstream B & C: Same-File Declared Object Payloads in React Components", () => {
    it("resolves same-file object literal payload in React component function scope", async () => {
      const clientCode = `
        import React, { useState } from 'react';
        import axios from 'axios';

        export const Login = () => {
          const [email, setEmail] = useState('');
          const [password, setPassword] = useState('');

          const handleSubmit = async (e) => {
            e.preventDefault();
            const payload = { email, password };
            await axios.post('/api/auth/login', payload);
          };

          return <form onSubmit={handleSubmit} />;
        };
      `;

      const doc = makeDoc("client/src/Login.jsx", clientCode, "javascriptreact");
      const parsed = await parser.parse({ document: doc });

      const index = createLocalDeclarationIndex([{ document: doc, parsed }]);
      const resolver = createLocalReferenceResolver(index);

      const result = extractAxiosObservations(doc, parsed, undefined, resolver);

      expect(result.observations).toHaveLength(1);
      const obs = result.observations[0];
      expect(obs.endpoint.path.value?.rawPath).toBe("/api/auth/login");
      expect(obs.endpoint.method.value).toBe("POST");

      // Payload body must be resolved as complete object with email and password properties
      const body = obs.endpoint.request?.body;
      expect(body).toBeDefined();
      expect(body?.completeness).toBe("complete");
      expect(body?.shape.kind).toBe("object");

      if (body?.shape.kind === "object") {
        const propNames = body.shape.properties.map((p) => p.name);
        expect(propNames).toContain("email");
        expect(propNames).toContain("password");
      }

      // No PARTIAL_SHAPE warning emitted since object was resolved
      expect(result.warnings.filter((w) => w.code === "PARTIAL_SHAPE")).toHaveLength(0);
    });
  });

  describe("Workstream B: Tree-Sitter JSX Ampersand Artifact Toleration", () => {
    it("tolerates raw ampersands in JSX text and URL query attributes without parse error", async () => {
      const jsxCode = `
        import React from 'react';

        export const HeroSection = () => {
          return (
            <div className="hero">
              <img
                src="https://images.unsplash.com/photo-1534438327276-14e5300c3a48?auto=format&fit=crop&w=1470&q=80"
                alt="Gym & Fitness"
              />
              <h1>Fitness & Health</h1>
              <p>Terms & Conditions & Privacy Policy</p>
            </div>
          );
        };
      `;

      const doc = makeDoc("client/src/HeroSection.jsx", jsxCode, "javascriptreact");
      const parsed = await parser.parse({ document: doc });

      // Must NOT treat valid JSX text '&' or attribute '&' as fatal parse errors
      const errorIssues = parsed.issues.filter((i) => i.isError);
      expect(errorIssues).toHaveLength(0);
      expect(parsed.root).toBeDefined();
    });

    it("still catches genuine syntax errors in JSX files", async () => {
      const brokenJsxCode = `
        import React from 'react';
        export const Bad = () => {
          const x = ;
          return <div />;
        };
      `;

      const doc = makeDoc("client/src/Bad.jsx", brokenJsxCode, "javascriptreact");
      const parsed = await parser.parse({ document: doc });

      const errorIssues = parsed.issues.filter((i) => i.isError);
      expect(errorIssues.length).toBeGreaterThan(0);
    });
  });

  describe("Workstream E: Route Mismatch Precision (UND130)", () => {
    it("does NOT match unrelated 1-segment routes (PATCH /profile vs PATCH /read-all) as UND130", () => {
      const consumer = makeObservation("c-profile", "consumer", "PATCH", "/profile");
      const provider = makeObservation("p-read-all", "provider", "PATCH", "/read-all");

      const matcher = new ContractMatcher();
      const relationships = matcher.match([consumer, provider]);

      // Must not match as suspected-route-conflict
      const suspected = relationships.filter((r) => r.matchKind === "suspected-route-conflict");
      expect(suspected).toHaveLength(0);

      // Protocol rules must report genuine absence findings (UND100 and UND110), NOT UND130
      const findings = evaluateProtocolRules({
        observations: [consumer, provider],
        context: { backendScanComplete: true, consumerScanComplete: true }
      });

      expect(findings.some((f) => f.ruleId === "UND130")).toBe(false);
      expect(findings.some((f) => f.ruleId === "UND100")).toBe(true);
      expect(findings.some((f) => f.ruleId === "UND110")).toBe(true);
    });

    it("correctly identifies genuine plural/singular typo near-miss routes (/api/users vs /api/user) as UND130", () => {
      const consumer = makeObservation("c-users", "consumer", "GET", "/api/users");
      const provider = makeObservation("p-user", "provider", "GET", "/api/user");

      const matcher = new ContractMatcher();
      const relationships = matcher.match([consumer, provider]);

      const suspected = relationships.filter((r) => r.matchKind === "suspected-route-conflict");
      expect(suspected).toHaveLength(1);

      const findings = evaluateProtocolRules({
        observations: [consumer, provider],
        context: { backendScanComplete: true, consumerScanComplete: true }
      });

      const und130 = findings.filter((f) => f.ruleId === "UND130");
      expect(und130).toHaveLength(1);
      expect(und130[0].expected).toBe("/api/users");
      expect(und130[0].observed).toBe("/api/user");
    });
  });

  describe("Workstream D: Dimension-Aware Completeness with Dynamic Payloads", () => {
    it("preserves route/method completeness and emits UND100 when payload has unresolved state", async () => {
      const clientCode = `
        import axios from 'axios';
        export async function createPost(formData) {
          return axios.post('/api/posts/create', formData);
        }
      `;
      const serverCode = `
        const express = require('express');
        const app = express();
        app.get('/api/posts', (req, res) => res.json([]));
      `;

      const clientDoc = makeDoc("client/src/api.js", clientCode);
      const serverDoc = makeDoc("server/src/app.js", serverCode);

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [new JsTsAnalyzer()]
      });

      const result = await engine.analyze({
        workspaceId: "ws:dimension-aware-test",
        workspaceRootUris: ["test"],
        generation: 1,
        documents: [clientDoc, serverDoc],
        mode: "workspace"
      });

      // Warning exists for request payload dimension
      const shapeWarning = result.warnings.find((w) => w.code === "PARTIAL_SHAPE");
      expect(shapeWarning).toBeDefined();
      expect(shapeWarning?.targetDimension).toBe("request-shape");
      expect(shapeWarning?.affectsCompleteness).toBe(false);

      // Route and method dimensions are complete!
      expect(result.complete).toBe(true);
      const coverage = extractCoverageSummary(result);
      expect(coverage.backendComplete).toBe(true);
      expect(coverage.consumerComplete).toBe(true);
      expect(coverage.complete).toBe(true);

      // Absence finding UND100 (POST /api/posts/create missing on backend) is correctly emitted!
      const missingRouteFinding = result.findings.find((f) => f.ruleId === "UND100");
      expect(missingRouteFinding).toBeDefined();
      expect(missingRouteFinding?.expected).toContain("POST /api/posts/create");
    });
  });

  describe("Workstream B: Excluded Globs and Declaration Files", () => {
    it("excludes Prisma generated directories and .d.ts declaration files by default", () => {
      expect(isPathExcluded("server/generated/prisma/index.js", DEFAULT_EXCLUDE_GLOBS)).toBe(true);
      expect(isPathExcluded("server/prisma/generated/client.ts", DEFAULT_EXCLUDE_GLOBS)).toBe(true);
      expect(isPathExcluded("node_modules/@prisma/client/index.d.ts", DEFAULT_EXCLUDE_GLOBS)).toBe(
        true
      );
      expect(isSupportedSourceFile("client/src/types/api.d.ts")).toBe(false);
      expect(isSupportedSourceFile("client/src/types/api.d.mts")).toBe(false);
      expect(isSupportedSourceFile("client/src/types/api.d.cts")).toBe(false);

      // Legitimate source files are supported and not excluded
      expect(isSupportedSourceFile("client/src/App.jsx")).toBe(true);
      expect(isPathExcluded("client/src/App.jsx", DEFAULT_EXCLUDE_GLOBS)).toBe(false);
      expect(isSupportedSourceFile("server/controllers/focus.controller.js")).toBe(true);
      expect(isPathExcluded("server/controllers/focus.controller.js", DEFAULT_EXCLUDE_GLOBS)).toBe(
        false
      );
    });
  });
});
