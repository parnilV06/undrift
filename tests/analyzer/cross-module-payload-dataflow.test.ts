// Tests for Cross-Module Payload Dataflow Resolution & Coverage Diagnostics
// Strictly verifying bounded cross-module inference, cycle prevention,
// conservative merging, and honest diagnostic preservation.

import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  Uri: {
    parse: (s: string) => ({ toString: () => s }),
    file: (s: string) => ({ toString: () => s, fsPath: s })
  },
  Position: class {
    constructor(
      public line: number,
      public character: number
    ) {}
  },
  Range: class {
    constructor(
      public start: unknown,
      public end: unknown
    ) {}
  },
  ThemeIcon: class {
    constructor(public id: string) {}
  },
  ThemeColor: class {
    constructor(public id: string) {}
  },
  TreeItem: class {
    constructor(public label: string) {}
  },
  window: { showTextDocument: vi.fn(), showErrorMessage: vi.fn(), showInformationMessage: vi.fn() },
  workspace: { openTextDocument: vi.fn() },
  commands: { executeCommand: vi.fn() }
}));

import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import {
  extractFetchObservations,
  extractAxiosObservations,
  LocalDeclarationIndex,
  LocalReferenceResolver,
  createLocalDeclarationIndex,
  createLocalReferenceResolver,
  CrossModuleFlowResolver
} from "@undrift/analyzer-js-ts";
import {
  AnalysisEngine,
  type AnalysisRequest,
  type Finding,
  type FindingId,
  type SourceDocument,
  type WorkspaceId
} from "@undrift/core";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import {
  renderReportHtml,
  type ReportViewModel
} from "../../apps/vscode-extension/src/views/report-panel";

const parser = new TreeSitterParserAdapter();

function makeDoc(uri: string, text: string): SourceDocument {
  return {
    uri,
    text,
    version: 1,
    languageId: uri.endsWith(".ts") || uri.endsWith(".tsx") ? "typescript" : "javascript"
  };
}

