// Comprehensive regression tests for Effective Route Resolution & Dynamic URL Analysis
// Conforms to Phase 6 Real-World Scan Reliability requirements across Workstreams A, B, C, and D.

import { describe, expect, it } from "vitest";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import {
  extractAxiosObservations,
  extractExpressObservations,
  extractFetchObservations,
  ExpressMountRegistry,
  combineRoutePaths,
  JsTsAnalyzer,
  createLocalDeclarationIndex,
  createLocalReferenceResolver
} from "@undrift/analyzer-js-ts";
import { AnalysisEngine, type SourceDocument, type AnalysisRequest } from "@undrift/core";

const parser = new TreeSitterParserAdapter();

function makeDoc(uri: string, text: string, languageId = "javascript"): SourceDocument {
  return {
    uri,
    languageId,
    text,
    contentHash: "hash-" + uri
  };
}

describe("Effective Route Resolution & Dynamic URL Analysis", () => {
  describe("Workstream A: Express mount prefixes and effective routes", () => {
    it("composes child router path with static mount prefix (POST /api/auth/login)", async () => {
      const serverDoc = makeDoc(
        "file:///server/app.js",
        `
        const express = require('express');
        const app = express();
        const authRoutes = require('./routes/auth.routes');
        app.use('/api/auth', authRoutes);
        `
      );

      const authRouterDoc = makeDoc(
        "file:///server/routes/auth.routes.js",
        `
        const express = require('express');
        const router = express.Router();
        router.post('/login', (req, res) => res.json({ token: 'abc' }));
        router.post('/register', (req, res) => res.json({ ok: true }));
        module.exports = router;
        `
      );

      const serverParsed = await parser.parse({ document: serverDoc });
      const authParsed = await parser.parse({ document: authRouterDoc });

      const mountRegistry = ExpressMountRegistry.build([
        { document: serverDoc, parsed: serverParsed },
        { document: authRouterDoc, parsed: authParsed }
      ]);

      const authObs = extractExpressObservations(
        authRouterDoc,
        authParsed,
        undefined,
        mountRegistry
      );

      expect(authObs.observations).toHaveLength(2);

      const loginObs = authObs.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/auth/login"
      );
      expect(loginObs).toBeDefined();
      expect(loginObs?.endpoint.method.value).toBe("POST");

      const registerObs = authObs.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/auth/register"
      );
      expect(registerObs).toBeDefined();
      expect(registerObs?.endpoint.method.value).toBe("POST");
    });

    it("normalizes root child route mounted under prefix (GET / -> GET /api/posts)", async () => {
      const serverDoc = makeDoc(
        "file:///server/app.js",
        `
        const express = require('express');
        const app = express();
        const postRoutes = require('./routes/post.routes');
        app.use('/api/posts', postRoutes);
        `
      );

      const postRouterDoc = makeDoc(
        "file:///server/routes/post.routes.js",
        `
        const express = require('express');
        const router = express.Router();
        router.get('/', (req, res) => res.json([]));
        router.delete('/:id', (req, res) => res.json({ deleted: true }));
        module.exports = router;
        `
      );

      const serverParsed = await parser.parse({ document: serverDoc });
      const postParsed = await parser.parse({ document: postRouterDoc });

      const mountRegistry = ExpressMountRegistry.build([
        { document: serverDoc, parsed: serverParsed },
        { document: postRouterDoc, parsed: postParsed }
      ]);

      const postObs = extractExpressObservations(
        postRouterDoc,
        postParsed,
        undefined,
        mountRegistry
      );

      expect(postObs.observations).toHaveLength(2);

      const rootObs = postObs.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/posts"
      );
      expect(rootObs).toBeDefined();
      expect(rootObs?.endpoint.method.value).toBe("GET");

      const paramObs = postObs.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/posts/:id"
      );
      expect(paramObs).toBeDefined();
      expect(paramObs?.endpoint.method.value).toBe("DELETE");
    });

    it("resolves nested transitive router mounts across multiple files (Cubit PERN pattern)", async () => {
      // server.js -> mounts cubit.routes.js at /api
      const serverDoc = makeDoc(
        "file:///server/server.js",
        `
        const express = require('express');
        const app = express();
        const cubitRoutes = require('./routes/cubit.routes');
        app.use('/api', cubitRoutes);
        `
      );

      // cubit.routes.js -> mounts notification.routes.js at /notifications
      const cubitRoutesDoc = makeDoc(
        "file:///server/routes/cubit.routes.js",
        `
        const express = require('express');
        const router = express.Router();
        const notificationRoutes = require('./notification.routes');
        const communityRoutes = require('./community.routes');
        router.use('/notifications', notificationRoutes);
        router.use('/community', communityRoutes);
        module.exports = router;
        `
      );

      // notification.routes.js -> declares /read-all
      const notifDoc = makeDoc(
        "file:///server/routes/notification.routes.js",
        `
        const express = require('express');
        const router = express.Router();
        router.patch('/read-all', (req, res) => res.json({ ok: true }));
        router.patch('/:id/read', (req, res) => res.json({ ok: true }));
        module.exports = router;
        `
      );

      const serverParsed = await parser.parse({ document: serverDoc });
      const cubitParsed = await parser.parse({ document: cubitRoutesDoc });
      const notifParsed = await parser.parse({ document: notifDoc });

      const mountRegistry = ExpressMountRegistry.build([
        { document: serverDoc, parsed: serverParsed },
        { document: cubitRoutesDoc, parsed: cubitParsed },
        { document: notifDoc, parsed: notifParsed }
      ]);

      const notifObs = extractExpressObservations(notifDoc, notifParsed, undefined, mountRegistry);

      expect(notifObs.observations).toHaveLength(2);

      const readAllObs = notifObs.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/notifications/read-all"
      );
      expect(readAllObs).toBeDefined();
      expect(readAllObs?.endpoint.method.value).toBe("PATCH");

      const paramObs = notifObs.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/notifications/:id/read"
      );
      expect(paramObs).toBeDefined();
      expect(paramObs?.endpoint.method.value).toBe("PATCH");
    });

    it("composes chained router.route() declarations under mounted prefix", async () => {
      const serverDoc = makeDoc(
        "file:///server/app.js",
        `
        const express = require('express');
        const app = express();
        const userRoutes = require('./routes/users');
        app.use('/api/v1/users', userRoutes);
        `
      );

      const userRoutesDoc = makeDoc(
        "file:///server/routes/users.js",
        `
        const express = require('express');
        const router = express.Router();
        router.route('/profile')
          .get((req, res) => res.json({}))
          .put((req, res) => res.json({}));
        module.exports = router;
        `
      );

      const serverParsed = await parser.parse({ document: serverDoc });
      const userParsed = await parser.parse({ document: userRoutesDoc });

      const mountRegistry = ExpressMountRegistry.build([
        { document: serverDoc, parsed: serverParsed },
        { document: userRoutesDoc, parsed: userParsed }
      ]);

      const userObs = extractExpressObservations(
        userRoutesDoc,
        userParsed,
        undefined,
        mountRegistry
      );
      expect(userObs.observations).toHaveLength(2);

      const getProfile = userObs.observations.find((o) => o.endpoint.method.value === "GET");
      expect(getProfile?.endpoint.path.value?.rawPath).toBe("/api/v1/users/profile");

      const putProfile = userObs.observations.find((o) => o.endpoint.method.value === "PUT");
      expect(putProfile?.endpoint.path.value?.rawPath).toBe("/api/v1/users/profile");
    });

    it("conservatively emits DYNAMIC_ROUTE warning for unresolved dynamic mount prefix", async () => {
      const serverDoc = makeDoc(
        "file:///server/app.js",
        `
        const express = require('express');
        const app = express();
        const dynamicPrefix = getDynamicPrefix();
        const router = require('./routes/child');
        app.use(dynamicPrefix, router);
        `
      );

      const serverParsed = await parser.parse({ document: serverDoc });
      const mountRegistry = ExpressMountRegistry.build([
        { document: serverDoc, parsed: serverParsed }
      ]);

      const childDoc = makeDoc(
        "file:///server/routes/child.js",
        `
        const express = require('express');
        const router = express.Router();
        router.get('/endpoint', (req, res) => res.json({}));
        module.exports = router;
        `
      );

      const childParsed = await parser.parse({ document: childDoc });
      const childObs = extractExpressObservations(childDoc, childParsed, undefined, mountRegistry);

      expect(childObs.warnings.some((w) => w.code === "DYNAMIC_ROUTE")).toBe(true);
      expect(childObs.observations[0].endpoint.path.state).toBe("dynamic");
    });
  });

  describe("Workstream B: Composed URL templates", () => {
    it("extracts static path from template with base URL and query builder (Expense Tracker pattern)", async () => {
      const clientDoc = makeDoc(
        "file:///client/services/transactionsApi.js",
        `
        const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\\/$/, '');
        function buildQueryString(params) { return '?q=1'; }

        export async function fetchTransactions(params) {
          return fetch(\`\${API_BASE_URL}/api/transactions\${buildQueryString(params)}\`);
        }

        export async function fetchCategoryReport(params) {
          return fetch(\`\${API_BASE_URL}/api/transactions/reports/categories\${buildQueryString(params)}\`);
        }
        `
      );

      const parsed = await parser.parse({ document: clientDoc });
      const result = extractFetchObservations(clientDoc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(2);

      const txObs = result.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/transactions"
      );
      expect(txObs).toBeDefined();
      expect(txObs?.endpoint.path.state).toBe("known");
      expect(txObs?.endpoint.path.value?.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "transactions" }
      ]);

      const reportObs = result.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/transactions/reports/categories"
      );
      expect(reportObs).toBeDefined();
      expect(reportObs?.endpoint.path.state).toBe("known");
    });

    it("extracts path parameter from template with base URL (${API_BASE_URL}/api/users/${path})", async () => {
      const clientDoc = makeDoc(
        "file:///client/services/usersApi.js",
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

      expect(result.warnings.filter((w) => w.code === "DYNAMIC_ROUTE")).toHaveLength(0);
      expect(result.observations).toHaveLength(1);

      const userObs = result.observations[0];
      expect(userObs.endpoint.path.state).toBe("known");
      expect(userObs.endpoint.path.value?.rawPath).toBe("/api/users/:path");
      expect(userObs.endpoint.path.value?.segments).toEqual([
        { kind: "static", value: "api" },
        { kind: "static", value: "users" },
        { kind: "parameter", name: "path" }
      ]);
    });

    it("correctly handles URL origin stripping with constant base URL", async () => {
      const clientDoc = makeDoc(
        "file:///client/api.js",
        `
        const API_URL = "http://localhost:5000/api/v1";

        export function getUsers() {
          return fetch(\`\${API_URL}/users\`);
        }
        `
      );

      const parsed = await parser.parse({ document: clientDoc });
      const index = createLocalDeclarationIndex([{ document: clientDoc, parsed }]);
      const resolver = createLocalReferenceResolver(index);
      const result = extractFetchObservations(clientDoc, parsed, undefined, resolver);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      expect(result.observations[0].endpoint.path.value?.rawPath).toBe("/api/v1/users");
    });
  });

  describe("Workstream C: Cubit Axios helper url pattern & Axios baseURL", () => {
    it("resolves Cubit Axios helper url with query concatenation and client baseURL (/api/community/posts)", async () => {
      const clientDoc = makeDoc(
        "file:///client/src/services/api.js",
        `
        import axios from 'axios';

        const API_BASE_URL = 'http://localhost:5000/api';

        const api = axios.create({
          baseURL: API_BASE_URL,
        });

        export const communityAPI = {
          getPosts: (feed = 'global', type = '') => {
            let url = \`/community/posts?feed=\${feed}\`;
            if (type) url += \`&type=\${type}\`;
            return api.get(url);
          },
          getNotifications: () => api.get('/notifications'),
          markAllAsRead: () => api.patch('/notifications/read-all'),
        };
        `
      );

      const parsed = await parser.parse({ document: clientDoc });
      const index = createLocalDeclarationIndex([{ document: clientDoc, parsed }]);
      const resolver = createLocalReferenceResolver(index);
      const result = extractAxiosObservations(clientDoc, parsed, undefined, resolver);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(3);

      const postsObs = result.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/community/posts"
      );
      expect(postsObs).toBeDefined();
      expect(postsObs?.endpoint.method.value).toBe("GET");
      expect(postsObs?.endpoint.path.state).toBe("known");

      const notifObs = result.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/notifications"
      );
      expect(notifObs).toBeDefined();

      const readAllObs = result.observations.find(
        (o) => o.endpoint.path.value?.rawPath === "/api/notifications/read-all"
      );
      expect(readAllObs).toBeDefined();
      expect(readAllObs?.endpoint.method.value).toBe("PATCH");
    });

    it("honestly retains DYNAMIC_ROUTE warning for genuinely unresolved dynamic URL parameter", async () => {
      const clientDoc = makeDoc(
        "file:///client/src/services/api.js",
        `
        import axios from 'axios';
        const api = axios.create({ baseURL: '/api' });

        function genericFetch(url) {
          return api.get(url);
        }
        `
      );

      const parsed = await parser.parse({ document: clientDoc });
      const result = extractAxiosObservations(clientDoc, parsed);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DYNAMIC_ROUTE");
      expect(result.warnings[0].affectsCompleteness).toBe(true);
      expect(result.observations[0].endpoint.path.state).toBe("dynamic");
    });
  });

  describe("Workstream D: End-to-end integration and finding-specific completeness", () => {
    it("matches client and provider routes with complete scan status across a full multi-document app", async () => {
      const serverDoc = makeDoc(
        "file:///app/server/app.js",
        `
        const express = require('express');
        const app = express();
        const authRoutes = require('./routes/auth.routes');
        const postRoutes = require('./routes/post.routes');

        app.use('/api/auth', authRoutes);
        app.use('/api/posts', postRoutes);
        `
      );

      const authRoutesDoc = makeDoc(
        "file:///app/server/routes/auth.routes.js",
        `
        const express = require('express');
        const router = express.Router();
        router.post('/login', (req, res) => res.json({ token: 'xyz' }));
        router.post('/register', (req, res) => res.json({ id: 1 }));
        module.exports = router;
        `
      );

      const postRoutesDoc = makeDoc(
        "file:///app/server/routes/post.routes.js",
        `
        const express = require('express');
        const router = express.Router();
        router.get('/', (req, res) => res.json([]));
        router.delete('/:id', (req, res) => res.json({ deleted: true }));
        module.exports = router;
        `
      );

      const clientDoc = makeDoc(
        "file:///app/client/src/api.js",
        `
        import axios from 'axios';
        const api = axios.create({ baseURL: 'http://localhost:5000' });

        export const authAPI = {
          login: (creds) => api.post('/api/auth/login', creds),
          register: (data) => api.post('/api/auth/register', data),
        };

        export const postAPI = {
          getPosts: () => api.get('/api/posts'),
          deletePost: (id) => api.delete(\`/api/posts/\${id}\`),
        };
        `
      );

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [new JsTsAnalyzer()]
      });

      const request: AnalysisRequest = {
        workspaceId: "ws-mern",
        documents: [serverDoc, authRoutesDoc, postRoutesDoc, clientDoc],
        generation: 1
      };

      const result = await engine.analyze(request);

      expect(result.complete).toBe(true);
      expect(result.warnings.filter((w) => w.code === "DYNAMIC_ROUTE")).toHaveLength(0);

      // Verify that all 4 consumer calls match the 4 provider routes with 0 missing-provider findings
      const missingProviderFindings = result.findings.filter((f) => f.ruleId === "UND100");
      expect(missingProviderFindings).toHaveLength(0);

      // Verify exact matches exist
      expect(result.relationships.filter((r) => r.matchKind === "exact")).toHaveLength(4);
    });

    it("ensures an unresolved dynamic helper URL does not invalidate unrelated complete routes", async () => {
      const serverDoc = makeDoc(
        "file:///app/server/app.js",
        `
        const express = require('express');
        const app = express();
        app.get('/api/health', (req, res) => res.json({ ok: true }));
        `
      );

      const clientDoc = makeDoc(
        "file:///app/client/api.js",
        `
        import axios from 'axios';
        // 1. Static call that matches server route
        export const checkHealth = () => axios.get('/api/health');

        // 2. Unresolved dynamic helper
        export const dynamicFetch = (unknownUrl) => axios.get(unknownUrl);
        `
      );

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [new JsTsAnalyzer()]
      });

      const request: AnalysisRequest = {
        workspaceId: "ws-partial",
        documents: [serverDoc, clientDoc],
        generation: 1
      };

      const result = await engine.analyze(request);

      // The overall scan has an unresolved dynamic route warning
      expect(result.warnings.some((w) => w.code === "DYNAMIC_ROUTE")).toBe(true);

      // But the health endpoint matched cleanly!
      const healthConsumer = result.observations.find(
        (o) => o.role === "consumer" && o.endpoint.path.value?.rawPath === "/api/health"
      );
      expect(healthConsumer).toBeDefined();

      const healthRel = result.relationships.find(
        (r) => r.consumerId === healthConsumer?.id && r.matchKind === "exact"
      );
      expect(healthRel).toBeDefined();

      // No false missing-provider finding for /api/health
      const healthMissingFinding = result.findings.find(
        (f) => f.ruleId === "UND100" && f.expected?.includes("/api/health")
      );
      expect(healthMissingFinding).toBeUndefined();
    });
  });
});
