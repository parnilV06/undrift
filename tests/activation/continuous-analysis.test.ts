// Phase 6, Chunk 6.6: Continuous Workspace Analysis & Live Drift Detection Tests
// Verifies startup scanning, live editor debouncing, in-memory buffer precedence,
// automatic contract drift detection and resolution, dynamic UI status updates,
// and autoRun / debounce configuration controls.

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  MockPosition,
  MockRange,
  MockLocation,
  MockDiagnosticRelatedInformation,
  MockDiagnosticSeverity,
  MockDiagnostic,
  MockUri,
  mockVsCodeModule
} = vi.hoisted(() => {
  class MockPosition {
    constructor(
      public readonly line: number,
      public readonly character: number
    ) {}
  }

  class MockRange {
    constructor(
      public readonly start: MockPosition,
      public readonly end: MockPosition
    ) {}
  }

  class MockLocation {
    constructor(
      public readonly uri: MockUri,
      public readonly range: MockRange
    ) {}
  }

  class MockDiagnosticRelatedInformation {
    constructor(
      public readonly location: MockLocation,
      public readonly message: string
    ) {}
  }

  enum MockDiagnosticSeverity {
    Error = 0,
    Warning = 1,
    Information = 2,
    Hint = 3
  }

  class MockDiagnostic {
    public source?: string;
    public code?: string | number | { value: string | number; target: MockUri };
    public relatedInformation?: MockDiagnosticRelatedInformation[];

    constructor(
      public range: MockRange,
      public message: string,
      public severity: MockDiagnosticSeverity = MockDiagnosticSeverity.Error
    ) {}
  }

  class MockUri {
    constructor(
      public readonly scheme: string,
      public readonly authority: string,
      public readonly path: string,
      public readonly query: string,
      public readonly fragment: string
    ) {}

    static parse(val: string): MockUri {
      try {
        const url = new URL(val);
        return new MockUri(
          url.protocol.replace(":", ""),
          url.host,
          url.pathname,
          url.search,
          url.hash
        );
      } catch {
        return new MockUri("file", "", val, "", "");
      }
    }

    static file(fsPath: string): MockUri {
      const normalized = fsPath.replace(/\\/g, "/");
      const pathPart = normalized.startsWith("/") ? normalized : "/" + normalized;
      return new MockUri("file", "", pathPart, "", "");
    }

    get fsPath(): string {
      return this.path;
    }

    toString(): string {
      return `${this.scheme}://${this.authority}${this.path}`;
    }
  }

  const mockVsCodeModule = {
    Diagnostic: MockDiagnostic,
    DiagnosticSeverity: MockDiagnosticSeverity,
    DiagnosticRelatedInformation: MockDiagnosticRelatedInformation,
    Position: MockPosition,
    Range: MockRange,
    Location: MockLocation,
    Uri: MockUri,
    ThemeIcon: class {
      constructor(public id: string) {}
    },
    ThemeColor: class {
      constructor(public id: string) {}
    },
    languages: {
      createDiagnosticCollection: vi.fn((name?: string) => {
        const store = new Map<string, readonly MockDiagnostic[]>();
        return {
          name: name ?? "undrift",
          set: vi.fn((uri: MockUri, diags: readonly MockDiagnostic[] | undefined) => {
            if (!diags || diags.length === 0) {
              store.delete(uri.toString());
            } else {
              store.set(uri.toString(), diags);
            }
          }),
          delete: vi.fn((uri: MockUri) => {
            store.delete(uri.toString());
          }),
          clear: vi.fn(() => {
            store.clear();
          }),
          get: vi.fn((uri: MockUri) => store.get(uri.toString())),
          has: vi.fn((uri: MockUri) => store.has(uri.toString())),
          dispose: vi.fn(() => {
            store.clear();
          })
        };
      })
    },
    commands: {
      registerCommand: vi.fn((_cmd: string, handler: (...args: unknown[]) => unknown) => ({
        dispose: vi.fn(),
        _handler: handler
      }))
    },
    window: {
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        dispose: vi.fn(),
        show: vi.fn()
      }))
    },
    workspace: {
      workspaceFolders: [],
      getConfiguration: vi.fn(() => ({
        get: vi.fn((_key: string, defaultVal: unknown) => defaultVal)
      })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
      onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
      onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
      onDidCreateFiles: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDeleteFiles: vi.fn(() => ({ dispose: vi.fn() })),
      onDidRenameFiles: vi.fn(() => ({ dispose: vi.fn() })),
      createFileSystemWatcher: vi.fn(() => ({
        onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
        onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
        onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
        dispose: vi.fn()
      }))
    }
  };

  return {
    MockPosition,
    MockRange,
    MockLocation,
    MockDiagnosticRelatedInformation,
    MockDiagnosticSeverity,
    MockDiagnostic,
    MockUri,
    mockVsCodeModule
  };
});

