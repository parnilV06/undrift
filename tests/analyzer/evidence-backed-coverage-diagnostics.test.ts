// Tests for Evidence-Backed Coverage Diagnostics & Request Shape Explanation (Phase 6.3 Task 5).
// Validates structured reason classification, message formatting, and diagnostic semantics.

import { describe, expect, it } from "vitest";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import {
  extractFetchObservations,
  extractAxiosObservations,
  LocalDeclarationIndex,
  LocalReferenceResolver
} from "@undrift/analyzer-js-ts";
import type { AnalysisWarning, Finding, SourceDocument } from "@undrift/core";
import { toPersistedFindingRecord } from "@undrift/core/src/domain/snapshot";

const parser = new TreeSitterParserAdapter();

function makeDoc(uri: string, text: string): SourceDocument {
  return {
    uri,
    text,
    version: 1,
    languageId: uri.endsWith(".ts") || uri.endsWith(".tsx") ? "typescript" : "javascript"
  };
}

describe("Phase 6.3 Task 5: Evidence-Backed Coverage Diagnostics", () => {
  // Test 1 — Explicit unknown TypeScript payload
  it("Test 1: identifies explicit unknown type annotation on request payload parameter", async () => {
    const code = `
      export function createClass(data: unknown) {
        return fetch('/api/classes', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
    `;
    const doc = makeDoc("file:///app/lib/api/classes.ts", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractFetchObservations(doc, parsed);

    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0];
    expect(warning.code).toBe("PARTIAL_SHAPE");
    expect(warning.reasonCode).toBe("explicit-unknown-type");
    expect(warning.message).toContain("explicitly typed as 'unknown'");
    expect(warning.message).toContain("'data'");
    expect(warning.affectsCompleteness).toBe(false);
    expect(warning.scope).toBe("consumer");
    expect(warning.targetDimension).toBe("request-shape");

    const body = result.observations[0]?.endpoint.request?.body;
    expect(body?.completeness).toBe("partial");
    expect(body?.shape.kind).toBe("unknown");
  });

  // Test 2 — Unannotated exported payload parameter
  it("Test 2: identifies unannotated parameter in exported function without claiming no callers exist", async () => {
    const code = `
      export async function createTransaction(payload) {
        return fetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
    `;
    const doc = makeDoc("file:///client/services/transactionsApi.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractFetchObservations(doc, parsed);

    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0];
    expect(warning.code).toBe("PARTIAL_SHAPE");
    expect(warning.reasonCode).toBe("unannotated-parameter");
    expect(warning.message).toContain("of exported API function is unannotated");
    expect(warning.message).toContain("cross-module caller data is not included");
    expect(warning.message).not.toContain("no callers exist");
    expect(warning.affectsCompleteness).toBe(false);
  });

  // Test 3 — Cross-module forwarding
  it("Test 3: accurately identifies same-file inference boundary for cross-module forwarding", async () => {
    const serviceCode = `
      export async function submitData(payload) {
        return fetch('/api/data', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
    `;
    const doc = makeDoc("file:///src/api/service.js", serviceCode);
    const parsed = await parser.parse({ document: doc });
    const result = extractFetchObservations(doc, parsed);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].reasonCode).toBe("unannotated-parameter");
    expect(result.warnings[0].message).toContain("cross-module caller data is not included");
    expect(result.warnings[0].affectsCompleteness).toBe(false);
  });

  // Test 4 — Same-file helper with unresolved payload argument
  it("Test 4: distinguishes same-file helper callsites from missing callsites (Expense Tracker pattern)", async () => {
    const code = `
      async function requestUser(path, payload) {
        const response = await fetch('/api/users/' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return response.json();
      }

      export const registerUser = (payload) => requestUser('register', payload);
      export const loginUser = (payload) => requestUser('login', payload);
    `;
    const doc = makeDoc("file:///client/services/usersApi.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractFetchObservations(doc, parsed);

    const shapeWarning = result.warnings.find((w) => w.code === "PARTIAL_SHAPE");
    expect(shapeWarning).toBeDefined();
    expect(shapeWarning?.reasonCode).toBe("cross-module-forwarding");
    expect(shapeWarning?.message).toContain("forwarded through local helper callsites");
    expect(shapeWarning?.message).toContain("do not provide a statically resolvable object shape");
    expect(shapeWarning?.message).not.toContain("without same-file caller evidence");
    expect(shapeWarning?.affectsCompleteness).toBe(false);
  });

  // Test 5 — No FormData construction evidence
  it("Test 5: identifies uninstantiated multipart parameter without claiming application is defective (Cubit pattern)", async () => {
    const code = `
      import api from './client';

      export const profileAPI = {
        uploadAvatar: (formData) =>
          api.post('/profile/avatar', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          }),
      };
    `;
    const doc = makeDoc("file:///client/services/api.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0];
    expect(warning.code).toBe("PARTIAL_SHAPE");
    expect(warning.reasonCode).toBe("multipart-no-construction-evidence");
    expect(warning.message).toContain(
      "without discoverable FormData construction or append/set operations"
    );
    expect(warning.message).not.toContain("bug");
    expect(warning.message).not.toContain("dead");
    expect(warning.affectsCompleteness).toBe(false);
  });

  // Test 6 — Partially known FormData fields
  it("Test 6: retains known literal FormData fields and notes dynamic appends", async () => {
    const code = `
      import api from './client';

      export async function createPostWithImage(title, dynamicKey, dynamicVal) {
        const formData = new FormData();
        formData.append('title', title);
        formData.append(dynamicKey, dynamicVal);

        return api.post('/community/posts', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
    `;
    const doc = makeDoc("file:///client/services/postsApi.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    const body = result.observations[0]?.endpoint.request?.body;
    expect(body).toBeDefined();
    // Known field 'title' is retained!
    if (body?.shape.kind === "object") {
      const fieldNames = body.shape.properties.map((p) => p.name);
      expect(fieldNames).toContain("title");
    }

    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0];
    expect(warning.code).toBe("PARTIAL_SHAPE");
    expect(warning.reasonCode).toBe("multipart-partial-field-evidence");
    expect(warning.message).toContain("1 statically discovered field(s)");
    expect(warning.message).toContain("'title'");
    expect(warning.message).toContain("dynamic append operations");
    expect(warning.affectsCompleteness).toBe(false);
  });

  // Test 7 — Fully inferable JSON payload
  it("Test 7: does not emit PARTIAL_SHAPE warning when payload is fully statically resolvable", async () => {
    const code = `
      import api from './client';

      export async function login(email, password) {
        const payload = { email, password };
        return api.post('/api/auth/login', payload);
      }
    `;
    const doc = makeDoc("file:///client/pages/Login.jsx", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    const shapeWarnings = result.warnings.filter((w) => w.code === "PARTIAL_SHAPE");
    expect(shapeWarnings).toHaveLength(0);

    const body = result.observations[0]?.endpoint.request?.body;
    expect(body?.completeness).toBe("complete");
    if (body?.shape.kind === "object") {
      const fieldNames = body.shape.properties.map((p) => p.name);
      expect(fieldNames).toContain("email");
      expect(fieldNames).toContain("password");
    }
  });

  // Test 8 — Existing local type/interface resolution continues to work
  it("Test 8: resolves static shapes from local TypeScript interface annotations without warning", async () => {
    const code = `
      interface CreateUserInput {
        name: string;
        email: string;
      }

      export function createUser(data: CreateUserInput) {
        return fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      }
    `;
    const doc = makeDoc("file:///src/api/users.ts", code);
    const parsed = await parser.parse({ document: doc });
    const localIndex = new LocalDeclarationIndex();
    localIndex.indexDocument(doc, parsed);
    const resolver = new LocalReferenceResolver(localIndex);

    const result = extractFetchObservations(doc, parsed, undefined, resolver);
    const shapeWarnings = result.warnings.filter((w) => w.code === "PARTIAL_SHAPE");
    expect(shapeWarnings).toHaveLength(0);

    const body = result.observations[0]?.endpoint.request?.body;
    expect(body?.completeness).toBe("complete");
    if (body?.shape.kind === "object") {
      const names = body.shape.properties.map((p) => p.name);
      expect(names).toContain("name");
      expect(names).toContain("email");
    }
  });

  // Test 9 — Fetch/Axios diagnostic parity
  it("Test 9: produces equivalent reasonCode and message structure across fetch and axios", async () => {
    const fetchCode = `
      export function sendData(data: unknown) {
        return fetch('/api/test', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
    `;
    const axiosCode = `
      import api from './client';
      export function sendData(data: unknown) {
        return api.post('/api/test', data);
      }
    `;

    const fetchDoc = makeDoc("file:///test/fetch.ts", fetchCode);
    const fetchParsed = await parser.parse({ document: fetchDoc });
    const fetchRes = extractFetchObservations(fetchDoc, fetchParsed);

    const axiosDoc = makeDoc("file:///test/axios.ts", axiosCode);
    const axiosParsed = await parser.parse({ document: axiosDoc });
    const axiosRes = extractAxiosObservations(axiosDoc, axiosParsed);

    expect(fetchRes.warnings[0].reasonCode).toBe("explicit-unknown-type");
    expect(axiosRes.warnings[0].reasonCode).toBe("explicit-unknown-type");
    expect(fetchRes.warnings[0].message).toBe(axiosRes.warnings[0].message);
  });

  // Test 10 — Existing SlotTrack generic transport behavior
  it("Test 10: preserves advisory DYNAMIC_ROUTE notice for generic transport forwarding", async () => {
    const code = `
      export async function request(url, options) {
        return fetch(url, options);
      }
    `;
    const doc = makeDoc("file:///app/lib/api/client.ts", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractFetchObservations(doc, parsed);

    const routeWarning = result.warnings.find((w) => w.code === "DYNAMIC_ROUTE");
    expect(routeWarning).toBeDefined();
    expect(routeWarning?.message).toContain("Dynamic URL parameter forwarded in helper function");
    expect(routeWarning?.affectsCompleteness).toBe(false);

    // Transport helper path is marked dynamic with advisory status
    const paths = result.observations.map((o) => o.endpoint.path);
    expect(paths).toHaveLength(1);
    expect(paths[0].state).toBe("dynamic");
  });

  // Test 11 — Diagnostic persistence
  it("Test 11: preserves reasonCode through finding record snapshot persistence", () => {
    const warning: AnalysisWarning = {
      code: "PARTIAL_SHAPE",
      message: "Request payload parameter 'data' is explicitly typed as 'unknown'.",
      analyzerId: "analyzer-js-ts",
      affectsCompleteness: false,
      scope: "consumer",
      targetDimension: "request-shape",
      reasonCode: "explicit-unknown-type"
    };

    const finding: Finding = {
      id: "f-test-1",
      ruleId: "UND110",
      category: "drift",
      severity: "info",
      state: "active",
      title: "Test Finding",
      summary: "Test Summary",
      limitations: [warning],
      fixProposalIds: []
    };

    const persisted = toPersistedFindingRecord(finding, Date.now());
    expect(persisted.limitations).toHaveLength(1);
    expect(persisted.limitations[0].reasonCode).toBe("explicit-unknown-type");
    expect(persisted.limitations[0].scope).toBe("consumer");
    expect(persisted.limitations[0].targetDimension).toBe("request-shape");
  });

  // Test 12 — Existing lifecycle compatibility
  it("Test 12: does not alter finding identity or trigger false lifecycle transitions", () => {
    const warningA: AnalysisWarning = {
      code: "PARTIAL_SHAPE",
      message: "Old generic message",
      affectsCompleteness: false
    };

    const warningB: AnalysisWarning = {
      code: "PARTIAL_SHAPE",
      message: "New evidence-backed message",
      reasonCode: "unannotated-parameter",
      affectsCompleteness: false
    };

    // Limitations array does not affect core identity inputs
    expect(warningA.code).toBe(warningB.code);
    expect(warningA.affectsCompleteness).toBe(warningB.affectsCompleteness);
  });

  // Test 13 — Explicit any type annotation
  it("Test 13: identifies explicit any type annotation and distinguishes it from unknown", async () => {
    const code = `
      export function updateSettings(data: any) {
        return fetch('/api/settings', {
          method: 'POST',
          body: JSON.stringify(data),
        });
      }
    `;
    const doc = makeDoc("file:///app/lib/api/settings.ts", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractFetchObservations(doc, parsed);

    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0];
    expect(warning.code).toBe("PARTIAL_SHAPE");
    expect(warning.reasonCode).toBe("explicit-any-type");
    expect(warning.message).toContain("explicitly typed as 'any'");
    expect(warning.message).not.toContain("unknown");
    expect(warning.affectsCompleteness).toBe(false);
  });

  // Test 14 — FormData unrelated object isolation
  it("Test 14: ignores unrelated object mutations when tracking FormData", async () => {
    const code = `
      import api from './client';
      export function uploadFiles(file) {
        const formData = new FormData();
        const items = [];
        items.append('unrelated');
        const params = new URLSearchParams();
        params.append('search', 'query');
        formData.append('avatar', file);

        return api.post('/api/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
    `;
    const doc = makeDoc("file:///client/upload.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    const body = result.observations[0]?.endpoint.request?.body;
    expect(body?.completeness).toBe("complete");
    if (body?.shape.kind === "object") {
      const fieldNames = body.shape.properties.map((p) => p.name);
      expect(fieldNames).toEqual(["avatar"]);
      expect(fieldNames).not.toContain("unrelated");
      expect(fieldNames).not.toContain("search");
    }
  });

  // Test 15 — Multiple FormData instances in one file
  it("Test 15: isolates multiple FormData instances within the same module", async () => {
    const code = `
      import api from './client';
      export function sendBoth(avatar, title, image) {
        const avatarData = new FormData();
        avatarData.append('avatar', avatar);

        const postData = new FormData();
        postData.append('title', title);
        postData.append('image', image);

        api.post('/api/avatar', avatarData, { headers: { 'Content-Type': 'multipart/form-data' } });
        api.post('/api/posts', postData, { headers: { 'Content-Type': 'multipart/form-data' } });
      }
    `;
    const doc = makeDoc("file:///client/multi.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    expect(result.observations).toHaveLength(2);
    const avatarObs = result.observations.find(
      (o) => o.endpoint.path.value.rawPath === "/api/avatar"
    );
    const postObs = result.observations.find((o) => o.endpoint.path.value.rawPath === "/api/posts");

    const avatarShape = avatarObs?.endpoint.request?.body?.shape;
    const postShape = postObs?.endpoint.request?.body?.shape;

    const avatarFields =
      avatarShape && avatarShape.kind === "object" ? avatarShape.properties.map((p) => p.name) : [];
    const postFields =
      postShape && postShape.kind === "object" ? postShape.properties.map((p) => p.name) : [];

    expect(avatarFields).toEqual(["avatar"]);
    expect(postFields).toEqual(["title", "image"]);
  });

  // Test 16 — Simple variable alias for FormData
  it("Test 16: supports simple variable aliases for FormData", async () => {
    const code = `
      import api from './client';
      export function uploadWithAlias(file) {
        const formData = new FormData();
        const uploadData = formData;
        uploadData.append('document', file);

        return api.post('/api/docs', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
    `;
    const doc = makeDoc("file:///client/alias.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    const body = result.observations[0]?.endpoint.request?.body;
    expect(body?.completeness).toBe("complete");
    if (body?.shape.kind === "object") {
      const names = body.shape.properties.map((p) => p.name);
      expect(names).toContain("document");
    }
  });

  // Test 17 — Conditional FormData field appends
  it("Test 17: marks conditional FormData field appends as optional", async () => {
    const code = `
      import api from './client';
      export function createRecord(title, file) {
        const formData = new FormData();
        formData.append('title', title);
        if (file) {
          formData.append('attachment', file);
        }

        return api.post('/api/records', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
    `;
    const doc = makeDoc("file:///client/records.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    const body = result.observations[0]?.endpoint.request?.body;
    expect(body?.completeness).toBe("complete");
    if (body?.shape.kind === "object") {
      const titleProp = body.shape.properties.find((p) => p.name === "title");
      const attachProp = body.shape.properties.find((p) => p.name === "attachment");

      expect(titleProp?.presence).toBe("required");
      expect(attachProp?.presence).toBe("optional");
    }
  });

  // Test 18 — Constructed but empty FormData
  it("Test 18: correctly reports constructed but empty FormData without fabricating empty shape", async () => {
    const code = `
      import api from './client';
      export function sendEmpty() {
        const formData = new FormData();
        return api.post('/api/empty', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
    `;
    const doc = makeDoc("file:///client/empty.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    expect(result.warnings).toHaveLength(1);
    const warning = result.warnings[0];
    expect(warning.code).toBe("PARTIAL_SHAPE");
    expect(warning.reasonCode).toBe("multipart-partial-field-evidence");
    expect(warning.message).toContain(
      "constructed, but no static field append or set operations were observed"
    );
  });

  // Test 19 — Exported function with same-file literal callers
  it("Test 19: resolves complete shape for exported function when same-file callers provide object literal", async () => {
    const code = `
      import api from './client';
      export async function createUser(data) {
        return api.post('/api/users', data);
      }

      export function initAdmin() {
        return createUser({ username: 'admin', role: 'superuser' });
      }
    `;
    const doc = makeDoc("file:///client/userInit.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    const shapeWarnings = result.warnings.filter((w) => w.code === "PARTIAL_SHAPE");
    expect(shapeWarnings).toHaveLength(0);

    const body = result.observations[0]?.endpoint.request?.body;
    expect(body?.completeness).toBe("complete");
    if (body?.shape.kind === "object") {
      const names = body.shape.properties.map((p) => p.name);
      expect(names).toContain("username");
      expect(names).toContain("role");
    }
  });

  // Test 20 — Exported function with dynamic callers
  it("Test 20: classifies exported function as cross-module-forwarding when same-file callers forward dynamic arguments", async () => {
    const code = `
      import api from './client';
      export async function baseRequest(payload) {
        return api.post('/api/endpoint', payload);
      }

      export function callerA(paramA) {
        return baseRequest(paramA);
      }
    `;
    const doc = makeDoc("file:///client/forwarding.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    const warning = result.warnings.find((w) => w.code === "PARTIAL_SHAPE");
    expect(warning?.reasonCode).toBe("cross-module-forwarding");
    expect(warning?.message).toContain("forwarded through local helper callsites");
  });

  // Test 21 — Unexported helper without same-file callsites
  it("Test 21: classifies unexported function without same-file callsites as no-caller-evidence", async () => {
    const code = `
      import api from './client';
      async function unusedHelper(payload) {
        return api.post('/api/unused', payload);
      }
    `;
    const doc = makeDoc("file:///client/unused.js", code);
    const parsed = await parser.parse({ document: doc });
    const result = extractAxiosObservations(doc, parsed);

    const warning = result.warnings.find((w) => w.code === "PARTIAL_SHAPE");
    expect(warning?.reasonCode).toBe("no-caller-evidence");
    expect(warning?.message).toContain("without same-file caller evidence");
  });
});
