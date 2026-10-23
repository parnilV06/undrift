/* eslint-disable @typescript-eslint/no-explicit-any */
// Phase 4, Chunk 4.9: End-to-End Integration Tests & Acceptance Verification
// Validates cross-component integration across activation, coordinator, scheduler,
// persistence, reconciler, diagnostics, findings tree, report panel, status bar, and commands,
// strictly adhering to LLD.md Sections 14.8, 14.9, 16.1-16.4, 22 and Chunk 4.9 specification.

import * as fs from "fs";
import * as path from "path";
import Module from "module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisCoverageSummary,
  AnalysisResult,
  AnalysisSnapshot,
  DocumentUri,
  Finding,
  FindingCategory,
  FindingId,
  FindingLifecycleEvent,
  FindingSeverity,
  PersistedFindingRecord,
  RetentionPolicy,
  RuleId,
  SourceDocument,
  SourceSpan,
  WorkspaceId
} from "@undrift/core";
import { AnalysisEngine, StateReconciler } from "@undrift/core";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { AnalysisCoordinator, deriveWorkspaceId } from "../../apps/vscode-extension/src/activation";
import { AnalysisScheduler } from "../../apps/vscode-extension/src/activation/scheduler";
import { DriftDiagnosticProvider } from "../../apps/vscode-extension/src/diagnostics";
import { OutputChannelLogger } from "../../apps/vscode-extension/src/logging";
import { DriftStatusBar } from "../../apps/vscode-extension/src/status";
import {
  createInMemoryStorageFileSystem,
  type InMemoryStorageFileSystem,
  StorageIOError,
  WorkspaceStatePersistenceAdapter
} from "../../apps/vscode-extension/src/storage";
import {
  FindingsTreeDataProvider,
  openFindingLocation,
  ReportPanelManager
} from "../../apps/vscode-extension/src/views";
import {
  type OpenDocumentAccessor,
  type UriLike,
  type WorkspaceAccessor,
  WorkspaceManager
} from "../../apps/vscode-extension/src/workspace";
import {
  formatIncompleteScanMessage,
  registerCommands
} from "../../apps/vscode-extension/src/commands";
import { activate, deactivate } from "../../apps/vscode-extension/src/extension";

// ----------------------------------------------------------------------------
// VS Code Mock Infrastructure
// ----------------------------------------------------------------------------

