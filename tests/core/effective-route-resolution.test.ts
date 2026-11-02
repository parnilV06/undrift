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

    it("handles unexported helper without callsites conservatively without fabricating parameter (Expense Tracker pattern)", async () => {
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

      const dynamicRouteWarnings = result.warnings.filter((w) => w.code === "DYNAMIC_ROUTE");
      expect(dynamicRouteWarnings).toHaveLength(1);
      expect(dynamicRouteWarnings[0].affectsCompleteness).toBe(false);
      expect(result.observations).toHaveLength(1);

      const userObs = result.observations[0];
      expect(userObs.endpoint.path.state).toBe("dynamic");
      expect(userObs.endpoint.path.value).toBeUndefined();
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

  describe("Workstream E: Next.js API client & base URL resolution reliability", () => {
    it("resolves template base URL with dynamic authority and port interpolation (Cubit test-auth.js pattern)", async () => {
      const serverDoc = makeDoc(
        "file:///server/app.js",
        `
        const express = require('express');
        const app = express();
        app.post('/api/auth/register', (req, res) => res.status(201).json({ success: true }));
        app.post('/api/auth/login', (req, res) => res.json({ success: true }));
        `
      );

      const testAuthDoc = makeDoc(
        "file:///server/test-auth.js",
        `
        const PORT = 5001;
        const BASE_URL = \`http://localhost:\${PORT}/api\`;

        async function run() {
          await fetch(\`\${BASE_URL}/auth/register\`, { method: 'POST' });
          await fetch(\`\${BASE_URL}/auth/login\`, { method: 'POST' });
        }
        `
      );

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [new JsTsAnalyzer()]
      });

      const request: AnalysisRequest = {
        workspaceId: "cubit-auth-test",
        documents: [serverDoc, testAuthDoc],
        generation: 1
      };

      const result = await engine.analyze(request);

      expect(result.complete).toBe(true);
      const registerConsumer = result.observations.find(
        (o) => o.role === "consumer" && o.endpoint.path.value?.rawPath === "/api/auth/register"
      );
      expect(registerConsumer).toBeDefined();
      expect(registerConsumer?.endpoint.method.value).toBe("POST");

      // Verify exact match exists
      const exactRel = result.relationships.find(
        (r) => r.consumerId === registerConsumer?.id && r.matchKind === "exact"
      );
      expect(exactRel).toBeDefined();

      // Zero UND100 missing provider findings
      const missingFindings = result.findings.filter((f) => f.ruleId === "UND100");
      expect(missingFindings).toHaveLength(0);
    });

    it("extracts client fetch helper wrapper calls (request<T>) without failing completeness on wrapper parameter forwarding", async () => {
      const clientDoc = makeDoc(
        "file:///app/lib/api/client.ts",
        `
        export async function request(url: string, options?: any) {
          return fetch(url, options);
        }
        `,
        "typescript"
      );

      const authDoc = makeDoc(
        "file:///app/lib/api/auth.ts",
        `
        import { request } from './client';
        export async function login(data: any) {
          return request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
        }
        `,
        "typescript"
      );

      const serverDoc = makeDoc(
        "file:///app/api/auth/login/route.ts",
        `
        export async function POST(req: Request) {
          return Response.json({ ok: true });
        }
        `,
        "typescript"
      );

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [new JsTsAnalyzer()]
      });

      const request: AnalysisRequest = {
        workspaceId: "nextjs-client-wrapper",
        documents: [clientDoc, authDoc, serverDoc],
        generation: 1
      };

      const result = await engine.analyze(request);

      expect(result.complete).toBe(true);
      const consumer = result.observations.find(
        (o) => o.role === "consumer" && o.endpoint.path.value?.rawPath === "/api/auth/login"
      );
      expect(consumer).toBeDefined();
      expect(consumer?.endpoint.method.value).toBe("POST");

      // Generic transport helper parameter resolved across workspace without spurious dynamic route warning
      const paramWarn = result.warnings.find(
        (w) => w.code === "DYNAMIC_ROUTE" && w.source.uri.includes("client.ts")
      );
      expect(paramWarn).toBeUndefined();

      // Verify exact match with Next.js App Router POST /api/auth/login
      const exactRel = result.relationships.find(
        (r) => r.consumerId === consumer?.id && r.matchKind === "exact"
      );
      expect(exactRel).toBeDefined();
      expect(result.findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    });

    it("resolves locally initialized variable with template string conditional query (classes.ts pattern)", async () => {
      const clientDoc = makeDoc(
        "file:///app/lib/api/classes.ts",
        `
        import { request } from './client';
        export async function getClasses(query?: string) {
          const url = \`/api/classes\${query ? \`?\${query}\` : ''}\`;
          return request(url, { method: 'GET' });
        }
        `,
        "typescript"
      );

      const serverDoc = makeDoc(
        "file:///app/api/classes/route.ts",
        `
        export async function GET() {
          return Response.json([]);
        }
        `,
        "typescript"
      );

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [new JsTsAnalyzer()]
      });

      const request: AnalysisRequest = {
        workspaceId: "nextjs-classes",
        documents: [clientDoc, serverDoc],
        generation: 1
      };

      const result = await engine.analyze(request);

      expect(result.complete).toBe(true);
      const consumer = result.observations.find(
        (o) => o.role === "consumer" && o.endpoint.path.value?.rawPath === "/api/classes"
      );
      expect(consumer).toBeDefined();
      expect(consumer?.endpoint.method.value).toBe("GET");
      expect(result.findings.filter((f) => f.ruleId === "UND100")).toHaveLength(0);
    });
  });

  describe("Workstream E: Phase 6.3 Next.js Dynamic Route Normalization & Matching", () => {
    it("matches percent-encoded provider routes against dynamic consumer endpoints (SlotTrack regression)", async () => {
      // Consumers: classes.ts calling GET, PATCH, DELETE /api/classes/:id and bookings.ts calling PATCH /api/bookings/:id
      const clientDoc = makeDoc(
        "file:///app/lib/api/endpoints.ts",
        `
        import { request } from './client';
        export async function getClass(id: string) {
          return request(\`/api/classes/\${id}\`, { method: 'GET' });
        }
        export async function updateClass(id: string, data: any) {
          return request(\`/api/classes/\${id}\`, { method: 'PATCH', body: JSON.stringify(data) });
        }
        export async function deleteClass(id: string) {
          return request(\`/api/classes/\${id}\`, { method: 'DELETE' });
        }
        export async function updateBooking(id: string, data: any) {
          return request(\`/api/bookings/\${id}\`, { method: 'PATCH', body: JSON.stringify(data) });
        }
        `,
        "typescript"
      );

      // Providers: simulated VS Code URI-encoded documents with %5Bid%5D
      const classServerDoc = makeDoc(
        "file:///z:/OLD%20PC%20Files/parnil%20-%20My%20Files/SlotTrack/app/api/classes/%5Bid%5D/route.ts",
        `
        export async function GET(req: Request) { return Response.json({}); }
        export async function PATCH(req: Request) { return Response.json({}); }
        export async function DELETE(req: Request) { return Response.json({}); }
        `,
        "typescript"
      );

      const bookingServerDoc = makeDoc(
        "file:///z:/OLD%20PC%20Files/parnil%20-%20My%20Files/SlotTrack/app/api/bookings/%5Bid%5D/route.ts",
        `
        export async function PATCH(req: Request) { return Response.json({}); }
        `,
        "typescript"
      );

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [new JsTsAnalyzer()]
      });

      const request: AnalysisRequest = {
        workspaceId: "slottrack-regression",
        documents: [clientDoc, classServerDoc, bookingServerDoc],
        generation: 1
      };

      const result = await engine.analyze(request);

      expect(result.complete).toBe(true);

      // All 4 consumer endpoints must have exact matches
      const exactMatches = result.relationships.filter((r) => r.matchKind === "exact");
      expect(exactMatches).toHaveLength(4);

      // 0 UND100 missing provider findings
      const und100Findings = result.findings.filter((f) => f.ruleId === "UND100");
      expect(und100Findings).toHaveLength(0);

      // 0 orphaned provider findings for these matched endpoints
      const und110Findings = result.findings.filter((f) => f.ruleId === "UND110");
      expect(und110Findings).toHaveLength(0);
    });

    it("preserves genuine UND100 finding when a provider endpoint is truly missing", async () => {
      const clientDoc = makeDoc(
        "file:///app/lib/api/missing.ts",
        `
        import { request } from './client';
        export async function deletePayment(id: string) {
          return request(\`/api/payments/\${id}\`, { method: 'DELETE' });
        }
        `,
        "typescript"
      );

      // Provider only exports bookings, NOT payments
      const bookingServerDoc = makeDoc(
        "file:///app/api/bookings/%5Bid%5D/route.ts",
        `
        export async function PATCH(req: Request) { return Response.json({}); }
        `,
        "typescript"
      );

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [new JsTsAnalyzer()]
      });

      const result = await engine.analyze({
        workspaceId: "missing-provider-test",
        documents: [clientDoc, bookingServerDoc],
        generation: 1
      });

      // Must detect genuine missing DELETE /api/payments/:id endpoint
      const missingFindings = result.findings.filter((f) => f.ruleId === "UND100");
      expect(missingFindings).toHaveLength(1);
      expect(missingFindings[0].summary).toContain("DELETE /api/payments/:id");
    });

    it("preserves method mismatch finding when path matches but method differs", async () => {
      const clientDoc = makeDoc(
        "file:///app/lib/api/method-mismatch.ts",
        `
        import { request } from './client';
        export async function postClass(id: string) {
          return request(\`/api/classes/\${id}\`, { method: 'POST' });
        }
        `,
        "typescript"
      );

      // Provider only exports GET
      const classServerDoc = makeDoc(
        "file:///app/api/classes/%5Bid%5D/route.ts",
        `
        export async function GET(req: Request) { return Response.json({}); }
        `,
        "typescript"
      );

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [new JsTsAnalyzer()]
      });

      const result = await engine.analyze({
        workspaceId: "method-mismatch-test",
        documents: [clientDoc, classServerDoc],
        generation: 1
      });

      const methodConflict = result.relationships.find((r) => r.matchKind === "method-conflict");
      expect(methodConflict).toBeDefined();
    });

    it("does not match literal percent-encoded consumer URL against dynamic route provider", async () => {
      const clientDoc = makeDoc(
        "file:///app/lib/api/literal.ts",
        `
        import { request } from './client';
        export async function getLiteral() {
          return request('/api/classes/%5Bid%5D', { method: 'GET' });
        }
        `,
        "typescript"
      );

      const classServerDoc = makeDoc(
        "file:///app/api/classes/%5Bid%5D/route.ts",
        `
        export async function GET(req: Request) { return Response.json({}); }
        `,
        "typescript"
      );

      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [new JsTsAnalyzer()]
      });

      const result = await engine.analyze({
        workspaceId: "literal-url-test",
        documents: [clientDoc, classServerDoc],
        generation: 1
      });

      // Consumer is requesting literal "%5Bid%5D" static segment, provider offers dynamic parameter ":id"
      // They must NOT match as an exact match
      const exactMatch = result.relationships.find((r) => r.matchKind === "exact");
      expect(exactMatch).toBeUndefined();
    });
  });

  describe("Workstream E: Safe Request Payload Shape Resolution (Phase 6.3 Task 2)", () => {
    it("Case 1: resolves direct object literal request payload", async () => {
      const doc = makeDoc(
        "file:///client/api.js",
        `
        axios.post('/api/users', { name: 'Alice', age: 30 });
        `
      );
      const parsed = await parser.parse({ document: doc });
      const result = extractAxiosObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      const body = result.observations[0].endpoint.request?.body;
      expect(body?.completeness).toBe("complete");
      expect(body?.shape.kind).toBe("object");
      if (body?.shape.kind === "object") {
        expect(body.shape.properties).toHaveLength(2);
        expect(body.shape.properties.map((p) => p.name)).toEqual(["name", "age"]);
      }
    });

    it("Case 2: resolves local const object alias payload", async () => {
      const doc = makeDoc(
        "file:///client/api.js",
        `
        const payload = { title: 'Post', count: 10 };
        axios.post('/api/posts', payload);
        `
      );
      const parsed = await parser.parse({ document: doc });
      const localIndex = createLocalDeclarationIndex([{ document: doc, parsed }]);
      const localResolver = createLocalReferenceResolver(localIndex);
      const result = extractAxiosObservations(doc, parsed, undefined, localResolver);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      const body = result.observations[0].endpoint.request?.body;
      expect(body?.completeness).toBe("complete");
      if (body?.shape.kind === "object") {
        expect(body.shape.properties.map((p) => p.name)).toEqual(["title", "count"]);
      }
    });

    it("Case 3: resolves object with shorthand properties using local constant values", async () => {
      const doc = makeDoc(
        "file:///client/api.js",
        `
        const name = "Alice";
        const payload = { name, active: true };
        axios.post('/api/users', payload);
        `
      );
      const parsed = await parser.parse({ document: doc });
      const localIndex = createLocalDeclarationIndex([{ document: doc, parsed }]);
      const localResolver = createLocalReferenceResolver(localIndex);
      const result = extractAxiosObservations(doc, parsed, undefined, localResolver);

      expect(result.warnings).toHaveLength(0);
      const body = result.observations[0].endpoint.request?.body;
      expect(body?.completeness).toBe("complete");
      if (body?.shape.kind === "object") {
        const nameProp = body.shape.properties.find((p) => p.name === "name");
        expect(nameProp?.type).toEqual({ kind: "literal", value: "Alice" });
      }
    });

    it("Case 4: resolves object with spread of another known local object", async () => {
      const doc = makeDoc(
        "file:///client/api.js",
        `
        const base = { role: 'user', active: true };
        const payload = { ...base, username: 'alice' };
        axios.post('/api/users', payload);
        `
      );
      const parsed = await parser.parse({ document: doc });
      const localIndex = createLocalDeclarationIndex([{ document: doc, parsed }]);
      const localResolver = createLocalReferenceResolver(localIndex);
      const result = extractAxiosObservations(doc, parsed, undefined, localResolver);

      expect(result.warnings).toHaveLength(0);
      const body = result.observations[0].endpoint.request?.body;
      expect(body?.completeness).toBe("complete");
      if (body?.shape.kind === "object") {
        expect(body.shape.properties.map((p) => p.name)).toEqual(["role", "active", "username"]);
      }
    });

    it("Case 5: resolves React useState initial object state forwarded to axios (Fullstack Creators pattern)", async () => {
      const doc = makeDoc(
        "file:///client/CreatePost.jsx",
        `
        const [formData, setFormData] = useState({
          title: '',
          content: '',
          category: 'Tech',
          status: 'published'
        });
        api.post('/api/posts', formData);
        `
      );
      const parsed = await parser.parse({ document: doc });
      const localIndex = createLocalDeclarationIndex([{ document: doc, parsed }]);
      const localResolver = createLocalReferenceResolver(localIndex);
      const result = extractAxiosObservations(doc, parsed, undefined, localResolver);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      const body = result.observations[0].endpoint.request?.body;
      expect(body?.completeness).toBe("complete");
      if (body?.shape.kind === "object") {
        expect(body.shape.properties.map((p) => p.name)).toEqual([
          "title",
          "content",
          "category",
          "status"
        ]);
      }
    });

    it("Case 6: resolves inline TypeScript parameter type annotation in fetch wrapper (SlotTrack pattern)", async () => {
      const doc = makeDoc(
        "file:///app/lib/api/auth.ts",
        `
        export async function updateProfile(data: { name: string; age?: number; gender?: string }) {
          return request('/api/auth/profile', {
            method: 'PATCH',
            body: JSON.stringify(data)
          });
        }
        `,
        "typescript"
      );
      const parsed = await parser.parse({ document: doc });
      const result = extractFetchObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      const body = result.observations[0].endpoint.request?.body;
      expect(body?.completeness).toBe("complete");
      if (body?.shape.kind === "object") {
        expect(body.shape.properties.map((p) => p.name)).toEqual(["name", "age", "gender"]);
        const ageProp = body.shape.properties.find((p) => p.name === "age");
        expect(ageProp?.presence).toBe("optional");
        expect(ageProp?.type).toEqual({ kind: "primitive", name: "number" });
      }
    });

    it("Case 7: resolves TypeScript parameter referencing local interface declaration", async () => {
      const doc = makeDoc(
        "file:///app/lib/api/users.ts",
        `
        interface UserInput {
          name: string;
          email: string;
          age?: number;
        }

        export async function createUser(data: UserInput) {
          return request('/api/users', {
            method: 'POST',
            body: JSON.stringify(data)
          });
        }
        `,
        "typescript"
      );
      const parsed = await parser.parse({ document: doc });
      const localIndex = createLocalDeclarationIndex([{ document: doc, parsed }]);
      const localResolver = createLocalReferenceResolver(localIndex);
      const result = extractFetchObservations(doc, parsed, undefined, localResolver);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      const body = result.observations[0].endpoint.request?.body;
      expect(body?.completeness).toBe("complete");
      if (body?.shape.kind === "object") {
        expect(body.shape.properties.map((p) => p.name)).toEqual(["name", "email", "age"]);
      }
    });

    it("Case 8: resolves TypeScript parameter referencing local type alias declaration", async () => {
      const doc = makeDoc(
        "file:///app/lib/api/posts.ts",
        `
        type CreatePostInput = {
          title: string;
          content: string;
          isDraft?: boolean;
        };

        export async function createPost(data: CreatePostInput) {
          return request('/api/posts', {
            method: 'POST',
            body: JSON.stringify(data)
          });
        }
        `,
        "typescript"
      );
      const parsed = await parser.parse({ document: doc });
      const localIndex = createLocalDeclarationIndex([{ document: doc, parsed }]);
      const localResolver = createLocalReferenceResolver(localIndex);
      const result = extractFetchObservations(doc, parsed, undefined, localResolver);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      const body = result.observations[0].endpoint.request?.body;
      expect(body?.completeness).toBe("complete");
      if (body?.shape.kind === "object") {
        expect(body.shape.properties.map((p) => p.name)).toEqual(["title", "content", "isDraft"]);
      }
    });

    it("Case 9: synthesizes payload from local API wrapper callsites when all callers pass consistent object literals", async () => {
      const doc = makeDoc(
        "file:///client/services/api.js",
        `
        function submitPost(payload) {
          return fetch('/api/posts', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        }

        submitPost({ title: 'First Post', content: 'Hello' });
        submitPost({ title: 'Second Post', content: 'World' });
        `
      );
      const parsed = await parser.parse({ document: doc });
      const result = extractFetchObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      const obs = result.observations.find((o) => o.endpoint.path.value?.rawPath === "/api/posts");
      const body = obs?.endpoint.request?.body;
      expect(body?.completeness).toBe("complete");
      if (body?.shape.kind === "object") {
        expect(body.shape.properties.map((p) => p.name)).toEqual(["title", "content"]);
      }
    });

    it("Case 10: retains advisory PARTIAL_SHAPE limitation when API wrapper callers pass dynamic or conflicting arguments (Expense Tracker pattern)", async () => {
      const doc = makeDoc(
        "file:///client/services/usersApi.js",
        `
        export function requestUser(payload) {
          return fetch('/api/users/login', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
        }
        `
      );
      const parsed = await parser.parse({ document: doc });
      const result = extractFetchObservations(doc, parsed);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("PARTIAL_SHAPE");
      expect(result.warnings[0].affectsCompleteness).toBe(false);
      expect(result.warnings[0].targetDimension).toBe("request-shape");

      const body = result.observations[0]?.endpoint.request?.body;
      expect(body?.completeness).toBe("partial");
    });

    it("Case 11: extracts statically visible FormData.append calls into multipart shape observation", async () => {
      const doc = makeDoc(
        "file:///client/upload.js",
        `
        function upload() {
          const formData = new FormData();
          formData.append('title', 'My Document');
          formData.append('file', selectedFile);
          return api.post('/api/upload', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
        }
        `
      );
      const parsed = await parser.parse({ document: doc });
      const result = extractAxiosObservations(doc, parsed);

      expect(result.warnings).toHaveLength(0);
      expect(result.observations).toHaveLength(1);
      const body = result.observations[0].endpoint.request?.body;
      expect(body?.completeness).toBe("complete");
      if (body?.shape.kind === "object") {
        expect(body.shape.properties.map((p) => p.name)).toEqual(["title", "file"]);
      }
    });

    it("Case 12: reclassifies unresolvable multipart FormData with specific advisory warning instead of generic JSON.stringify warning (Cubit pattern)", async () => {
      const doc = makeDoc(
        "file:///client/services/api.js",
        `
        export const createPost = (formData) => {
          return api.post('/community/posts', formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
        };
        `
      );
      const parsed = await parser.parse({ document: doc });
      const result = extractAxiosObservations(doc, parsed);

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("PARTIAL_SHAPE");
      expect(result.warnings[0].message).toContain(
        "Multipart form data payload cannot be fully statically inferred: formData"
      );
      expect(result.warnings[0].affectsCompleteness).toBe(false);

      const body = result.observations[0]?.endpoint.request?.body;
      expect(body?.completeness).toBe("partial");
    });
  });
});