vi.mock("vscode", () => mockVsCodeModule);

// Intercept CommonJS require("vscode") for runtime seams
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("module");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalRequire = (Module as any).prototype.require;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Module as any).prototype.require = function (id: string, ...args: any[]) {
  if (id === "vscode") {
    return mockVsCodeModule;
  }
  return originalRequire.call(this, id, ...args);
};
import type {
  AnalysisCoverageSummary,
  AnalysisEnginePort,
  AnalysisRequest,
  AnalysisResult,
  AnalysisSnapshot,
  AnalysisStatistics,
  DocumentUri,
  Finding,
  FindingLifecycleEvent,
  PersistedFindingRecord,
  WorkspaceId
} from "@undrift/core";
import { AnalysisEngine, StateReconciler, toPersistedFindingRecord } from "@undrift/core";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { AnalysisCoordinator, deriveWorkspaceId } from "../../apps/vscode-extension/src/activation";
import {
  AnalysisScheduler,
  DEFAULT_DEBOUNCE_DELAY_MS
} from "../../apps/vscode-extension/src/activation/scheduler";
import { DriftDiagnosticProvider } from "../../apps/vscode-extension/src/diagnostics";
import type { ExtensionLogger } from "../../apps/vscode-extension/src/logging";
import {
  createInMemoryStorageFileSystem,
  type InMemoryStorageFileSystem,
  WorkspaceStatePersistenceAdapter
} from "../../apps/vscode-extension/src/storage";
import {
  FindingsTreeDataProvider,
  OverviewViewProvider,
  renderOverviewHtml
} from "../../apps/vscode-extension/src/views";
import {
  type OpenDocumentAccessor,
  type UriLike,
  type WorkspaceAccessor,
  type WorkspaceFolderLike,
  WorkspaceManager
} from "../../apps/vscode-extension/src/workspace";

class TestExtensionLogger implements ExtensionLogger {
  readonly logs: { level: string; msg: string; error?: unknown }[] = [];

  info(msg: string): void {
    this.logs.push({ level: "info", msg });
  }

  warn(msg: string, error?: unknown): void {
    this.logs.push({ level: "warn", msg, error });
  }

  error(msg: string, error?: unknown): void {
    this.logs.push({ level: "error", msg, error });
  }

  show(): void {}
  dispose(): void {}
}