const {
  MockPosition,
  MockRange,
  MockUri,
  MockThemeIcon,
  MockThemeColor,
  MockTreeItem,
  MockStatusBarItem,
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

  class MockUri {
    constructor(
      public readonly scheme: string,
      public readonly authority: string,
      public readonly path: string,
      public readonly query: string = "",
      public readonly fragment: string = ""
    ) {}

    static parse(val: string): MockUri {
      try {
        const u = new URL(val);
        return new MockUri(u.protocol.replace(":", ""), u.host, u.pathname, u.search, u.hash);
      } catch {
        return new MockUri("file", "", val);
      }
    }

    static file(fsPath: string): MockUri {
      const normalized = fsPath.replace(/\\/g, "/");
      const pathPart = normalized.startsWith("/") ? normalized : "/" + normalized;
      return new MockUri("file", "", pathPart);
    }

    get fsPath(): string {
      return this.path;
    }

    toString(): string {
      return `${this.scheme}://${this.authority}${this.path}`;
    }
  }

  class MockThemeIcon {
    constructor(
      public readonly id: string,
      public readonly color?: unknown
    ) {}
  }

  class MockThemeColor {
    constructor(public readonly id: string) {}
  }

  enum MockTreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2
  }

  class MockTreeItem {
    public id?: string;
    public iconPath?: unknown;
    public description?: string | boolean;
    public resourceUri?: unknown;
    public tooltip?: string | unknown;
    public command?: unknown;
    public contextValue?: string;

    constructor(
      public label: string | unknown,
      public collapsibleState: MockTreeItemCollapsibleState = MockTreeItemCollapsibleState.None
    ) {}
  }

  class MockStatusBarItem {
    public text = "";
    public tooltip = "";
    public command?: string;
    public name?: string;
    public isShown = false;
    public disposed = false;

    show() {
      this.isShown = true;
    }

    hide() {
      this.isShown = false;
    }

    dispose() {
      this.disposed = true;
      this.isShown = false;
    }
  }

  class MockDiagnostic {
    public source = "UNDRIFT";
    public relatedInformation?: unknown[];

    constructor(
      public readonly range: MockRange,
      public readonly message: string,
      public readonly severity: number = 0
    ) {}
  }

  class MockCancellationTokenSource {
    private _isCancelled = false;
    private _listeners: (() => void)[] = [];

    public token = {
      get isCancellationRequested() {
        return (this as any)._parent._isCancelled;
      },
      onCancellationRequested: (listener: () => void) => {
        if (this._isCancelled) {
          listener();
        } else {
          this._listeners.push(listener);
        }
        return { dispose: () => {} };
      },
      _parent: this
    };

    public cancel(): void {
      this._isCancelled = true;
      for (const listener of this._listeners) {
        listener();
      }
    }

    public dispose(): void {
      this._listeners = [];
    }
  }

  const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
  const diagnosticCollections = new Map<string, Map<string, MockDiagnostic[]>>();
  let lastCreatedStatusBarItem: MockStatusBarItem | undefined;
  let activeWebviewPanel: any = undefined;

  const mockVsCodeModule = {
    Position: MockPosition,
    Range: MockRange,
    Uri: MockUri,
    ThemeIcon: MockThemeIcon,
    ThemeColor: MockThemeColor,
    TreeItem: MockTreeItem,
    TreeItemCollapsibleState: MockTreeItemCollapsibleState,
    CancellationTokenSource: MockCancellationTokenSource,
    Diagnostic: MockDiagnostic,
    DiagnosticSeverity: {
      Error: 0,
      Warning: 1,
      Information: 2,
      Hint: 3
    },
    DiagnosticRelatedInformation: class {
      constructor(
        public readonly location: unknown,
        public readonly message: string
      ) {}
    },
    Location: class {
      constructor(
        public readonly uri: unknown,
        public readonly range: unknown
      ) {}
    },
    StatusBarAlignment: {
      Left: 1,
      Right: 2
    },
    ViewColumn: {
      One: 1,
      Two: 2
    },
    window: {
      createStatusBarItem: vi.fn((_alignment?: number, _priority?: number) => {
        lastCreatedStatusBarItem = new MockStatusBarItem();
        return lastCreatedStatusBarItem;
      }),
      createWebviewPanel: vi.fn((viewType: string, title: string) => {
        activeWebviewPanel = {
          viewType,
          title,
          webview: {
            html: "",
            onDidReceiveMessage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
            postMessage: vi.fn().mockResolvedValue(true)
          },
          visible: true,
          reveal: vi.fn(),
          onDidDispose: vi.fn().mockReturnValue({ dispose: vi.fn() }),
          dispose: vi.fn(() => {
            activeWebviewPanel.visible = false;
          })
        };
        return activeWebviewPanel;
      }),
      registerTreeDataProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn().mockResolvedValue(undefined),
      showQuickPick: vi.fn().mockResolvedValue(undefined),
      showTextDocument: vi.fn().mockResolvedValue({}),
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        dispose: vi.fn(),
        show: vi.fn()
      })),
      getLastStatusBarItem: () => lastCreatedStatusBarItem,
      getActiveWebviewPanel: () => activeWebviewPanel
    },
    workspace: {
      openTextDocument: vi.fn(async (uri: unknown) => ({
        uri:
          typeof uri === "object" && uri !== null ? uri : MockUri.file("/workspace/src/client.ts"),
        fileName: "/workspace/src/client.ts",
        getText: () => ""
      })),
      onDidChangeTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidOpenTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidSaveTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidCreateFiles: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidDeleteFiles: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      onDidRenameFiles: vi.fn().mockReturnValue({ dispose: vi.fn() })
    },
    languages: {
      createDiagnosticCollection: vi.fn((name: string = "undrift") => {
        const store = new Map<string, MockDiagnostic[]>();
        diagnosticCollections.set(name, store);
        return {
          name,
          set: vi.fn((uri: { toString(): string }, diags: MockDiagnostic[]) => {
            store.set(uri.toString(), diags);
          }),
          delete: vi.fn((uri: { toString(): string }) => {
            store.delete(uri.toString());
          }),
          clear: vi.fn(() => {
            store.clear();
          }),
          dispose: vi.fn(() => {
            store.clear();
            diagnosticCollections.delete(name);
          }),
          get: (uri: { toString(): string }) => store.get(uri.toString()) ?? []
        };
      }),
      getDiagnosticCollection: (name: string = "undrift") => diagnosticCollections.get(name)
    },
    commands: {
      registerCommand: vi.fn((name: string, callback: (...args: unknown[]) => unknown) => {
        registeredCommands.set(name, callback);
        return {
          dispose: () => {
            registeredCommands.delete(name);
          }
        };
      }),
      executeCommand: vi.fn((name: string, ...args: unknown[]) => {
        const handler = registeredCommands.get(name);
        if (!handler) {
          throw new Error(`Command ${name} not registered`);
        }
        return handler(...args);
      }),
      getRegisteredCommands: () => registeredCommands
    },
    resetMocks: () => {
      registeredCommands.clear();
      diagnosticCollections.clear();
      lastCreatedStatusBarItem = undefined;
      activeWebviewPanel = undefined;
      mockVsCodeModule.window.createStatusBarItem.mockClear();
      mockVsCodeModule.window.createWebviewPanel.mockClear();
      mockVsCodeModule.window.registerTreeDataProvider.mockClear();
      mockVsCodeModule.window.showInformationMessage.mockClear();
      mockVsCodeModule.window.showWarningMessage.mockClear();
      mockVsCodeModule.window.showErrorMessage.mockClear();
      mockVsCodeModule.window.showQuickPick.mockClear();
      mockVsCodeModule.window.showTextDocument.mockClear();
      mockVsCodeModule.workspace.openTextDocument.mockClear();
      mockVsCodeModule.commands.registerCommand.mockClear();
      mockVsCodeModule.commands.executeCommand.mockClear();
    }
  };

  return {
    MockPosition,
    MockRange,
    MockUri,
    MockThemeIcon,
    MockThemeColor,
    MockTreeItem,
    MockStatusBarItem,
    mockVsCodeModule
  };
});

vi.mock("vscode", () => mockVsCodeModule);

// Bridge Module.prototype.require for CJS requires of "vscode"
const originalRequire = (Module as any).prototype.require;
(Module as any).prototype.require = function (id: string, ...args: any[]) {
  if (id === "vscode") {
    return mockVsCodeModule;
  }
  return originalRequire.call(this, id, ...args);
};

// ----------------------------------------------------------------------------
// Test Helpers & Fixtures
// ----------------------------------------------------------------------------

