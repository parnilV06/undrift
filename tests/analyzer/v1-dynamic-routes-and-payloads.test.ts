// Regression tests for V1 dynamic route handling, payload resolution, and scope bounding
// adhering strictly to Phase 6 Chunk 6.1 Section 5, 6, and Section 12 requirements.

import { describe, expect, it } from "vitest";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import {
  extractAxiosObservations,
  extractFetchObservations,
  extractExpressObservations,
  createLocalDeclarationIndex,
  createLocalReferenceResolver,
  indexLocalDeclarations
} from "@undrift/analyzer-js-ts";
import { ContractMatcher, evaluateMethodConflictRule, type SourceDocument } from "@undrift/core";

const parser = new TreeSitterParserAdapter();

function makeDoc(uri: string, text: string): SourceDocument {
  return {
    uri,
    languageId: "typescript",
    text,
    contentHash: "hash-" + uri
  };
}

describe("V1 Dynamic Route Handling & Payload Analysis", () => {
  describe("1. Dynamic Axios & Fetch URL Handling", () => {
    it("6. single-segment parameter interpolation (/api/posts/${id}) matches backend route /api/posts/:id", async () => {
      const clientCode = `
        import axios from 'axios';
        export function getPost(id: string) {
          return axios.get(\`/api/posts/\${id}\`);
        }
      `;
      const serverCode = `
        import express from 'express';
        const app = express();
        app.get("/api/posts/:id", (req, res) => res.json({ id: req.params.id }));
      `;

      const clientDoc = makeDoc("src/client.ts", clientCode);
      const serverDoc = makeDoc("src/server.ts", serverCode);

      const clientParsed = await parser.parse({ document: clientDoc });
      const serverParsed = await parser.parse({ document: serverDoc });

      const clientResult = extractAxiosObservations(clientDoc, clientParsed);
      const serverResult = extractExpressObservations(serverDoc, serverParsed);

      expect(clientResult.warnings).toHaveLength(0);
      expect(clientResult.observations).toHaveLength(1);
      expect(clientResult.observations[0].endpoint.path.state).toBe("known");
      expect(clientResult.observations[0].endpoint.path.value?.rawPath).toBe("/api/posts/:id");

      // Match against Express provider route
      const matcher = new ContractMatcher();
      const relationships = matcher.match([
        ...clientResult.observations,
        ...serverResult.observations
      ]);

      expect(relationships).toHaveLength(1);
      expect(relationships[0].matchKind).toBe("exact");
    });

    it("6b. parameter interpolation with alternative variable name (/api/posts/${postId}) structurally matches /api/posts/:id", async () => {
      const clientCode = `
        import axios from 'axios';
        export function getPost(postId: string) {
          return axios.get(\`/api/posts/\${postId}\`);
        }
      `;
      const serverCode = `
        import express from 'express';
        const app = express();
        app.get("/api/posts/:id", (req, res) => res.json({}));
      `;

      const clientDoc = makeDoc("src/client.ts", clientCode);
      const serverDoc = makeDoc("src/server.ts", serverCode);

      const clientParsed = await parser.parse({ document: clientDoc });
      const serverParsed = await parser.parse({ document: serverDoc });

      const clientResult = extractAxiosObservations(clientDoc, clientParsed);
      const serverResult = extractExpressObservations(serverDoc, serverParsed);

      expect(clientResult.warnings).toHaveLength(0);

      const matcher = new ContractMatcher();
      const relationships = matcher.match([
        ...clientResult.observations,
        ...serverResult.observations
      ]);

      expect(relationships).toHaveLength(1);
      expect(relationships[0].matchKind).toBe("exact");
    });

    it("7. static endpoint path with dynamic query parameters (/api/posts?page=${page}&limit=10) preserves static path identity", async () => {
      const clientCode = `
        import axios from 'axios';
        export function listPosts(page: number) {
          return axios.get(\`/api/posts?page=\${page}&limit=10\`);
        }
      `;
      const doc = makeDoc("src/client.ts", clientCode);
      const parsed = await parser.parse({ document: doc });
      const result = extractAxiosObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      const path = result.observations[0].endpoint.path;
      expect(path.state).toBe("known");
      expect(path.value?.rawPath).toBe("/api/posts");
      expect(path.value?.queryHandling).toBe("excluded-from-path");
      expect(path.value?.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "posts" }
      ]);
    });

    it("8. arbitrary dynamic expression (/departments/${getDepartmentPath()}) remains unresolved dynamic route with warning", async () => {
      const clientCode = `
        import axios from 'axios';
        function getDepartmentPath() { return "engineering"; }
        export function loadDept() {
          return axios.get(\`/departments/\${getDepartmentPath()}\`);
        }
      `;
      const doc = makeDoc("src/client.ts", clientCode);
      const parsed = await parser.parse({ document: doc });
      const result = extractAxiosObservations(doc, parsed);

      expect(result.observations).toHaveLength(1);
      expect(result.observations[0].endpoint.path.state).toBe("dynamic");
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");
      expect(result.warnings[0].scope).toBe("consumer");
      expect(result.warnings[0].targetDimension).toBe("route");
      expect(result.warnings[0].affectsCompleteness).toBe(true);
    });
  });

  describe("2. Request Payload Analysis & Scope Bounding", () => {
    it("resolves const object literal payload (registrationData) to structured object fields", async () => {
      const clientCode = `
        import axios from 'axios';
        const registrationData = {
          name: "Alice",
          email: "alice@example.com"
        };
        export function register() {
          return axios.post("/api/users", registrationData);
        }
      `;
      const doc = makeDoc("src/client.ts", clientCode);
      const parsed = await parser.parse({ document: doc });

      const declIndex = createLocalDeclarationIndex([{ document: doc, parsed }]);
      const resolver = createLocalReferenceResolver(declIndex);

      const result = extractAxiosObservations(doc, parsed, undefined, resolver);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(1);

      const body = result.observations[0].endpoint.request?.body;
      expect(body).toBeDefined();
      expect(body?.completeness).toBe("complete");
      expect(body?.shape.kind).toBe("object");
      if (body?.shape.kind === "object") {
        expect(body.shape.properties).toHaveLength(2);
        const names = body.shape.properties.map((p) => p.name).sort();
        expect(names).toEqual(["email", "name"]);
      }
    });

    it("9. unresolved Axios payload (formData) emits PARTIAL_SHAPE warning but does not suppress method mismatch UND120", async () => {
      const clientCode = `
        import axios from 'axios';
        export function submit(formData: FormData) {
          return axios.post("/api/login", formData);
        }
      `;
      const serverCode = `
        import express from 'express';
        const app = express();
        app.get("/api/login", (req, res) => res.json({ token: "ok" }));
      `;

      const clientDoc = makeDoc("src/client.ts", clientCode);
      const serverDoc = makeDoc("src/server.ts", serverCode);

      const clientParsed = await parser.parse({ document: clientDoc });
      const serverParsed = await parser.parse({ document: serverDoc });

      const clientResult = extractAxiosObservations(clientDoc, clientParsed);
      const serverResult = extractExpressObservations(serverDoc, serverParsed);

      // Client has PARTIAL_SHAPE limitation
      expect(clientResult.warnings).toHaveLength(1);
      expect(clientResult.warnings[0].code).toBe("PARTIAL_SHAPE");
      expect(clientResult.warnings[0].scope).toBe("consumer");
      expect(clientResult.warnings[0].targetDimension).toBe("request-shape");

      // Matcher identifies method-conflict relationship
      const matcher = new ContractMatcher();
      const relationships = matcher.match([
        ...clientResult.observations,
        ...serverResult.observations
      ]);

      expect(relationships).toHaveLength(1);
      const rel = relationships[0];
      expect(rel.matchKind).toBe("method-conflict");

      // UND120 evaluates successfully despite unresolved request payload!
      const obsMap = new Map();
      obsMap.set(clientResult.observations[0].id, clientResult.observations[0]);
      obsMap.set(serverResult.observations[0].id, serverResult.observations[0]);

      const finding = evaluateMethodConflictRule(rel, obsMap);
      expect(finding).toBeDefined();
      expect(finding?.ruleId).toBe("UND120");
      expect(finding?.expected).toBe("POST");
      expect(finding?.observed).toBe("GET");
      expect(finding?.severity).toBe("error");
    });
  });
});