describe("Cross-Module Payload Dataflow Resolution (Phase 6.3 Final)", () => {
  it("resolves payload across modules for imported function calls", async () => {
    const apiDoc = makeDoc(
      "file:///client/src/api/transactionsApi.js",
      `
      export function createTransaction(payload) {
        return fetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      `
    );

    const callerDoc = makeDoc(
      "file:///client/src/components/CreateTransaction.jsx",
      `
      import { createTransaction } from '../api/transactionsApi';

      export function CreateTransaction() {
        const handleSave = () => {
          createTransaction({
            title: "Groceries",
            amount: 45.5,
            category: "Food"
          });
        };
        return <button onClick={handleSave}>Save</button>;
      }
      `
    );

    const parsedApi = await parser.parse({ document: apiDoc });
    const parsedCaller = await parser.parse({ document: callerDoc });

    const declIndex = createLocalDeclarationIndex([
      { document: apiDoc, parsed: parsedApi },
      { document: callerDoc, parsed: parsedCaller }
    ]);
    const resolver = createLocalReferenceResolver(declIndex);

    const result = extractFetchObservations(apiDoc, parsedApi, undefined, resolver);
    expect(result.observations).toHaveLength(1);
    const obs = result.observations[0];
    expect(obs.endpoint.request?.body?.completeness).toBe("complete");

    const shape = obs.endpoint.request?.body?.shape;
    expect(shape?.kind).toBe("object");
    if (shape?.kind === "object") {
      const propNames = shape.properties.map((p) => p.name).sort();
      expect(propNames).toEqual(["amount", "category", "title"]);
    }
    expect(result.warnings.filter((w) => w.code === "PARTIAL_SHAPE")).toHaveLength(0);
  });

  it("resolves multi-hop payload flow through custom hook return object (Expense Tracker pattern)", async () => {
    const apiDoc = makeDoc(
      "file:///client/src/api/transactionsApi.js",
      `
      export const createTransaction = (payload) => {
        return fetch('/api/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      };
      `
    );

    const hookDoc = makeDoc(
      "file:///client/src/hooks/useTransactions.js",
      `
      import { createTransaction } from '../api/transactionsApi';

      export function useTransactions() {
        const addTransaction = async (data) => {
          return await createTransaction(data);
        };
        return { addTransaction };
      }
      `
    );

    const componentDoc = makeDoc(
      "file:///client/src/views/Tracker.jsx",
      `
      import { useTransactions } from '../hooks/useTransactions';

      export function Tracker() {
        const { addTransaction } = useTransactions();
        const onSave = () => {
          addTransaction({
            title: "Salary",
            amount: 5000,
            category: "Income",
            type: "income",
            date: "2026-11-01"
          });
        };
        return <button onClick={onSave}>Save</button>;
      }
      `
    );

    const parsedApi = await parser.parse({ document: apiDoc });
    const parsedHook = await parser.parse({ document: hookDoc });
    const parsedComponent = await parser.parse({ document: componentDoc });

    const declIndex = createLocalDeclarationIndex([
      { document: apiDoc, parsed: parsedApi },
      { document: hookDoc, parsed: parsedHook },
      { document: componentDoc, parsed: parsedComponent }
    ]);
    const resolver = createLocalReferenceResolver(declIndex);

    const result = extractFetchObservations(apiDoc, parsedApi, undefined, resolver);
    expect(result.observations).toHaveLength(1);
    const obs = result.observations[0];
    expect(obs.endpoint.request?.body?.completeness).toBe("complete");

    const shape = obs.endpoint.request?.body?.shape;
    expect(shape?.kind).toBe("object");
    if (shape?.kind === "object") {
      const propNames = shape.properties.map((p) => p.name).sort();
      expect(propNames).toEqual(["amount", "category", "date", "title", "type"]);
    }
  });

  it("resolves ternary branch hints for register and login endpoints (usersApi pattern)", async () => {
    const apiDoc = makeDoc(
      "file:///client/src/api/usersApi.js",
      `
      async function requestUser(path, payload) {
        const res = await fetch('/api/users/' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return res.json();
      }
      export const registerUser = (payload) => requestUser('register', payload);
      export const loginUser = (payload) => requestUser('login', payload);
      `
    );

    const hookDoc = makeDoc(
      "file:///client/src/hooks/useAuth.js",
      `
      import { registerUser, loginUser } from '../api/usersApi';

      export function useAuth() {
        const signup = (data) => registerUser(data);
        const login = (data) => loginUser(data);
        return { signup, login };
      }
      `
    );

    const modalDoc = makeDoc(
      "file:///client/src/components/AuthModal.jsx",
      `
      import { useState } from 'react';

      export function AuthModal({ onSubmit, isSignup }) {
        const [name, setName] = useState('');
        const [email, setEmail] = useState('');
        const [password, setPassword] = useState('');

        const handleSubmit = (e) => {
          e.preventDefault();
          const payload = isSignup
            ? { name, email, password }
            : { email, password };
          onSubmit(payload);
        };
        return <form onSubmit={handleSubmit}><button type="submit">Submit</button></form>;
      }
      `
    );

    const pageDoc = makeDoc(
      "file:///client/src/App.jsx",
      `
      import { useAuth } from './hooks/useAuth';
      import { AuthModal } from './components/AuthModal';

      export function App() {
        const { signup, login } = useAuth();
        const handleAuth = (formData) => {
          if (mode === 'signup') {
            signup(formData);
          } else {
            login(formData);
          }
        };
        return <AuthModal onSubmit={handleAuth} isSignup={mode === 'signup'} />;
      }
      `
    );

    const parsedApi = await parser.parse({ document: apiDoc });
    const parsedHook = await parser.parse({ document: hookDoc });
    const parsedModal = await parser.parse({ document: modalDoc });
    const parsedPage = await parser.parse({ document: pageDoc });

    const declIndex = createLocalDeclarationIndex([
      { document: apiDoc, parsed: parsedApi },
      { document: hookDoc, parsed: parsedHook },
      { document: modalDoc, parsed: parsedModal },
      { document: pageDoc, parsed: parsedPage }
    ]);
    const resolver = createLocalReferenceResolver(declIndex);

    const result = extractFetchObservations(apiDoc, parsedApi, undefined, resolver);
    expect(result.observations).toHaveLength(2);

    const registerObs = result.observations.find((o) => {
      const val = o.endpoint.path.value;
      return (
        typeof val === "object" &&
        val !== null &&
        "rawPath" in val &&
        typeof val.rawPath === "string" &&
        val.rawPath.includes("register")
      );
    });
    const loginObs = result.observations.find((o) => {
      const val = o.endpoint.path.value;
      return (
        typeof val === "object" &&
        val !== null &&
        "rawPath" in val &&
        typeof val.rawPath === "string" &&
        val.rawPath.includes("login")
      );
    });

    expect(registerObs).toBeDefined();
    expect(registerObs?.endpoint.request?.body?.completeness).toBe("complete");
    if (registerObs?.endpoint.request?.body?.shape?.kind === "object") {
      const names = registerObs.endpoint.request.body.shape.properties.map((p) => p.name).sort();
      expect(names).toEqual(["email", "name", "password"]);
    }

    expect(loginObs).toBeDefined();
    expect(loginObs?.endpoint.request?.body?.completeness).toBe("complete");
    if (loginObs?.endpoint.request?.body?.shape?.kind === "object") {
      const names = loginObs.endpoint.request.body.shape.properties.map((p) => p.name).sort();
      expect(names).toEqual(["email", "password"]);
    }
  });

  it("handles recursion and cyclic call chains safely without stack overflow", async () => {
    const docA = makeDoc(
      "file:///client/src/cycleA.js",
      `
      import { funcB } from './cycleB';
      export function funcA(data) {
        return funcB(data);
      }
      `
    );

    const docB = makeDoc(
      "file:///client/src/cycleB.js",
      `
      import { funcA } from './cycleA';
      export function funcB(data) {
        return funcA(data);
      }
      `
    );

    const parsedA = await parser.parse({ document: docA });
    const parsedB = await parser.parse({ document: docB });

    const declIndex = createLocalDeclarationIndex([
      { document: docA, parsed: parsedA },
      { document: docB, parsed: parsedB }
    ]);

    const flowResolver = new CrossModuleFlowResolver(declIndex);
    const flowRes = flowResolver.resolvePayloadFlow("funcA", 0, "file:///client/src/cycleA.js");
    expect(flowRes.status).toBe("none");
  });

  it("handles multiple callsites conservatively with optional divergence", async () => {
    const apiDoc = makeDoc(
      "file:///client/src/itemApi.js",
      `
      export function saveItem(item) {
        return fetch('/api/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item)
        });
      }
      `
    );

    const callDoc = makeDoc(
      "file:///client/src/consumer.js",
      `
      import { saveItem } from './itemApi';
      export function createStandard() {
        saveItem({ id: "1", name: "Widget", count: 10 });
      }
      export function createSpecial() {
        saveItem({ id: "2", name: "Special", tag: "promo" });
      }
      `
    );

    const parsedApi = await parser.parse({ document: apiDoc });
    const parsedCall = await parser.parse({ document: callDoc });

    const declIndex = createLocalDeclarationIndex([
      { document: apiDoc, parsed: parsedApi },
      { document: callDoc, parsed: parsedCall }
    ]);
    const resolver = createLocalReferenceResolver(declIndex);

    const result = extractFetchObservations(apiDoc, parsedApi, undefined, resolver);
    expect(result.observations).toHaveLength(1);
    const obs = result.observations[0];
    const shape = obs.endpoint.request?.body?.shape;
    expect(shape?.kind).toBe("object");

    if (shape?.kind === "object") {
      const propMap = new Map(shape.properties.map((p) => [p.name, p]));
      expect(propMap.get("id")?.presence).toBe("required");
      expect(propMap.get("name")?.presence).toBe("required");
      expect(propMap.get("count")?.presence).toBe("optional");
      expect(propMap.get("tag")?.presence).toBe("optional");
    }
  });

  it("preserves explicit-unknown-type warning for TypeScript unknown parameter (SlotTrack pattern)", async () => {
    const clientDoc = makeDoc(
      "file:///app/lib/api/client.ts",
      `
      export async function request(url: string, options?: any) {
        return fetch(url, options);
      }
      `
    );

    const authDoc = makeDoc(
      "file:///app/lib/api/auth.ts",
      `
      import { request } from './client';
      export async function login(data: unknown) {
        return request('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify(data)
        });
      }
      `
    );

    const parsedClient = await parser.parse({ document: clientDoc });
    const parsedAuth = await parser.parse({ document: authDoc });

    const declIndex = createLocalDeclarationIndex([
      { document: clientDoc, parsed: parsedClient },
      { document: authDoc, parsed: parsedAuth }
    ]);
    const resolver = createLocalReferenceResolver(declIndex);

    const result = extractFetchObservations(authDoc, parsedAuth, undefined, resolver);
    const unknownWarn = result.warnings.find((w) => w.code === "PARTIAL_SHAPE");
    expect(unknownWarn).toBeDefined();
    expect(unknownWarn?.reasonCode).toBe("explicit-unknown-type");
    expect(unknownWarn?.message).toContain("explicitly typed as 'unknown'");
    expect(unknownWarn?.message).toContain(
      "no in-workspace callers or schema annotations provide payload evidence"
    );
  });

  it("preserves truthful multipart diagnostic without fabricating fields (Cubit pattern)", async () => {
    const apiDoc = makeDoc(
      "file:///client/src/services/api.js",
      `
      export const uploadAvatar = (formData) => {
        return fetch('/api/profile/avatar', {
          method: 'POST',
          body: formData,
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      };
      `
    );

    const parsed = await parser.parse({ document: apiDoc });
    const result = extractFetchObservations(apiDoc, parsed);

    const multipartWarn = result.warnings.find((w) => w.code === "PARTIAL_SHAPE");
    expect(multipartWarn).toBeDefined();
    expect(multipartWarn?.reasonCode).toBe("multipart-no-construction-evidence");
    expect(multipartWarn?.message).toContain(
      "without discoverable FormData construction or append/set operations, or in-workspace callers"
    );
    expect(multipartWarn?.message).toContain("where FormData is instantiated");
  });

  it("separates active drift findings from unmapped provider endpoints in report panel", () => {
    const findings: Finding[] = [
      {
        id: "f-drift-1" as unknown as FindingId,
        ruleId: "UND100",
        severity: "error",
        category: "endpoint-drift",
        title: "Missing Provider Endpoint",
        description: "POST /api/missing not implemented by provider",
        remediation: "Implement backend route",
        affectedComponents: ["frontend"],
        observations: [],
        evidence: [],
        timestamp: "2026-11-02T23:00:00Z"
      },
      {
        id: "f-unmapped-1" as unknown as FindingId,
        ruleId: "UND110",
        severity: "info",
        category: "limitation",
        title: "Unmapped Provider Endpoint",
        description: "Provider route GET /api/admin/metrics has no known in-workspace consumer",
        remediation: "Verify consumer usage",
        affectedComponents: ["backend"],
        observations: [],
        evidence: [],
        timestamp: "2026-11-02T23:00:00Z"
      }
    ];

    const model: ReportViewModel = {
      workspaceId: "test-ws" as unknown as WorkspaceId,
      generation: 1,
      complete: true,
      findings,
      coverageSummary: {
        totalFilesScanned: 10,
        providerFilesCount: 5,
        consumerFilesCount: 5,
        coverageScorePercent: 100,
        unsupportedPatternCount: 0,
        analysisLimitationsCount: 0,
        filesWithWarningsCount: 0
      },
      warnings: [],
      history: [],
      timestamp: "2026-11-02T23:00:00Z"
    };

    const html = renderReportHtml(model);
    expect(html).toContain("Detected Drift Findings");
    expect(html).toContain("Unmapped Provider Endpoints (1)");
    expect(html).toContain("These backend endpoints have no known in-workspace consumer.");
    expect(html).toContain("Unmapped Provider Endpoint");
    expect(html).toContain("UND110");
    expect(html).toContain("Missing Provider Endpoint");
  });
});