function makeUri(uriStr: string): UriLike {
  return {
    toString: () => uriStr,
    scheme: uriStr.split(":")[0],
    path: uriStr.replace(/^[a-zA-Z0-9+-.]+:\/\//, "/")
  };
}

function createSampleFinding(id: string = "finding-1", overrides: Partial<Finding> = {}): Finding {
  return {
    id: id as FindingId,
    ruleId: "field-type-mismatch" as RuleId,
    category: "shape" as FindingCategory,
    severity: "error" as FindingSeverity,
    evidenceStrength: "exact",
    title: `Mismatch in ${id}`,
    summary: `Field type discrepancy for ${id}`,
    state: "active",
    sourceLocations: [],
    limitations: [],
    firstObservedAt: 1700000000000,
    lastConfirmedAt: 1700000000000,
    locations: {
      consumer: {
        uri: "file:///workspace/src/client.ts" as DocumentUri,
        range: { start: 100, end: 120 },
        start: { line: 5, character: 10 },
        end: { line: 5, character: 30 }
      },
      provider: {
        uri: "file:///workspace/src/server.ts" as DocumentUri,
        range: { start: 250, end: 268 },
        start: { line: 12, character: 2 },
        end: { line: 12, character: 20 }
      }
    },
    ...overrides
  };
}

function createSampleSnapshot(
  wsId: WorkspaceId,
  generation: number = 1,
  findings: Finding[] = [createSampleFinding()]
): AnalysisSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: `snap:${wsId}:${generation}`,
    workspaceId: wsId,
    timestamp: "2026-10-23T10:00:00.000Z",
    generation,
    analyzedAt: 1700000000000,
    statistics: {
      filesDiscovered: 2,
      filesParsed: 2,
      consumerRoutesFound: 1,
      providerRoutesFound: 1,
      durationMs: 40
    },
    coverage: {
      complete: true,
      filesScanned: 2,
      filesWithWarnings: 0,
      unresolvedPatterns: 0,
      coveredRatio: 1,
      uncoveredFiles: [],
      warnings: []
    },
    findings
  };
}

function createMockWorkspaceManager(
  options: {
    roots?: string[];
    documents?: SourceDocument[];
    failures?: string[];
    status?: "success" | "partial" | "empty" | "failed" | "no-workspace";
  } = {}
): WorkspaceManager {
  const roots = options.roots ?? ["file:///workspace-alpha"];
  const docs = options.documents ?? [];
  const failures = options.failures ?? [];
  const status = options.status ?? "success";

  return {
    getWorkspaceRoots: () => roots,
    createWorkspaceSnapshot: async () => ({
      status,
      workspaceRootUris: roots,
      documents: docs,
      failures,
      totalDiscovered: docs.length + failures.length,
      totalAcquired: docs.length
    })
  } as unknown as WorkspaceManager;
}

// ----------------------------------------------------------------------------
// Test Suite
// ----------------------------------------------------------------------------

