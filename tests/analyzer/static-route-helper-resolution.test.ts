// Regression test suite for Phase 6.3 Task 3: Static API Route Helper Resolution
// Tests bounded static callsite resolution for route arguments passed to unexported local helper functions.

import { describe, it, expect } from "vitest";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import {
  extractFetchObservations,
  extractAxiosObservations,
  JsTsAnalyzer
} from "@undrift/analyzer-js-ts";
import { AnalysisEngine, type SourceDocument, type AnalysisRequest } from "@undrift/core";

const parser = new TreeSitterParserAdapter();

function makeDoc(uri: string, text: string, languageId = "javascript"): SourceDocument {
  return {
    uri,
    languageId,
    text,
    version: 1,
    contentHash: "hash-" + uri
  };
}

describe("Phase 6.3 Task 3: Static API Route Helper Resolution", () => {
  it("Case 1: resolves static same-file helper callsites cleanly with zero UND100 and zero UND110 (Expense Tracker pattern)", async () => {
    const serverDoc = makeDoc(
      "file:///server/server.js",
      `
      const express = require('express');
      const app = express();
      const userRoutes = require('./routes/user.routes');

      app.use('/api/users', userRoutes);
      `
    );

    const userRoutesDoc = makeDoc(
      "file:///server/routes/user.routes.js",
      `
      const express = require('express');
      const router = express.Router();

      router.post('/register', (req, res) => res.json({ message: 'registered' }));
      router.post('/login', (req, res) => res.json({ token: 'xyz' }));

      module.exports = router;
      `
    );

    const clientDoc = makeDoc(
      "file:///client/src/services/usersApi.js",
      `
      const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\\/$/, '');

      async function requestUser(path, payload) {
        const response = await fetch(\`\${API_BASE_URL}/api/users/\${path}\`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.message || 'Unable to complete request');
        }
        return data;
      }

      export const registerUser = (payload) =>
        requestUser('register', payload);

      export const loginUser = (payload) =>
        requestUser('login', payload);
      `
    );

    const engine = new AnalysisEngine({
      parsers: [parser],
      analyzers: [new JsTsAnalyzer()]
    });

    const request: AnalysisRequest = {
      workspaceId: "expense-tracker-test",
      documents: [serverDoc, userRoutesDoc, clientDoc],
      generation: 1
    };

    const result = await engine.analyze(request);

    // Verify consumer observations:
    // Should have exactly 2 consumer observations: /api/users/register and /api/users/login
    const consumerObs = result.observations.filter((o) => o.role === "consumer");
    expect(consumerObs).toHaveLength(2);

    const registerObs = consumerObs.find(
      (o) => o.endpoint.path.value?.rawPath === "/api/users/register"
    );
    expect(registerObs).toBeDefined();
    expect(registerObs?.endpoint.method.value).toBe("POST");
    expect(registerObs?.endpoint.path.state).toBe("known");

    const loginObs = consumerObs.find((o) => o.endpoint.path.value?.rawPath === "/api/users/login");
    expect(loginObs).toBeDefined();
    expect(loginObs?.endpoint.method.value).toBe("POST");
    expect(loginObs?.endpoint.path.state).toBe("known");

    // Must NOT have fabricated /api/users/:path
    const fabricatedObs = consumerObs.find(
      (o) => o.endpoint.path.value?.rawPath === "/api/users/:path"
    );
    expect(fabricatedObs).toBeUndefined();

    // Verify zero missing-provider findings (UND100) and zero unconsumed-provider findings (UND110)
    const und100Findings = result.findings.filter((f) => f.ruleId === "UND100");
    const und110Findings = result.findings.filter((f) => f.ruleId === "UND110");

    expect(und100Findings).toHaveLength(0);
    expect(und110Findings).toHaveLength(0);

    // Verify both matched cleanly
    const exactMatches = result.relationships.filter((r) => r.matchKind === "exact");
    expect(exactMatches).toHaveLength(2);
  });

  it("Case 2: handles helper with no discoverable callsites without fabricating a known route parameter", async () => {
    const clientDoc = makeDoc(
      "file:///client/src/services/api.js",
      `
      const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\\/$/, '');

      async function requestUser(path, payload) {
        return fetch(\`\${API_BASE_URL}/api/users/\${path}\`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      `
    );

    const parsed = await parser.parse({ document: clientDoc });
    const result = extractFetchObservations(clientDoc, parsed);

    // Does NOT fabricate a known route parameter: path state is dynamic
    expect(result.observations).toHaveLength(1);
    const obs = result.observations[0];
    expect(obs.endpoint.path.state).toBe("dynamic");
    expect(obs.endpoint.path.value).toBeUndefined();

    // Emits advisory DYNAMIC_ROUTE warning with affectsCompleteness = false
    const dynRouteWarn = result.warnings.find((w) => w.code === "DYNAMIC_ROUTE");
    expect(dynRouteWarn).toBeDefined();
    expect(dynRouteWarn?.affectsCompleteness).toBe(false);
  });

  it("Case 3: handles mixed static and unresolved callsites by extracting resolved route and warning for dynamic callsite", async () => {
    const clientDoc = makeDoc(
      "file:///client/src/services/api.js",
      `
      async function requestUser(path, payload) {
        return fetch(\`/api/users/\${path}\`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      export const getProfile = () => requestUser('profile', {});
      export const getCustom = (customPath) => requestUser(customPath, {});
      `
    );

    const parsed = await parser.parse({ document: clientDoc });
    const result = extractFetchObservations(clientDoc, parsed);

    // Should extract 2 observations: 1 static known (/api/users/profile) and 1 dynamic
    expect(result.observations).toHaveLength(2);

    const profileObs = result.observations.find(
      (o) => o.endpoint.path.value?.rawPath === "/api/users/profile"
    );
    expect(profileObs).toBeDefined();
    expect(profileObs?.endpoint.path.state).toBe("known");

    const dynamicObs = result.observations.find((o) => o.endpoint.path.state === "dynamic");
    expect(dynamicObs).toBeDefined();

    // The unresolved dynamic callsite emits a warning with affectsCompleteness: true
    const dynWarn = result.warnings.find(
      (w) => w.code === "DYNAMIC_ROUTE" && w.affectsCompleteness
    );
    expect(dynWarn).toBeDefined();
    expect(dynWarn?.message).toContain("customPath");
  });

  it("Case 4: handles multiple static callsites to the same endpoint without conflicting or duplicate findings", async () => {
    const serverDoc = makeDoc(
      "file:///server/app.js",
      `
      const express = require('express');
      const app = express();
      app.post('/api/users/login', (req, res) => res.json({ token: 'abc' }));
      `
    );

    const clientDoc = makeDoc(
      "file:///client/src/services/auth.js",
      `
      async function requestUser(path, payload) {
        return fetch(\`/api/users/\${path}\`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      export const loginUser = (payload) => requestUser('login', payload);
      export const quickLogin = (payload) => requestUser('login', payload);
      `
    );

    const engine = new AnalysisEngine({
      parsers: [parser],
      analyzers: [new JsTsAnalyzer()]
    });

    const request: AnalysisRequest = {
      workspaceId: "multi-callsite-test",
      documents: [serverDoc, clientDoc],
      generation: 1
    };

    const result = await engine.analyze(request);

    // Both callsites are extracted as distinct consumer observations pointing to /api/users/login
    const consumerObs = result.observations.filter((o) => o.role === "consumer");
    expect(consumerObs).toHaveLength(2);
    expect(consumerObs[0].id).not.toBe(consumerObs[1].id);
    expect(consumerObs[0].endpoint.path.value?.rawPath).toBe("/api/users/login");
    expect(consumerObs[1].endpoint.path.value?.rawPath).toBe("/api/users/login");

    // Both cleanly match the backend provider, with 0 UND100 and 0 UND110
    expect(result.findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    expect(result.findings.filter((f) => f.ruleId === "UND110")).toHaveLength(0);
  });

  it("Case 5: preserves existing dynamic resource route extraction for exported functions", async () => {
    const serverDoc = makeDoc(
      "file:///server/app.js",
      `
      const express = require('express');
      const app = express();
      app.get('/api/posts/:id', (req, res) => res.json({ id: req.params.id }));
      `
    );

    const clientDoc = makeDoc(
      "file:///client/src/api.js",
      `
      import axios from 'axios';

      export function getPost(id) {
        return axios.get(\`/api/posts/\${id}\`);
      }
      `
    );

    const engine = new AnalysisEngine({
      parsers: [parser],
      analyzers: [new JsTsAnalyzer()]
    });

    const request: AnalysisRequest = {
      workspaceId: "dynamic-resource-test",
      documents: [serverDoc, clientDoc],
      generation: 1
    };

    const result = await engine.analyze(request);

    // Exported function parameter segment must remain parameterized (:id)
    const consumerObs = result.observations.filter((o) => o.role === "consumer");
    expect(consumerObs).toHaveLength(1);
    expect(consumerObs[0].endpoint.path.state).toBe("known");
    expect(consumerObs[0].endpoint.path.value?.rawPath).toBe("/api/posts/:id");

    // Cleanly matches backend /api/posts/:id
    expect(result.findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    expect(result.findings.filter((f) => f.ruleId === "UND110")).toHaveLength(0);
    expect(result.relationships.filter((r) => r.matchKind === "exact")).toHaveLength(1);
  });

  it("Case 6: handles escaping helper reference conservatively without unsupported resolution claim", async () => {
    const clientDoc = makeDoc(
      "file:///client/src/services/api.js",
      `
      async function requestUser(path, payload) {
        return fetch(\`/api/users/\${path}\`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      // requestUser escapes by being passed to a higher-order function
      registerMiddleware(requestUser);
      `
    );

    const parsed = await parser.parse({ document: clientDoc });
    const result = extractFetchObservations(clientDoc, parsed);

    // Because helper escapes as a value, it must not fabricate concrete routes
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].endpoint.path.state).toBe("dynamic");

    // Emits DYNAMIC_ROUTE warning with affectsCompleteness: true
    const dynWarn = result.warnings.find((w) => w.code === "DYNAMIC_ROUTE");
    expect(dynWarn).toBeDefined();
    expect(dynWarn?.affectsCompleteness).toBe(true);
  });
});