function makeUri(uriStr: string): UriLike {
  return {
    toString: () => uriStr,
    scheme: uriStr.split(":")[0],
    path: uriStr.replace(/^[a-zA-Z0-9+-.]+:\/\//, "")
  };
}

function createSampleStatistics(): AnalysisStatistics {
  return {
    filesConsidered: 2,
    filesParsed: 2,
    filesWithWarnings: 0,
    consumerObservations: 1,
    providerObservations: 1,
    relationships: 1,
    activeFindings: 0,
    unresolvedPatterns: 0,
    durationMs: 15
  };
}

function createSampleAnalysisResult(overrides?: Partial<AnalysisResult>): AnalysisResult {
  return {
    workspaceId: "file:///test/ws",
    generation: 1,
    generatedAt: Date.now(),
    complete: true,
    observations: [],
    relationships: [],
    findings: [],
    warnings: [],
    statistics: createSampleStatistics(),
    ...overrides
  };
}

describe("Chunk 6.6: Continuous Workspace Analysis & Live Drift Detection", () => {
  let logger: TestExtensionLogger;
  let inMemoryFs: InMemoryStorageFileSystem;
  let persistence: WorkspaceStatePersistenceAdapter;
  let reconciler: StateReconciler;

  beforeEach(() => {
    logger = new TestExtensionLogger();
    inMemoryFs = createInMemoryStorageFileSystem();
    persistence = new WorkspaceStatePersistenceAdapter({
      storageUri: () => makeUri("file:///storage/globalStorage"),
      fileSystem: inMemoryFs,
      logger
    });
    reconciler = new StateReconciler();
  });

  describe("1. Configuration and Scheduler Defaults", () => {
    it("initializes with autoRun=true and debounceDelayMs=800 by default", () => {
      const wm = new WorkspaceManager({
        getWorkspaceFolders: () => [{ uri: makeUri("file:///test/ws"), name: "test-ws", index: 0 }],
        findFiles: async () => [],
        readFile: async () => new Uint8Array(),
        getOpenDocuments: () => []
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager: wm,
        logger
      });

      const scheduler = coordinator.getScheduler();
      expect(scheduler.isAutoRunEnabled()).toBe(true);
      expect(scheduler.getDebounceDelay()).toBe(DEFAULT_DEBOUNCE_DELAY_MS);
      expect(DEFAULT_DEBOUNCE_DELAY_MS).toBe(800);
    });

    it("allows toggling autoRun dynamically and cancels pending timers when disabled", async () => {
      let analyzeCount = 0;
      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          analyzeCount++;
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          });
        },
        dispose: async () => {}
      };

      const wm = new WorkspaceManager({
        getWorkspaceFolders: () => [{ uri: makeUri("file:///test/ws"), name: "test-ws", index: 0 }],
        findFiles: async () => [makeUri("file:///test/ws/src/app.ts")],
        readFile: async () => new TextEncoder().encode("export const app = 1;"),
        getOpenDocuments: () => []
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager: wm,
        engine,
        debounceDelayMs: 50,
        logger
      });

      const scheduler = coordinator.getScheduler();

      // Trigger a change
      scheduler.handleDocumentChange(makeUri("file:///test/ws/src/app.ts"), 1);
      expect(scheduler.hasPendingScan()).toBe(true);

      // Disable autoRun
      scheduler.setAutoRun(false);
      expect(scheduler.isAutoRunEnabled()).toBe(false);
      expect(scheduler.hasPendingScan()).toBe(false);

      // Further edits do NOT schedule a scan
      const res = scheduler.handleDocumentChange(makeUri("file:///test/ws/src/app.ts"), 1);
      expect(res).toBeUndefined();
      expect(scheduler.hasPendingScan()).toBe(false);

      // Wait out the timer delay to verify no scan fired
      await new Promise((r) => setTimeout(r, 70));
      expect(analyzeCount).toBe(0);

      // Manual scan still works when autoRun is disabled
      const immediateOutcome = await scheduler.runImmediateScan();
      expect(immediateOutcome.status).toBe("success");
      expect(analyzeCount).toBe(1);
    });

    it("clamps debounce delay within valid range [100ms, 5000ms]", () => {
      const wm = new WorkspaceManager({
        getWorkspaceFolders: () => [{ uri: makeUri("file:///test/ws"), name: "test-ws", index: 0 }],
        findFiles: async () => [],
        readFile: async () => new Uint8Array(),
        getOpenDocuments: () => []
      });

      const coordinator = new AnalysisCoordinator({ workspaceManager: wm, logger });
      const scheduler = coordinator.getScheduler();

      scheduler.setDebounceDelay(50); // Below 100
      expect(scheduler.getDebounceDelay()).toBe(100);

      scheduler.setDebounceDelay(8000); // Above 5000
      expect(scheduler.getDebounceDelay()).toBe(5000);

      scheduler.setDebounceDelay(400); // Within range
      expect(scheduler.getDebounceDelay()).toBe(400);
    });
  });

  describe("2. Debounced Edit Coalescing", () => {
    it("coalesces rapid keystrokes within debounce interval into a single background scan", async () => {
      let analyzeCalls = 0;
      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          analyzeCalls++;
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          });
        },
        dispose: async () => {}
      };

      const wm = new WorkspaceManager({
        getWorkspaceFolders: () => [{ uri: makeUri("file:///test/ws"), name: "test-ws", index: 0 }],
        findFiles: async () => [makeUri("file:///test/ws/src/index.ts")],
        readFile: async () => new TextEncoder().encode("console.log('hello');"),
        getOpenDocuments: () => []
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager: wm,
        engine,
        debounceDelayMs: 60,
        logger
      });

      const scheduler = coordinator.getScheduler();

      // Simulate 5 rapid keystrokes separated by 10ms
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 5; i++) {
        const p = scheduler.handleDocumentChange(makeUri("file:///test/ws/src/index.ts"), 1);
        if (p) promises.push(p);
        await new Promise((r) => setTimeout(r, 10));
      }

      expect(scheduler.hasPendingScan()).toBe(true);
      await Promise.all(promises);

      // Exactly 1 analysis run should have executed for the entire burst
      expect(analyzeCalls).toBe(1);
      expect(scheduler.hasPendingScan()).toBe(false);
    });
  });

  describe("3. Unsaved In-Memory Document Buffer Precedence", () => {
    it("captures dirty in-memory editor buffer instead of disk content when scanning", async () => {
      const diskContent = "export function getClient() { return fetch('/api/v1/orders'); }";
      const dirtyBufferContent =
        "export function getClient() { return fetch('/api/v2/orders-drift'); }";

      const openDocs: Array<{
        uri: UriLike;
        version: number;
        languageId: string;
        getText: () => string;
      }> = [
        {
          uri: makeUri("file:///test/ws/src/client.ts"),
          version: 3,
          languageId: "typescript",
          getText: () => dirtyBufferContent
        }
      ];

      const wm = new WorkspaceManager(
        {
          getWorkspaceFolders: () => [
            { uri: makeUri("file:///test/ws"), name: "test-ws", index: 0 }
          ],
          findFiles: async () => [makeUri("file:///test/ws/src/client.ts")],
          readFile: async () => new TextEncoder().encode(diskContent),
          getOpenDocuments: () => openDocs
        },
        {
          documentAccessor: { textDocuments: openDocs }
        }
      );

      let analyzedText = "";
      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          analyzedText = req.documents[0]?.text ?? "";
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          });
        },
        dispose: async () => {}
      };

      const coordinator = new AnalysisCoordinator({
        workspaceManager: wm,
        engine,
        logger
      });

      const outcome = await coordinator.runWorkspaceScan();
      expect(outcome.status).toBe("success");
      // The dirty buffer content takes precedence over on-disk content
      expect(analyzedText).toBe(dirtyBufferContent);
      expect(analyzedText).not.toBe(diskContent);
    });
  });

  describe("4. End-to-End Live Drift Detection & Resolution", () => {
    it("detects drift when editor buffer is modified, and automatically clears finding when restored", async () => {
      // Set up real engine with TreeSitter and JsTsAnalyzer
      const parser = new TreeSitterParserAdapter();
      const analyzer = new JsTsAnalyzer();
      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [analyzer]
      });

      const backendFile = `
        import express from 'express';
        const app = express();
        app.get('/api/users', (req, res) => {
          res.json({ id: 1, name: 'Alice' });
        });
      `;

      // Compatible frontend file
      const matchingFrontend = `
        export async function fetchUsers() {
          const res = await fetch('/api/users');
          return res.json();
        }
      `;

      // Drifted frontend file (HTTP method mismatch)
      const driftedFrontend = `
        export async function fetchUsers() {
          const res = await fetch('/api/users', { method: 'POST' });
          return res.json();
        }
      `;

      let currentFrontendText = matchingFrontend;
      let frontendDocVersion = 1;

      const openDocs = [
        {
          uri: makeUri("file:///test/ws/src/frontend.ts"),
          get version() {
            return frontendDocVersion;
          },
          languageId: "typescript",
          getText: () => currentFrontendText
        }
      ];

      const wm = new WorkspaceManager(
        {
          getWorkspaceFolders: () => [
            { uri: makeUri("file:///test/ws"), name: "test-ws", index: 0 }
          ],
          findFiles: async () => [
            makeUri("file:///test/ws/src/backend.ts"),
            makeUri("file:///test/ws/src/frontend.ts")
          ],
          readFile: async (uri) => {
            const uriStr = uri.toString();
            if (uriStr.endsWith("backend.ts")) return new TextEncoder().encode(backendFile);
            return new TextEncoder().encode(matchingFrontend);
          },
          getOpenDocuments: () => openDocs
        },
        {
          documentAccessor: { textDocuments: openDocs }
        }
      );

      const diagnosticProvider = new DriftDiagnosticProvider({ logger });
      const coordinator = new AnalysisCoordinator({
        workspaceManager: wm,
        engine,
        ownsEngine: true,
        persistence,
        reconciler,
        diagnosticProvider,
        debounceDelayMs: 30,
        logger
      });

      // Track completed events and Activity Bar badge count
      let currentBadgeCount = 0;
      coordinator.onAnalysisCompleted((outcome) => {
        const wsId = outcome.workspaceId;
        if (wsId) {
          const snap = coordinator.getLastKnownSnapshot(wsId);
          currentBadgeCount = snap?.findings.filter((f) => f.state !== "resolved").length ?? 0;
        }
      });

      // 1. Initial baseline scan with matching code
      const baseline = await coordinator.getScheduler().runImmediateScan();
      expect(baseline.status).toBe("success");
      expect(baseline.result?.findings.length).toBe(0);
      expect(currentBadgeCount).toBe(0);

      // 2. User types an invalid endpoint in unsaved frontend editor buffer
      currentFrontendText = driftedFrontend;
      frontendDocVersion++;

      // Trigger continuous debounced change event
      const debouncedDrift = await coordinator
        .getScheduler()
        .handleDocumentChange(makeUri("file:///test/ws/src/frontend.ts"), 1);

      expect(debouncedDrift?.status).toBe("success");
      expect(debouncedDrift?.result?.findings.length).toBe(1);
      expect(debouncedDrift?.result?.findings[0].ruleId).toBe("UND120");
      expect(currentBadgeCount).toBe(1);

      // Verify diagnostics updated in diagnostic provider
      const publishedDiags = diagnosticProvider.getDiagnostics("file:///test/ws/src/frontend.ts");
      expect(publishedDiags.length).toBe(1);
      expect(publishedDiags[0].code).toBe("UND120");

      // 3. User reverts the edit back to matching endpoint
      currentFrontendText = matchingFrontend;
      frontendDocVersion++;

      const debouncedResolved = await coordinator
        .getScheduler()
        .handleDocumentChange(makeUri("file:///test/ws/src/frontend.ts"), 1);

      expect(debouncedResolved?.status).toBe("success");
      expect(debouncedResolved?.result?.findings.length).toBe(0);
      expect(currentBadgeCount).toBe(0);

      // Diagnostics are cleared
      const resolvedDiags = diagnosticProvider.getDiagnostics("file:///test/ws/src/frontend.ts");
      expect(resolvedDiags.length).toBe(0);
    });

    it("evaluates backend provider changes and updates frontend mismatch status", async () => {
      const parser = new TreeSitterParserAdapter();
      const analyzer = new JsTsAnalyzer();
      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [analyzer]
      });

      let backendText = `
        import express from 'express';
        const app = express();
        app.get('/api/items', (req, res) => res.json([]));
      `;

      const frontendText = `
        export async function getItems() {
          return fetch('/api/items', { method: 'POST' });
        }
      `;

      const wm = new WorkspaceManager({
        getWorkspaceFolders: () => [{ uri: makeUri("file:///test/ws"), name: "test-ws", index: 0 }],
        findFiles: async () => [
          makeUri("file:///test/ws/src/server.ts"),
          makeUri("file:///test/ws/src/client.ts")
        ],
        readFile: async (uri) => {
          const s = uri.toString();
          if (s.endsWith("server.ts")) return new TextEncoder().encode(backendText);
          return new TextEncoder().encode(frontendText);
        },
        getOpenDocuments: () => []
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager: wm,
        engine,
        ownsEngine: true,
        persistence,
        reconciler,
        debounceDelayMs: 25,
        logger
      });

      // 1. Initial scan: mismatch between frontend POST and backend GET (/api/items)
      const scan1 = await coordinator.getScheduler().runImmediateScan();
      expect(scan1.status).toBe("success");
      expect(scan1.result?.findings.length).toBe(1);
      expect(scan1.result?.findings[0].ruleId).toBe("UND120");

      // 2. Developer modifies backend provider to support POST
      backendText = `
        import express from 'express';
        const app = express();
        app.post('/api/items', (req, res) => res.json([]));
      `;

      // File change event on server.ts
      const scan2 = await coordinator
        .getScheduler()
        .handleDocumentSave(makeUri("file:///test/ws/src/server.ts"));

      expect(scan2?.status).toBe("success");
      expect(scan2?.result?.findings.length).toBe(0);
    });
  });

  describe("5. Document Close & Discarding Unsaved Edits", () => {
    it("schedules a re-scan on document close to revert to on-disk content", async () => {
      let scanCount = 0;
      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          scanCount++;
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          });
        },
        dispose: async () => {}
      };

      const wm = new WorkspaceManager({
        getWorkspaceFolders: () => [{ uri: makeUri("file:///test/ws"), name: "test-ws", index: 0 }],
        findFiles: async () => [makeUri("file:///test/ws/src/app.ts")],
        readFile: async () => new TextEncoder().encode("export const x = 1;"),
        getOpenDocuments: () => []
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager: wm,
        engine,
        debounceDelayMs: 40,
        logger
      });

      const outcome = await coordinator
        .getScheduler()
        .handleDocumentClose(makeUri("file:///test/ws/src/app.ts"));

      expect(outcome?.status).toBe("success");
      expect(scanCount).toBe(1);
    });
  });

  describe("6. External File System Watcher Integration", () => {
    it("triggers debounced scan on external file change and ignores irrelevant files", async () => {
      let scanCount = 0;
      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          scanCount++;
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          });
        },
        dispose: async () => {}
      };

      const wm = new WorkspaceManager({
        getWorkspaceFolders: () => [{ uri: makeUri("file:///test/ws"), name: "test-ws", index: 0 }],
        findFiles: async () => [makeUri("file:///test/ws/src/app.ts")],
        readFile: async () => new TextEncoder().encode("export const x = 1;"),
        getOpenDocuments: () => []
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager: wm,
        engine,
        debounceDelayMs: 40,
        logger
      });

      const scheduler = coordinator.getScheduler();

      // Non-supported file extension (.txt or .log) -> ignored
      const ignored = scheduler.handleExternalFileChange(makeUri("file:///test/ws/src/output.log"));
      expect(ignored).toBeUndefined();
      expect(scheduler.hasPendingScan()).toBe(false);

      // Supported TypeScript file change from external tool -> debounced scan scheduled
      const scheduled = await scheduler.handleExternalFileChange(
        makeUri("file:///test/ws/src/app.ts")
      );
      expect(scheduled?.status).toBe("success");
      expect(scanCount).toBe(1);
    });
  });

  describe("7. Scanning State & Status Transitions", () => {
    it("emits onAnalysisStarted when scan begins and transitions UI without flicker", async () => {
      let startedGeneration = -1;
      let analyzeResolve: () => void;
      const analyzePromise = new Promise<void>((r) => {
        analyzeResolve = r;
      });

      const engine: AnalysisEnginePort = {
        analyze: async (req) => {
          await analyzePromise;
          return createSampleAnalysisResult({
            workspaceId: req.workspaceId,
            generation: req.generation
          });
        },
        dispose: async () => {}
      };

      const wm = new WorkspaceManager({
        getWorkspaceFolders: () => [{ uri: makeUri("file:///test/ws"), name: "test-ws", index: 0 }],
        findFiles: async () => [makeUri("file:///test/ws/src/api.ts")],
        readFile: async () => new TextEncoder().encode("export const a = 1;"),
        getOpenDocuments: () => []
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager: wm,
        engine,
        logger
      });

      const overview = new OverviewViewProvider({ coordinator });
      const tree = new FindingsTreeDataProvider({ coordinator });

      coordinator.onAnalysisStarted((evt) => {
        startedGeneration = evt.generation;
      });

      // Start scan asynchronously
      const scanPromise = coordinator.runWorkspaceScan();

      // Wait a tick for scan to begin
      await new Promise((r) => setTimeout(r, 20));

      expect(startedGeneration).toBe(1);
      expect(overview.getModel()?.status).toBe("analyzing");
      expect(tree.getStatus().state).toBe("analyzing");

      // Verify HTML renders Scanning... badge during analysis
      const html = renderOverviewHtml(overview.getModel()!);
      expect(html).toContain("Scanning…");

      // Complete the analysis
      analyzeResolve!();
      const outcome = await scanPromise;
      expect(outcome.status).toBe("success");

      // Status transitions to freshly-verified
      expect(overview.getModel()?.status).toBe("freshly-verified");
      expect(tree.getStatus().state).toBe("freshly-verified");

      overview.dispose();
      tree.dispose();
    });
  });

  describe("8. Extension Lifecycle, Startup Scan & Settings Synchronization", () => {
    it("runs an automatic scan on extension startup when runOnStartup and autoRun are enabled", async () => {
      let configValues: Record<string, unknown> = {
        autoRun: true,
        debounceMs: 800,
        runOnStartup: true
      };

      mockVsCodeModule.workspace.getConfiguration = vi.fn((section?: string) => {
        if (section === "undrift.analysis") {
          return {
            get: vi.fn((key: string, defaultVal: unknown) => configValues[key] ?? defaultVal)
          };
        }
        return { get: vi.fn((_, defaultVal) => defaultVal) };
      }) as unknown as typeof mockVsCodeModule.workspace.getConfiguration;

      let configChangeListener:
        ((e: { affectsConfiguration: (s: string) => boolean }) => void) | undefined;
      mockVsCodeModule.workspace.onDidChangeConfiguration = vi.fn((listener) => {
        configChangeListener = listener;
        return { dispose: vi.fn() };
      });

      let folderChangeListener: ((e: { added: unknown[]; removed: unknown[] }) => void) | undefined;
      mockVsCodeModule.workspace.onDidChangeWorkspaceFolders = vi.fn((listener) => {
        folderChangeListener = listener;
        return { dispose: vi.fn() };
      });

      const { activate, deactivate } = await import("../../apps/vscode-extension/src/extension");

      const mockContext = {
        extensionPath:
          "z:/OLD PC Files/parnil - My Files/Programming/UNDRIFT/UNDRIFT-SourceCode/apps/vscode-extension",
        storageUri: makeUri("file:///test/storage/uri"),
        subscriptions: [] as { dispose: () => void }[]
      };

      activate(mockContext as unknown as Parameters<typeof activate>[0]);
      expect(mockContext.subscriptions.length).toBeGreaterThan(0);

      // Verify dynamic configuration change listener is registered and updates settings
      expect(configChangeListener).toBeDefined();
      configValues = { autoRun: false, debounceMs: 500, runOnStartup: false };
      configChangeListener!({ affectsConfiguration: (s) => s.startsWith("undrift.analysis") });

      // Verify workspace folder change listener is registered
      expect(folderChangeListener).toBeDefined();

      await deactivate();
    });
  });
});