describe("Phase 4, Chunk 4.9: End-to-End Integration Tests & Acceptance Verification", () => {
  const wsA: WorkspaceId = "file:///workspace-alpha" as WorkspaceId;
  const wsB: WorkspaceId = "file:///workspace-beta" as WorkspaceId;
  let inMemoryFs: InMemoryStorageFileSystem;
  let storageUri: UriLike;

  beforeEach(() => {
    mockVsCodeModule.resetMocks();
    inMemoryFs = createInMemoryStorageFileSystem();
    storageUri = makeUri("file:///test/vscode-storage");
  });

  afterEach(async () => {
    try {
      await deactivate();
    } catch {
      // ignore cleanup errors during teardown
    }
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Flow 1: Full Extension Activation, Restoration, and Deactivation
  // ==========================================================================
  describe("Flow 1: Extension Activation, Session Restoration, and Deactivation", () => {
    it("activates all subsystems, restores session state, registers commands, and disposes cleanly", async () => {
      const mockContext = {
        extensionPath: path.resolve(__dirname, "../../apps/vscode-extension"),
        storageUri: makeUri("file:///test/vscode-storage"),
        subscriptions: [] as { dispose(): void }[]
      };

      // 1. Activate extension
      activate(mockContext as any);

      // Verify subscriptions contain disposables: logger, diagnostics, treeProvider, reportPanelManager, statusBar, events, commands
      expect(mockContext.subscriptions.length).toBeGreaterThanOrEqual(8);

      // Verify commands registered
      const registered = mockVsCodeModule.commands.getRegisteredCommands();
      expect(registered.has("undrift.scanWorkspace")).toBe(true);
      expect(registered.has("undrift.refresh")).toBe(true);
      expect(registered.has("undrift.showReport")).toBe(true);
      expect(registered.has("undrift.explainFinding")).toBe(true);
      expect(registered.has("undrift.resetHistory")).toBe(true);
      expect(registered.has("undrift.clearCache")).toBe(true);
      expect(registered.has("undrift.openFindingLocation")).toBe(true);

      // Verify status bar item created and displayed
      const statusBarItem = mockVsCodeModule.window.getLastStatusBarItem();
      expect(statusBarItem).toBeDefined();
      expect(statusBarItem?.isShown).toBe(true);

      // 2. Deactivate extension
      await deactivate();

      // Verify status bar item disposed
      expect(statusBarItem?.disposed).toBe(true);

      // Repeated deactivation is safe no-op
      await expect(deactivate()).resolves.not.toThrow();
    });
  });

  // ==========================================================================
  // Flow 2: End-to-End Analysis, Reconciliation & State Consistency
  // ==========================================================================
  describe("Flow 2: End-to-End Analysis, Reconciliation & State Consistency", () => {
    it("coordinates real engine analysis, reconciles transitions, persists state, and updates all views consistently", async () => {
      // Set up real engine with production parser and analyzer
      const parser = new TreeSitterParserAdapter();
      const analyzer = new JsTsAnalyzer();
      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [analyzer]
      });

      // Sample consumer and provider documents with known drift (method conflict)
      const consumerDoc: SourceDocument = {
        uri: "file:///workspace-alpha/src/consumer.ts" as DocumentUri,
        text: `
          import axios from "axios";
          export async function createOrder() {
            return axios.get("/api/orders");
          }
        `,
        languageId: "typescript",
        version: 1,
        contentHash: "hash-c1"
      };

      const providerDoc: SourceDocument = {
        uri: "file:///workspace-alpha/src/server.ts" as DocumentUri,
        text: `
          import express from "express";
          const app = express();
          app.post("/api/orders", (req, res) => {
            res.json({ orderId: "ord-123", status: "confirmed" });
          });
        `,
        languageId: "typescript",
        version: 1,
        contentHash: "hash-p1"
      };

      const workspaceManager = createMockWorkspaceManager({
        roots: ["file:///workspace-alpha"],
        documents: [consumerDoc, providerDoc],
        status: "success"
      });

      const persistence = new WorkspaceStatePersistenceAdapter({
        storageUri: () => storageUri,
        fileSystem: inMemoryFs
      });

      const reconciler = new StateReconciler();
      const diagnosticProvider = new DriftDiagnosticProvider({
        vscodeModule: mockVsCodeModule as any
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        ownsEngine: false,
        persistence,
        reconciler,
        diagnosticProvider
      });

      const treeProvider = new FindingsTreeDataProvider({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      const reportPanelManager = new ReportPanelManager({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      const statusBar = new DriftStatusBar({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      // Connect session restoration
      const restored = await coordinator.restoreSession();
      treeProvider.handleSessionRestored(restored);
      reportPanelManager.handleSessionRestored(restored);
      statusBar.handleSessionRestored(restored);

      // Execute full workspace scan
      const outcome = await coordinator.runWorkspaceScan();

      expect(outcome.status).toBe("success");
      expect(outcome.persistenceStatus).toBe("saved");
      expect(outcome.generation).toBe(1);

      // Verify engine and reconciler detected findings
      const findings = outcome.result?.findings ?? [];
      expect(findings.length).toBeGreaterThan(0);

      // Verify persistent storage contains snapshot and lifecycle event
      const storedSnap = await persistence.loadLatestSnapshot(wsA);
      expect(storedSnap).toBeDefined();
      expect(storedSnap?.generation).toBe(1);

      const storedHistory = await persistence.loadLifecycleHistory(wsA);
      expect(storedHistory.length).toBeGreaterThan(0);
      expect(storedHistory[0].transitionKind).toBe("detected");

      // Verify diagnostics updated in VS Code
      const diagnosticsCollection = mockVsCodeModule.languages.getDiagnosticCollection("undrift");
      expect(diagnosticsCollection).toBeDefined();
      const consumerDiags = diagnosticsCollection?.get(consumerDoc.uri) ?? [];
      expect(consumerDiags.length).toBeGreaterThan(0);
      expect(consumerDiags[0].source).toBe("UNDRIFT");

      // Verify status bar updated to findings
      expect(statusBar.getState()).toBe("findings");
      expect(statusBar.getItem()?.text).toContain(`${findings.length} drift`);

      // Verify report panel view model has freshly-verified findings
      const reportState = reportPanelManager.getWorkspaceState(wsA);
      expect(reportState?.status).toBe("freshly-verified");
      expect(reportState?.findings.length).toBe(findings.length);

      // Cleanup
      statusBar.dispose();
      reportPanelManager.dispose();
      treeProvider.dispose();
      diagnosticProvider.dispose();
      await coordinator.dispose();
    });
  });

  // ==========================================================================
  // Flow 3: Session Reopening & "Last-Known" Guarantees
  // ==========================================================================
  describe("Flow 3: Session Reopening & Last-Known State Guarantees", () => {
    it("distinguishes restored session from freshly verified state and seeds monotonic generation", async () => {
      const persistence = new WorkspaceStatePersistenceAdapter({
        storageUri: () => storageUri,
        fileSystem: inMemoryFs
      });

      // Pre-seed storage with snapshot at generation 7 and 1 finding
      const priorFinding = createSampleFinding("drift-seed", { title: "Persisted Seed Drift" });
      const priorSnapshot = createSampleSnapshot(wsA, 7, [priorFinding]);
      await persistence.saveSnapshot(wsA, priorSnapshot);

      const workspaceManager = createMockWorkspaceManager({
        roots: ["file:///workspace-alpha"]
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        persistence
      });

      const treeProvider = new FindingsTreeDataProvider({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });
      const reportPanelManager = new ReportPanelManager({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });
      const statusBar = new DriftStatusBar({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      // Restore session
      const restored = await coordinator.restoreSession();
      expect(restored.status).toBe("restored");
      expect(restored.seededGeneration).toBe(7);

      treeProvider.handleSessionRestored(restored);
      reportPanelManager.handleSessionRestored(restored);
      statusBar.handleSessionRestored(restored);

      // Verify tree view reflects restored last-known state
      expect(treeProvider.getStatus().state).toBe("last-known");
      expect(treeProvider.getFindings()).toHaveLength(1);

      // Verify report reflects restored last-known state
      const reportState = reportPanelManager.getState(wsA);
      expect(reportState?.status).toBe("last-known");
      expect(reportState?.findings).toHaveLength(1);

      // Verify status bar indicates restored state
      expect(statusBar.getState()).toBe("last-known");
      expect(statusBar.getItem()?.text).toContain("UNDRIFT: 1 drift (restored)");

      // Next scan continues monotonically from generation 8
      expect(coordinator.getNextGeneration(wsA)).toBe(8);

      statusBar.dispose();
      reportPanelManager.dispose();
      treeProvider.dispose();
      await coordinator.dispose();
    });
  });

  // ==========================================================================
  // Regression Case A: Cancellation, Debounce, Superseding & Status Bar Integrity
  // ==========================================================================
  describe("Regression Case A: Cancellation, Debounce, Superseding & Status Bar Integrity", () => {
    it("coalesces rapid debounced edits and cancels obsolete timers", async () => {
      let runScanCallCount = 0;
      const coordinator = {
        getActiveWorkspaceId: () => wsA,
        runWorkspaceScan: vi.fn(async () => {
          runScanCallCount++;
          return { status: "success", workspaceId: wsA } as any;
        }),
        supersedeActiveScan: vi.fn(),
        isDisposed: false
      } as unknown as AnalysisCoordinator;

      const workspaceManager = createMockWorkspaceManager({
        roots: ["file:///workspace-alpha"]
      });

      const scheduler = new AnalysisScheduler({
        coordinator,
        workspaceManager,
        debounceDelayMs: 40
      });

      // 3 rapid document edits within debounce window
      const p1 = scheduler.handleDocumentChange("file:///workspace-alpha/src/a.ts");
      const p2 = scheduler.handleDocumentChange("file:///workspace-alpha/src/b.ts");
      const p3 = scheduler.handleDocumentChange("file:///workspace-alpha/src/c.ts");

      // Wait for debounce to fire
      await Promise.all([p1, p2, p3]);

      // Exactly 1 scan run
      expect(runScanCallCount).toBe(1);
      expect(coordinator.supersedeActiveScan).toHaveBeenCalled();

      scheduler.dispose();
    });

    it("ensures obsolete scan result is rejected at coordinator race-safe boundary and cannot overwrite state", async () => {
      const persistence = new WorkspaceStatePersistenceAdapter({
        storageUri: () => storageUri,
        fileSystem: inMemoryFs
      });

      let resolveSlowScan: (res: AnalysisResult) => void = () => {};
      const slowScanPromise = new Promise<AnalysisResult>((resolve) => {
        resolveSlowScan = resolve;
      });

      const engine = {
        analyze: vi.fn(async () => slowScanPromise)
      };

      const workspaceManager = createMockWorkspaceManager({
        roots: ["file:///workspace-alpha"]
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine: engine as any,
        persistence
      });

      await coordinator.restoreSession();

      // Start scan 1 (slow)
      const scan1Promise = coordinator.runWorkspaceScan();

      // Wait until scan 1 has reached engine.analyze and registered in activeScans
      while (engine.analyze.mock.calls.length === 0) {
        await new Promise((r) => setTimeout(r, 5));
      }

      // Supersede scan 1
      coordinator.supersedeActiveScan(wsA);

      // Now complete slow scan 1
      resolveSlowScan({
        workspaceId: wsA,
        generation: 1,
        generatedAt: Date.now(),
        complete: true,
        observations: [],
        relationships: [],
        findings: [createSampleFinding("obsolete-finding")],
        warnings: [],
        statistics: {
          filesConsidered: 1,
          filesParsed: 1,
          filesWithWarnings: 0,
          consumerObservations: 0,
          providerObservations: 0,
          relationships: 0,
          activeFindings: 1,
          unresolvedPatterns: 0,
          durationMs: 5
        }
      });

      const scan1Outcome = await scan1Promise;

      // Scan 1 rejected as superseded
      expect(scan1Outcome.status).toBe("superseded");
      expect(scan1Outcome.persistenceStatus).toBe("skipped-stale");

      // In-memory snapshot is NOT updated with obsolete findings
      expect(coordinator.getLastKnownSnapshot(wsA)).toBeUndefined();

      await coordinator.dispose();
    });

    it("ensures status bar does not remain stuck on 'Analyzing...' when a scan is cancelled and no replacement is active", async () => {
      let resolveScan: () => void = () => {};
      const scanBlockedPromise = new Promise<void>((resolve) => {
        resolveScan = resolve;
      });

      const workspaceManager = {
        getWorkspaceRoots: () => ["file:///workspace-alpha"],
        createWorkspaceSnapshot: async () => {
          await scanBlockedPromise;
          return {
            status: "success",
            workspaceRootUris: ["file:///workspace-alpha"],
            documents: [],
            failures: [],
            totalDiscovered: 0,
            totalAcquired: 0
          };
        }
      } as unknown as WorkspaceManager;

      const persistence = new WorkspaceStatePersistenceAdapter({
        storageUri: () => storageUri,
        fileSystem: inMemoryFs
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        persistence
      });

      await coordinator.restoreSession();

      const statusBar = new DriftStatusBar({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      // Start scan and set analyzing
      statusBar.setAnalyzing();
      expect(statusBar.getState()).toBe("analyzing");

      const cts = new mockVsCodeModule.CancellationTokenSource();
      const scanPromise = coordinator.runWorkspaceScan(cts.token as any);

      // Cancel the active scan
      cts.cancel();
      resolveScan();

      const outcome = await scanPromise;
      expect(outcome.status).toBe("cancelled");

      // Status bar must NOT remain stuck on analyzing; reverts to idle (no-analysis)
      expect(statusBar.getState()).not.toBe("analyzing");
      expect(statusBar.getState()).toBe("no-analysis");

      statusBar.dispose();
      await coordinator.dispose();
    });

    it("ensures outcome from a previous workspace does not clobber status bar when workspace changes", async () => {
      const coordinator = {
        getActiveWorkspaceId: vi.fn().mockReturnValue(wsB), // Currently switched to Workspace B
        getLastKnownSnapshot: vi.fn().mockReturnValue(undefined),
        getActiveScan: vi.fn().mockReturnValue(undefined),
        onAnalysisCompleted: vi.fn(() => ({ dispose: vi.fn() }))
      } as unknown as AnalysisCoordinator;

      const statusBar = new DriftStatusBar({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });
      statusBar.setClean();
      expect(statusBar.getState()).toBe("clean");

      // Delayed outcome arrives for Workspace A (which is no longer active)
      statusBar.handleAnalysisOutcome({
        status: "success",
        workspaceId: wsA,
        result: {
          findings: [createSampleFinding("drift-a")]
        } as any
      });

      // Status bar must remain clean for active Workspace B; Workspace A's outcome is ignored
      expect(statusBar.getState()).toBe("clean");

      statusBar.dispose();
    });
  });

  // ==========================================================================
  // Regression Case B: Reset Drift History & Workspace Isolation
  // ==========================================================================
  describe("Regression Case B: Reset Drift History & Workspace Isolation", () => {
    it("aborts reset when user cancels confirmation and clears only target workspace history on confirmation", async () => {
      const persistence = new WorkspaceStatePersistenceAdapter({
        storageUri: () => storageUri,
        fileSystem: inMemoryFs
      });

      // Seed both Workspace A and Workspace B with snapshots and history
      const snapA = createSampleSnapshot(wsA, 2, [createSampleFinding("fa")]);
      const snapB = createSampleSnapshot(wsB, 2, [createSampleFinding("fb")]);
      await persistence.saveSnapshot(wsA, snapA);
      await persistence.saveSnapshot(wsB, snapB);

      const eventA: FindingLifecycleEvent = {
        eventId: "evt-a1",
        schemaVersion: 1,
        workspaceId: wsA,
        findingId: "fa" as FindingId,
        transitionKind: "detected",
        observedAt: 1700000000000,
        triggerGeneration: 1,
        newState: "active"
      };
      const eventB: FindingLifecycleEvent = {
        ...eventA,
        eventId: "evt-b1",
        workspaceId: wsB,
        findingId: "fb" as FindingId
      };
      await persistence.appendLifecycleEvents(wsA, [eventA]);
      await persistence.appendLifecycleEvents(wsB, [eventB]);

      const workspaceManager = createMockWorkspaceManager({
        roots: ["file:///workspace-alpha"]
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        persistence
      });

      const reportPanelManager = new ReportPanelManager({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });
      const treeProvider = new FindingsTreeDataProvider({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      registerCommands({
        coordinator,
        reportPanelManager,
        treeProvider,
        vscodeModule: mockVsCodeModule as any
      });

      const restored = await coordinator.restoreSession();
      reportPanelManager.handleSessionRestored(restored);

      // 1. User cancels modal confirmation -> No reset
      mockVsCodeModule.window.showWarningMessage.mockResolvedValueOnce(undefined);
      await mockVsCodeModule.commands.executeCommand("undrift.resetHistory");

      expect(await persistence.loadLifecycleHistory(wsA)).toHaveLength(1);

      // 2. User confirms modal confirmation -> Resets Workspace A history only
      mockVsCodeModule.window.showWarningMessage.mockResolvedValueOnce("Reset History");
      await mockVsCodeModule.commands.executeCommand("undrift.resetHistory");

      // Workspace A history is cleared
      expect(await persistence.loadLifecycleHistory(wsA)).toHaveLength(0);
      expect(coordinator.getLastKnownHistory(wsA)).toEqual([]);

      // Workspace A snapshot and active findings remain completely intact
      const updatedSnapA = await persistence.loadLatestSnapshot(wsA);
      expect(updatedSnapA?.findings).toHaveLength(1);
      expect(coordinator.getLastKnownSnapshot(wsA)?.findings).toHaveLength(1);

      // Workspace B history is untouched (Workspace isolation preserved)
      expect(await persistence.loadLifecycleHistory(wsB)).toHaveLength(1);

      // Report panel reflects reset history without falsely marking findings as resolved
      const reportState = reportPanelManager.getState(wsA);
      expect(reportState?.history).toEqual([]);
      expect(reportState?.findings).toHaveLength(1);

      reportPanelManager.dispose();
      treeProvider.dispose();
      await coordinator.dispose();
    });

    it("surfaces persistence failure gracefully during history reset and preserves state integrity", async () => {
      const failingPersistence = {
        id: "failing-persistence",
        loadLatestSnapshot: async () => undefined,
        saveSnapshot: async () => {},
        loadLifecycleHistory: async () => [],
        appendLifecycleEvents: async () => {},
        pruneLifecycleHistory: async () => 0,
        clearCache: async () => {},
        resetHistory: async () => {
          throw new StorageIOError("Disk write-protected");
        }
      };

      const workspaceManager = createMockWorkspaceManager({
        roots: ["file:///workspace-alpha"]
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        persistence: failingPersistence
      });

      const reportPanelManager = new ReportPanelManager({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      registerCommands({
        coordinator,
        reportPanelManager,
        vscodeModule: mockVsCodeModule as any
      });

      await coordinator.restoreSession();

      mockVsCodeModule.window.showWarningMessage.mockResolvedValueOnce("Reset History");
      await mockVsCodeModule.commands.executeCommand("undrift.resetHistory");

      expect(mockVsCodeModule.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining("Failed to reset drift history: Disk write-protected")
      );

      reportPanelManager.dispose();
      await coordinator.dispose();
    });
  });

  // ==========================================================================
  // Regression Case C: Clear In-Memory State Cache & Fresh Re-scan Path
  // ==========================================================================
  describe("Regression Case C: Clear In-Memory State Cache & Fresh Re-scan Path", () => {
    it("clears in-memory Tier-3 state cache without deleting snapshots or history, then triggers fresh workspace scan", async () => {
      const persistence = new WorkspaceStatePersistenceAdapter({
        storageUri: () => storageUri,
        fileSystem: inMemoryFs
      });

      // Seed snapshot and history
      const snap = createSampleSnapshot(wsA, 3, [createSampleFinding("cache-test-f1")]);
      await persistence.saveSnapshot(wsA, snap);
      const event: FindingLifecycleEvent = {
        eventId: "evt-c1",
        schemaVersion: 1,
        workspaceId: wsA,
        findingId: "cache-test-f1" as FindingId,
        transitionKind: "detected",
        observedAt: 1700000000000,
        triggerGeneration: 1,
        newState: "active"
      };
      await persistence.appendLifecycleEvents(wsA, [event]);

      let scanExecuted = false;
      const workspaceManager = {
        getWorkspaceRoots: () => ["file:///workspace-alpha"],
        createWorkspaceSnapshot: async () => {
          scanExecuted = true;
          return {
            status: "success",
            workspaceRootUris: ["file:///workspace-alpha"],
            documents: [
              {
                uri: "file:///workspace-alpha/src/client.ts" as DocumentUri,
                text: `import axios from "axios"; export async function createOrder() { return axios.get("/api/orders"); }`,
                languageId: "typescript",
                version: 1,
                contentHash: "hash-c1"
              },
              {
                uri: "file:///workspace-alpha/src/server.ts" as DocumentUri,
                text: `import express from "express"; const app = express(); app.post("/api/orders", (req, res) => res.json({}));`,
                languageId: "typescript",
                version: 1,
                contentHash: "hash-p1"
              }
            ],
            failures: [],
            totalDiscovered: 2,
            totalAcquired: 2
          };
        }
      } as unknown as WorkspaceManager;

      const parser = new TreeSitterParserAdapter();
      const analyzer = new JsTsAnalyzer();
      const engine = new AnalysisEngine({
        parsers: [parser],
        analyzers: [analyzer]
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        engine,
        ownsEngine: false,
        persistence
      });

      const reportPanelManager = new ReportPanelManager({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });
      const statusBar = new DriftStatusBar({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      registerCommands({
        coordinator,
        reportPanelManager,
        statusBar,
        vscodeModule: mockVsCodeModule as any
      });

      await coordinator.restoreSession();

      // Execute Clear In-Memory Workspace State Cache
      await mockVsCodeModule.commands.executeCommand("undrift.clearCache");

      // Confirms snapshots and lifecycle history were NOT deleted
      const loadedSnap = await persistence.loadLatestSnapshot(wsA);
      expect(loadedSnap).toBeDefined();
      expect(loadedSnap?.findings).toHaveLength(1);

      const loadedHistory = await persistence.loadLifecycleHistory(wsA);
      expect(loadedHistory.length).toBeGreaterThanOrEqual(1);
      expect(loadedHistory.some((e) => e.eventId === "evt-c1")).toBe(true);

      // Confirms immediate scan was triggered
      expect(scanExecuted).toBe(true);

      statusBar.dispose();
      reportPanelManager.dispose();
      await coordinator.dispose();
    });
  });

  // ==========================================================================
  // Regression Case D: Accepted-State Guarantees & Incomplete Scan Protections
  // ==========================================================================
  describe("Regression Case D: Accepted-State Guarantees & Incomplete Scan Protections", () => {
    it("preserves previous complete snapshot and suppresses false resolutions on incomplete scan", async () => {
      const persistence = new WorkspaceStatePersistenceAdapter({
        storageUri: () => storageUri,
        fileSystem: inMemoryFs
      });

      // Baseline snapshot with 2 findings
      const f1 = createSampleFinding("f1");
      const f2 = createSampleFinding("f2");
      const baselineSnapshot = createSampleSnapshot(wsA, 1, [f1, f2]);
      await persistence.saveSnapshot(wsA, baselineSnapshot);

      const workspaceManager = {
        getWorkspaceRoots: () => ["file:///workspace-alpha"],
        createWorkspaceSnapshot: async () => ({
          status: "partial", // Incomplete scan!
          workspaceRootUris: ["file:///workspace-alpha"],
          documents: [
            {
              uri: "file:///workspace-alpha/src/good.ts" as DocumentUri,
              text: "export const x = 1;",
              languageId: "typescript",
              version: 1,
              contentHash: "hash-good"
            }
          ],
          failures: ["file:///workspace-alpha/src/broken.ts"],
          totalDiscovered: 2,
          totalAcquired: 1
        })
      } as unknown as WorkspaceManager;

      const diagnosticProvider = new DriftDiagnosticProvider({
        vscodeModule: mockVsCodeModule as any
      });
      const treeProvider = new FindingsTreeDataProvider({
        vscodeModule: mockVsCodeModule as any
      });
      const statusBar = new DriftStatusBar({
        vscodeModule: mockVsCodeModule as any
      });

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        persistence,
        diagnosticProvider
      });

      treeProvider.setCoordinator(coordinator);
      statusBar.setCoordinator(coordinator);

      await coordinator.restoreSession();

      // Run scan on partial workspace
      const outcome = await coordinator.runWorkspaceScan();

      expect(outcome.status).toBe("incomplete");

      // Incomplete scan preserves previous snapshot intact
      const storedSnap = await persistence.loadLatestSnapshot(wsA);
      expect(storedSnap?.findings).toHaveLength(2);

      // Incomplete scan emits ZERO false resolutions
      const history = await persistence.loadLifecycleHistory(wsA);
      expect(history.filter((e) => e.transitionKind === "resolved")).toHaveLength(0);

      // Status bar displays incomplete
      expect(statusBar.getState()).toBe("incomplete");
      expect(statusBar.getItem()?.text).toContain("Incomplete");

      statusBar.dispose();
      treeProvider.dispose();
      diagnosticProvider.dispose();
      await coordinator.dispose();
    });

    it("ensures failed analysis preserves previous accepted snapshot and history without corruption", async () => {
      const persistence = new WorkspaceStatePersistenceAdapter({
        storageUri: () => storageUri,
        fileSystem: inMemoryFs
      });

      const priorSnap = createSampleSnapshot(wsA, 5, [createSampleFinding("stable-f")]);
      await persistence.saveSnapshot(wsA, priorSnap);

      const workspaceManager = {
        getWorkspaceRoots: () => ["file:///workspace-alpha"],
        createWorkspaceSnapshot: async () => {
          throw new Error("Disk hardware failure");
        }
      } as unknown as WorkspaceManager;

      const coordinator = new AnalysisCoordinator({
        workspaceManager,
        persistence
      });

      const statusBar = new DriftStatusBar({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      await coordinator.restoreSession();

      const outcome = await coordinator.runWorkspaceScan();
      expect(outcome.status).toBe("failed");

      // Previous state completely preserved
      const snap = await persistence.loadLatestSnapshot(wsA);
      expect(snap?.generation).toBe(5);
      expect(snap?.findings).toHaveLength(1);

      // Status bar displays failed
      expect(statusBar.getState()).toBe("failed");
      expect(statusBar.getItem()?.text).toContain("Failed");

      statusBar.dispose();
      await coordinator.dispose();
    });
  });

  // ==========================================================================
  // Regression Case E: Resource Lifecycle & Duplicate Registration Prevention
  // ==========================================================================
  describe("Regression Case E: Resource Lifecycle & Duplicate Registration Prevention", () => {
    it("handles multiple activation-deactivation cycles without leaking listeners or duplicating registrations", async () => {
      const mockContext = {
        extensionPath: path.resolve(__dirname, "../../apps/vscode-extension"),
        storageUri: makeUri("file:///test/vscode-storage"),
        subscriptions: [] as { dispose(): void }[]
      };

      // Cycle 1: Activate and Deactivate
      activate(mockContext as any);
      expect(mockContext.subscriptions.length).toBeGreaterThan(0);
      await deactivate();
      for (const sub of mockContext.subscriptions) {
        sub?.dispose?.();
      }

      // Cycle 2: Activate and Deactivate
      const mockContext2 = {
        ...mockContext,
        subscriptions: [] as { dispose(): void }[]
      };
      activate(mockContext2 as any);
      expect(mockContext2.subscriptions.length).toBeGreaterThan(0);
      await deactivate();
      for (const sub of mockContext2.subscriptions) {
        sub?.dispose?.();
      }

      // Verify no duplicate commands registered
      const registered = mockVsCodeModule.commands.getRegisteredCommands();
      expect(registered.size).toBe(0);
    });
  });

  // ==========================================================================
  // Flow 4: Tree Selection, Source Navigation & Explain Finding
  // ==========================================================================
  describe("Flow 4: Tree Selection, Source Navigation & Explain Finding", () => {
    it("navigates to source spans via openFindingLocation and opens report via explainFinding", async () => {
      const f1 = createSampleFinding("finding-nav", {
        title: "Navigation Finding",
        locations: {
          consumer: {
            uri: "file:///workspace/src/client.ts" as DocumentUri,
            start: { line: 15, character: 4 },
            end: { line: 15, character: 25 }
          }
        }
      });

      const coordinator = {
        getActiveWorkspaceId: () => wsA,
        getLastKnownSnapshot: () => createSampleSnapshot(wsA, 1, [f1]),
        getLastKnownHistory: () => [],
        onAnalysisCompleted: () => ({ dispose: vi.fn() })
      } as unknown as AnalysisCoordinator;

      const reportPanelManager = new ReportPanelManager({
        coordinator,
        vscodeModule: mockVsCodeModule as any
      });

      registerCommands({
        coordinator,
        reportPanelManager,
        vscodeModule: mockVsCodeModule as any
      });

      // 1. Navigation helper
      await mockVsCodeModule.commands.executeCommand(
        "undrift.openFindingLocation",
        f1.locations.consumer
      );

      expect(mockVsCodeModule.workspace.openTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/workspace/src/client.ts" })
      );
      expect(mockVsCodeModule.window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          selection: expect.objectContaining({
            start: expect.objectContaining({ line: 15, character: 4 }),
            end: expect.objectContaining({ line: 15, character: 25 })
          })
        })
      );

      // 2. Explain finding
      await mockVsCodeModule.commands.executeCommand("undrift.explainFinding", "finding-nav");

      // Verify report panel opened and target finding rendered
      const panel = mockVsCodeModule.window.getActiveWebviewPanel();
      expect(panel).toBeDefined();
      expect(panel.webview.html).toContain("Navigation Finding");

      reportPanelManager.dispose();
    });
  });
});
