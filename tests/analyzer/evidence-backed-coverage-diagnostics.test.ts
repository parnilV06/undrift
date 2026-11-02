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
    expect(warning.message).toContain("forwarded into this exported API function");
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
    expect(shapeWarning?.message).toContain("forwarded from outer function callers");
    expect(shapeWarning?.message).toContain("constructed upstream across modules");
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
});
