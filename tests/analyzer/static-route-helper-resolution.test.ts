// Regression test suite for Phase 6.3 Task 3 & Task 3.1: Static API Route Helper & Dynamic Resource Route Resolution
// Verifies module-scope helper callsite resolution, nested application callback eligibility,
// and preservation of known dynamic resource route shapes (/api/posts/:id).

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

describe("Phase 6.3 Task 3.1: Restore Dynamic Resource Route Handling", () => {
  // Test A — Expense Tracker static helper
  it("Test A: resolves static same-file helper callsites cleanly with zero UND100 and zero UND110 (Expense Tracker pattern)", async () => {
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
    expect(result.findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    expect(result.findings.filter((f) => f.ruleId === "UND110")).toHaveLength(0);

    // Verify both matched cleanly
    const exactMatches = result.relationships.filter((r) => r.matchKind === "exact");
    expect(exactMatches).toHaveLength(2);
    expect(result.complete).toBe(true);
  });

  // Test B — Nested React callback with dynamic resource ID
  it("Test B: preserves known route for nested React callback with template literal resource ID (Fullstack Creators Dashboard.jsx pattern)", async () => {
    const serverDoc = makeDoc(
      "file:///server/app.js",
      `
      const express = require('express');
      const app = express();
      const router = express.Router();

      router.delete('/:id', (req, res) => res.json({ success: true }));
      app.use('/api/posts', router);
      `
    );

    const clientDoc = makeDoc(
      "file:///client/src/pages/Dashboard.jsx",
      `
      import axios from 'axios';

      const Dashboard = () => {
        const handleDelete = async (postId) => {
          return axios.delete(\`/api/posts/\${postId}\`);
        };

        return <PostList onDelete={handleDelete} />;
      };

      export default Dashboard;
      `,
      "javascriptreact"
    );

    const engine = new AnalysisEngine({
      parsers: [parser],
      analyzers: [new JsTsAnalyzer()]
    });

    const request: AnalysisRequest = {
      workspaceId: "fullstack-creators-dashboard-test",
      documents: [serverDoc, clientDoc],
      generation: 1
    };

    const result = await engine.analyze(request);

    // Consumer route must be extracted as known /api/posts/:postId
    const consumerObs = result.observations.filter((o) => o.role === "consumer");
    expect(consumerObs).toHaveLength(1);
    expect(consumerObs[0].endpoint.path.state).toBe("known");
    expect(consumerObs[0].endpoint.path.value?.rawPath).toBe("/api/posts/:postId");
    expect(consumerObs[0].endpoint.method.value).toBe("DELETE");

    // Cleanly matches backend DELETE /api/posts/:id with zero findings
    expect(result.findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    expect(result.findings.filter((f) => f.ruleId === "UND110")).toHaveLength(0);
    expect(result.relationships.filter((r) => r.matchKind === "exact")).toHaveLength(1);

    // No completeness-blocking DYNAMIC_ROUTE warning is emitted
    expect(result.warnings.filter((w) => w.code === "DYNAMIC_ROUTE")).toHaveLength(0);
    expect(result.complete).toBe(true);
  });

  // Test C — String concatenation resource route
  it("Test C: preserves known route for nested callback with string concatenation resource ID", async () => {
    const serverDoc = makeDoc(
      "file:///server/app.js",
      `
      const express = require('express');
      const app = express();
      app.delete('/api/posts/:id', (req, res) => res.json({ success: true }));
      `
    );

    const clientDoc = makeDoc(
      "file:///client/src/pages/Dashboard.jsx",
      `
      import axios from 'axios';

      const Dashboard = () => {
        const handleDelete = async (postId) => {
          return axios.delete('/api/posts/' + postId);
        };

        return <PostList onDelete={handleDelete} />;
      };

      export default Dashboard;
      `,
      "javascriptreact"
    );

    const engine = new AnalysisEngine({
      parsers: [parser],
      analyzers: [new JsTsAnalyzer()]
    });

    const request: AnalysisRequest = {
      workspaceId: "string-concat-test",
      documents: [serverDoc, clientDoc],
      generation: 1
    };

    const result = await engine.analyze(request);

    const consumerObs = result.observations.filter((o) => o.role === "consumer");
    expect(consumerObs).toHaveLength(1);
    expect(consumerObs[0].endpoint.path.state).toBe("known");
    expect(consumerObs[0].endpoint.path.value?.rawPath).toBe("/api/posts/:postId");
    expect(consumerObs[0].endpoint.method.value).toBe("DELETE");

    // Clean match, no completeness blocking
    expect(result.findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    expect(result.findings.filter((f) => f.ruleId === "UND110")).toHaveLength(0);
    expect(result.relationships.filter((r) => r.matchKind === "exact")).toHaveLength(1);
    expect(result.complete).toBe(true);
  });

  // Test D — Nested callback without JSX
  it("Test D: preserves known route for nested callback without JSX (event listener / array callback)", async () => {
    const serverDoc = makeDoc(
      "file:///server/app.js",
      `
      const express = require('express');
      const app = express();
      app.delete('/api/items/:id', (req, res) => res.json({ ok: true }));
      `
    );

    const clientDoc = makeDoc(
      "file:///client/src/setup.js",
      `
      import axios from 'axios';

      function setupHandlers(button) {
        const deleteItem = async (itemId) => {
          return axios.delete(\`/api/items/\${itemId}\`);
        };

        button.addEventListener('click', () => deleteItem(123));
      }

      export default setupHandlers;
      `
    );

    const engine = new AnalysisEngine({
      parsers: [parser],
      analyzers: [new JsTsAnalyzer()]
    });

    const request: AnalysisRequest = {
      workspaceId: "nested-non-jsx-test",
      documents: [serverDoc, clientDoc],
      generation: 1
    };

    const result = await engine.analyze(request);

    const consumerObs = result.observations.filter((o) => o.role === "consumer");
    expect(consumerObs).toHaveLength(1);
    expect(consumerObs[0].endpoint.path.state).toBe("known");
    expect(consumerObs[0].endpoint.path.value?.rawPath).toBe("/api/items/:itemId");

    // Matches backend, complete
    expect(result.findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    expect(result.findings.filter((f) => f.ruleId === "UND110")).toHaveLength(0);
    expect(result.complete).toBe(true);
  });

  // Test E — Genuine module-scope helper without callsites
  it("Test E: genuinely uncalled module-scope helper retains conservative dynamic route without fabricating parameter", async () => {
    const clientDoc = makeDoc(
      "file:///client/src/services/api.js",
      `
      const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\\/$/, '');

      // Unexported module-level helper with no callsites
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

  // Test F — Mixed static and dynamic helper callsites
  it("Test F: handles mixed static and dynamic callsites to module helper correctly", async () => {
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

  // Test G — Lexically shadowed identifier
  it("Test G: ignores shadowed references and correctly resolves genuine module helper callsites", async () => {
    const clientDoc = makeDoc(
      "file:///client/src/services/usersApi.js",
      `
      async function requestUser(path, payload) {
        return fetch(\`/api/users/\${path}\`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      // In this function, the parameter requestUser shadows the module-level helper!
      function handleOther(requestUser) {
        requestUser('shadowed-call');
      }

      export const registerUser = (data) => requestUser('register', data);
      export const loginUser = (data) => requestUser('login', data);
      `
    );

    const parsed = await parser.parse({ document: clientDoc });
    const result = extractFetchObservations(clientDoc, parsed);

    // Only genuine module-level callsites (register and login) should be extracted as known endpoints
    const knownObs = result.observations.filter((o) => o.endpoint.path.state === "known");
    expect(knownObs).toHaveLength(2);
    expect(knownObs.map((o) => o.endpoint.path.value?.rawPath).sort()).toEqual([
      "/api/users/login",
      "/api/users/register"
    ]);

    // The shadowed call must not have been extracted as an endpoint or marked the helper as escaping
    const shadowedObs = result.observations.find((o) =>
      o.endpoint.path.value?.rawPath?.includes("shadowed-call")
    );
    expect(shadowedObs).toBeUndefined();
  });

  // Test H — Existing dynamic resource parameter behavior (both fetch and Axios)
  it("Test H: preserves existing dynamic resource route extraction for exported functions across Axios and fetch", async () => {
    const serverDoc = makeDoc(
      "file:///server/app.js",
      `
      const express = require('express');
      const app = express();
      app.get('/api/posts/:id', (req, res) => res.json({ id: req.params.id }));
      app.get('/api/comments/:id', (req, res) => res.json({ id: req.params.id }));
      `
    );

    const clientDoc = makeDoc(
      "file:///client/src/api.js",
      `
      import axios from 'axios';

      export function getPost(id) {
        return axios.get(\`/api/posts/\${id}\`);
      }

      export function getComment(id) {
        return fetch(\`/api/comments/\${id}\`);
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

    const consumerObs = result.observations.filter((o) => o.role === "consumer");
    expect(consumerObs).toHaveLength(2);
    expect(consumerObs.map((o) => o.endpoint.path.value?.rawPath).sort()).toEqual([
      "/api/comments/:id",
      "/api/posts/:id"
    ]);

    // Both match backend providers cleanly
    expect(result.findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    expect(result.findings.filter((f) => f.ruleId === "UND110")).toHaveLength(0);
    expect(result.relationships.filter((r) => r.matchKind === "exact")).toHaveLength(2);
    expect(result.complete).toBe(true);
  });
});
