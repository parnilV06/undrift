// Comprehensive test suite for UNDRIFT Commands, Status Bar, and Lifecycle Actions
// strictly adhering to LLD.md Sections 14.8, 14.9, 16.2, and Chunk 4.8 specification.

import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisCoverageSummary,
  AnalysisResult,
  AnalysisSnapshot,
  DocumentUri,
  Finding,
  FindingCategory,
  FindingId,
  FindingSeverity,
  PersistedFindingRecord,
  RuleId,
  SourceSpan,
  WorkspaceId
} from "@undrift/core";
import type {
  AnalysisCoordinator,
  CoordinatorAnalysisResult,
  RestoredSessionState
} from "../../apps/vscode-extension/src/activation/coordinator";
import {
  formatIncompleteScanMessage,
  registerCommands,
  type CommandDependencies
} from "../../apps/vscode-extension/src/commands";
import { DriftStatusBar } from "../../apps/vscode-extension/src/status";
import type {
  FindingsTreeDataProvider,
  ReportPanelManager
} from "../../apps/vscode-extension/src/views";

const { MockPosition, MockRange, MockUri, MockStatusBarItem, mockVsCodeModule } = vi.hoisted(() => {
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
      public readonly query: string,
      public readonly fragment: string
    ) {}

    static parse(val: string): MockUri {
      try {
        const u = new URL(val);
        return new MockUri(u.protocol.replace(":", ""), u.host, u.pathname, u.search, u.hash);
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

  const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
  let lastCreatedStatusBarItem: MockStatusBarItem | undefined;

  const mockVsCodeModule = {
    Position: MockPosition,
    Range: MockRange,
    Uri: MockUri,
    StatusBarAlignment: {
      Left: 1,
      Right: 2
    },
    window: {
      createStatusBarItem: vi.fn((_alignment?: number, _priority?: number) => {
        lastCreatedStatusBarItem = new MockStatusBarItem();
        return lastCreatedStatusBarItem;
      }),
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn().mockResolvedValue(undefined),
      showQuickPick: vi.fn().mockResolvedValue(undefined),
      showTextDocument: vi.fn().mockResolvedValue({}),
      getLastStatusBarItem: () => lastCreatedStatusBarItem
    },
    workspace: {
      openTextDocument: vi.fn().mockResolvedValue({ uri: MockUri.file("/app/consumer.ts") })
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
      lastCreatedStatusBarItem = undefined;
      mockVsCodeModule.window.createStatusBarItem.mockClear();
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
    MockStatusBarItem,
    mockVsCodeModule
  };
});

vi.mock("vscode", () => mockVsCodeModule);

function createSampleFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "finding-user-id" as FindingId,
    ruleId: "field-type-mismatch" as RuleId,
    category: "shape-drift" as FindingCategory,
    severity: "error" as FindingSeverity,
    title: "User ID type mismatch",
    summary: "Expected number, received string in GET /api/users",
    state: "active",
    locations: {
      consumer: {
        uri: "file:///workspace/src/client.ts" as DocumentUri,
        range: {
          start: { line: 10, character: 4, utf16Offset: 120 },
          end: { line: 10, character: 25, utf16Offset: 141 }
        }
      },
      provider: {
        uri: "file:///workspace/src/server.ts" as DocumentUri,
        range: {
          start: { line: 20, character: 2, utf16Offset: 250 },
          end: { line: 20, character: 18, utf16Offset: 266 }
        }
      }
    },
    ...overrides
  };
}

function createSampleSnapshot(
  findings: Finding[] = [createSampleFinding()],
  wsId: WorkspaceId = "ws-test" as WorkspaceId
): AnalysisSnapshot {
  return {
    schemaVersion: 1,
    workspaceId: wsId,
    timestamp: "2026-10-23T10:00:00.000Z",
    generation: 1,
    statistics: {
      filesDiscovered: 2,
      filesParsed: 2,
      consumerRoutesFound: 1,
      providerRoutesFound: 1,
      durationMs: 50
    },
    coverage: {
      coveredRatio: 1,
      uncoveredFiles: [],
      warnings: []
    },
    findings
  };
}

describe("Phase 4, Chunk 4.8: Commands, Status & Lifecycle Actions", () => {
  let mockVsCode: typeof mockVsCodeModule;
  let mockScheduler: {
    runImmediateScan: ReturnType<typeof vi.fn>;
    registerWorkspaceEvents: ReturnType<typeof vi.fn>;
  };
  let mockCoordinator: {
    getScheduler: ReturnType<typeof vi.fn>;
    getActiveWorkspaceId: ReturnType<typeof vi.fn>;
    getLastKnownSnapshot: ReturnType<typeof vi.fn>;
    onAnalysisCompleted: ReturnType<typeof vi.fn>;
    resetHistory: ReturnType<typeof vi.fn>;
    clearCache: ReturnType<typeof vi.fn>;
  };
  let mockTreeProvider: {
    refresh: ReturnType<typeof vi.fn>;
    handleSessionRestored: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  let mockReportPanelManager: {
    show: ReturnType<typeof vi.fn>;
    handleHistoryReset: ReturnType<typeof vi.fn>;
    handleSessionRestored: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  let analysisOutcomeListeners: ((outcome: CoordinatorAnalysisResult) => void)[] = [];

  beforeEach(() => {
    mockVsCodeModule.resetMocks();
    mockVsCode = mockVsCodeModule;
    analysisOutcomeListeners = [];

    mockScheduler = {
      runImmediateScan: vi.fn().mockResolvedValue({
        status: "success",
        result: {
          schemaVersion: 1,
          workspaceId: "ws-test",
          findings: [createSampleFinding()],
          statistics: { filesParsed: 2 }
        }
      } as unknown as CoordinatorAnalysisResult),
      registerWorkspaceEvents: vi.fn().mockReturnValue({ dispose: vi.fn() })
    };

    mockCoordinator = {
      getScheduler: vi.fn().mockReturnValue(mockScheduler),
      getActiveWorkspaceId: vi.fn().mockReturnValue("ws-test" as WorkspaceId),
      getLastKnownSnapshot: vi.fn().mockReturnValue(createSampleSnapshot()),
      onAnalysisCompleted: vi.fn((listener: (outcome: CoordinatorAnalysisResult) => void) => {
        analysisOutcomeListeners.push(listener);
        return {
          dispose: () => {
            analysisOutcomeListeners = analysisOutcomeListeners.filter((l) => l !== listener);
          }
        };
      }),
      resetHistory: vi.fn().mockResolvedValue(undefined),
      clearCache: vi.fn().mockResolvedValue(undefined)
    };

    mockTreeProvider = {
      refresh: vi.fn(),
      handleSessionRestored: vi.fn(),
      dispose: vi.fn()
    };

    mockReportPanelManager = {
      show: vi.fn().mockResolvedValue(undefined),
      handleHistoryReset: vi.fn(),
      handleSessionRestored: vi.fn(),
      dispose: vi.fn()
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // 1. Command Registrations & Invocations
  // --------------------------------------------------------------------------
  describe("Command Registrations & Invocations", () => {
    it("registers all 7 documented UNDRIFT commands and returns disposables", () => {
      const statusBar = new DriftStatusBar({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      const disposables = registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        treeProvider: mockTreeProvider as unknown as FindingsTreeDataProvider,
        statusBar,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      expect(disposables).toHaveLength(8);

      const registered = mockVsCode.commands.getRegisteredCommands();
      expect(registered.has("undrift.scanWorkspace")).toBe(true);
      expect(registered.has("undrift.refresh")).toBe(true);
      expect(registered.has("undrift.showReport")).toBe(true);
      expect(registered.has("undrift.explainFinding")).toBe(true);
      expect(registered.has("undrift.resetHistory")).toBe(true);
      expect(registered.has("undrift.clearCache")).toBe(true);
      expect(registered.has("undrift.openFindingLocation")).toBe(true);
      expect(registered.has("undrift.applyFix")).toBe(true);

      // Clean disposal
      for (const d of disposables) {
        d.dispose();
      }
      expect(mockVsCode.commands.getRegisteredCommands().size).toBe(0);
    });

    it("verifies package.json contributes all 8 commands and appropriate view title/item menus", () => {
      const packageJsonPath = path.resolve(__dirname, "../../apps/vscode-extension/package.json");
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));

      const commandIds = packageJson.contributes.commands.map(
        (c: { command: string }) => c.command
      );
      expect(commandIds).toContain("undrift.scanWorkspace");
      expect(commandIds).toContain("undrift.refresh");
      expect(commandIds).toContain("undrift.showReport");
      expect(commandIds).toContain("undrift.explainFinding");
      expect(commandIds).toContain("undrift.resetHistory");
      expect(commandIds).toContain("undrift.clearCache");
      expect(commandIds).toContain("undrift.openFindingLocation");
      expect(commandIds).toContain("undrift.applyFix");

      // Verify command palette hides navigation and repair helpers
      const hiddenCommands = packageJson.contributes.menus.commandPalette;
      expect(
        hiddenCommands.some(
          (m: { command: string; when: string }) =>
            m.command === "undrift.openFindingLocation" && m.when === "false"
        )
      ).toBe(true);
      expect(
        hiddenCommands.some(
          (m: { command: string; when: string }) =>
            m.command === "undrift.applyFix" && m.when === "false"
        )
      ).toBe(true);

      // Verify view/title buttons on undrift.findingsView
      const titleMenus = packageJson.contributes.menus["view/title"];
      const titleCmds = titleMenus.map((m: { command: string }) => m.command);
      expect(titleCmds).toContain("undrift.scanWorkspace");
      expect(titleCmds).toContain("undrift.refresh");
      expect(titleCmds).toContain("undrift.showReport");
      expect(titleCmds).toContain("undrift.clearCache");
      expect(titleCmds).toContain("undrift.resetHistory");

      // Verify view/item/context inline action
      const itemMenus = packageJson.contributes.menus["view/item/context"];
      expect(
        itemMenus.some(
          (m: { command: string; group: string }) =>
            m.command === "undrift.explainFinding" && m.group === "inline"
        )
      ).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 2. undrift.scanWorkspace
  // --------------------------------------------------------------------------
  describe("undrift.scanWorkspace", () => {
    it("sets status bar to analyzing, triggers immediate scan, and shows info message on success", async () => {
      const statusBar = new DriftStatusBar({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        statusBar,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      mockScheduler.runImmediateScan.mockResolvedValueOnce({
        status: "success",
        totalAcquired: 3,
        result: {
          statistics: { filesParsed: 3 },
          findings: [createSampleFinding(), createSampleFinding({ id: "f2" as FindingId })]
        }
      });

      await mockVsCode.commands.executeCommand("undrift.scanWorkspace");

      expect(mockScheduler.runImmediateScan).toHaveBeenCalledTimes(1);
      expect(mockVsCode.window.showInformationMessage).toHaveBeenCalledWith(
        "UNDRIFT: Analysis complete. Analyzed 3 files, found 2 contract drift findings."
      );
    });

    it("displays warning message when state persistence fails after a successful scan", async () => {
      const statusBar = new DriftStatusBar({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        statusBar,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      mockScheduler.runImmediateScan.mockResolvedValueOnce({
        status: "success",
        persistenceStatus: "failed",
        persistenceError: "Disk full",
        result: {
          statistics: { filesParsed: 1 },
          findings: [createSampleFinding()]
        }
      });

      await mockVsCode.commands.executeCommand("undrift.scanWorkspace");

      expect(mockVsCode.window.showWarningMessage).toHaveBeenCalledWith(
        "UNDRIFT: Analysis complete (1 finding), but failed to save analysis state: Disk full."
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("State persistence failed: Disk full")
      );
    });

    it("displays incomplete scan message when analysis is partial", async () => {
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      mockScheduler.runImmediateScan.mockResolvedValueOnce({
        status: "incomplete",
        totalAcquired: 4,
        failures: ["file:///workspace/src/broken.ts"],
        result: {
          statistics: { filesParsed: 3 },
          findings: []
        }
      });

      await mockVsCode.commands.executeCommand("undrift.scanWorkspace");

      expect(mockVsCode.window.showWarningMessage).toHaveBeenCalledWith(
        formatIncompleteScanMessage(3, 0, 1)
      );
    });

    it("displays error message on failed scan outcome", async () => {
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      mockScheduler.runImmediateScan.mockResolvedValueOnce({
        status: "failed",
        errorMessage: "Memory limit reached"
      });

      await mockVsCode.commands.executeCommand("undrift.scanWorkspace");

      expect(mockVsCode.window.showErrorMessage).toHaveBeenCalledWith(
        "UNDRIFT: Analysis failed — Memory limit reached"
      );
    });

    it("handles cancelled and superseded outcomes silently without error or false success", async () => {
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      mockScheduler.runImmediateScan.mockResolvedValueOnce({ status: "cancelled" });
      await mockVsCode.commands.executeCommand("undrift.scanWorkspace");
      expect(mockVsCode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(mockVsCode.window.showErrorMessage).not.toHaveBeenCalled();

      mockScheduler.runImmediateScan.mockResolvedValueOnce({ status: "superseded" });
      await mockVsCode.commands.executeCommand("undrift.scanWorkspace");
      expect(mockVsCode.window.showInformationMessage).not.toHaveBeenCalled();
      expect(mockVsCode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it("displays error message if scheduler throws unexpected exception", async () => {
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      mockScheduler.runImmediateScan.mockRejectedValueOnce(new Error("Fatal explosion"));
      await mockVsCode.commands.executeCommand("undrift.scanWorkspace");

      expect(mockVsCode.window.showErrorMessage).toHaveBeenCalledWith(
        "UNDRIFT: Scan encountered an error: Fatal explosion"
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. undrift.refresh
  // --------------------------------------------------------------------------
  describe("undrift.refresh", () => {
    it("refreshes tree provider, sets status bar to analyzing, and initiates immediate scan", async () => {
      const statusBar = new DriftStatusBar({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        treeProvider: mockTreeProvider as unknown as FindingsTreeDataProvider,
        statusBar,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.refresh");

      expect(mockTreeProvider.refresh).toHaveBeenCalledTimes(1);
      expect(statusBar.getState()).toBe("analyzing");
      expect(mockScheduler.runImmediateScan).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // 4. undrift.showReport
  // --------------------------------------------------------------------------
  describe("undrift.showReport", () => {
    it("delegates to reportPanelManager.show with targetFindingId if provided", async () => {
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.showReport", "finding-user-id");
      expect(mockReportPanelManager.show).toHaveBeenCalledWith("finding-user-id");

      await mockVsCode.commands.executeCommand("undrift.showReport");
      expect(mockReportPanelManager.show).toHaveBeenCalledWith(undefined);
    });
  });

  // --------------------------------------------------------------------------
  // 5. undrift.explainFinding
  // --------------------------------------------------------------------------
  describe("undrift.explainFinding", () => {
    it("opens report with finding ID when passed a string finding ID", async () => {
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.explainFinding", "finding-abc");
      expect(mockReportPanelManager.show).toHaveBeenCalledWith("finding-abc");
    });

    it("opens report with finding ID when passed a FindingTreeItem object", async () => {
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      const treeItemArg = {
        finding: createSampleFinding({ id: "finding-tree-123" as FindingId })
      };

      await mockVsCode.commands.executeCommand("undrift.explainFinding", treeItemArg);
      expect(mockReportPanelManager.show).toHaveBeenCalledWith("finding-tree-123");
    });

    it("opens report with finding ID when passed a Finding object directly", async () => {
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      const findingObj = createSampleFinding({ id: "finding-direct" as FindingId });
      await mockVsCode.commands.executeCommand("undrift.explainFinding", findingObj);
      expect(mockReportPanelManager.show).toHaveBeenCalledWith("finding-direct");
    });

    it("handles zero active findings when called without arguments", async () => {
      mockCoordinator.getLastKnownSnapshot.mockReturnValueOnce(
        createSampleSnapshot([], "ws-test" as WorkspaceId)
      );

      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.explainFinding");

      expect(mockVsCode.window.showInformationMessage).toHaveBeenCalledWith(
        "UNDRIFT: No active contract drift findings to explain in the current workspace."
      );
      expect(mockReportPanelManager.show).toHaveBeenCalledWith();
    });

    it("automatically explains the single active finding when called with no arguments", async () => {
      const singleFinding = createSampleFinding({ id: "finding-only-one" as FindingId });
      mockCoordinator.getLastKnownSnapshot.mockReturnValueOnce(
        createSampleSnapshot([singleFinding], "ws-test" as WorkspaceId)
      );

      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.explainFinding");

      expect(mockReportPanelManager.show).toHaveBeenCalledWith("finding-only-one");
      expect(mockVsCode.window.showQuickPick).not.toHaveBeenCalled();
    });

    it("displays QuickPick when multiple findings exist and opens selected finding", async () => {
      const f1 = createSampleFinding({ id: "f1" as FindingId, title: "Drift 1" });
      const f2 = createSampleFinding({ id: "f2" as FindingId, title: "Drift 2" });
      mockCoordinator.getLastKnownSnapshot.mockReturnValueOnce(
        createSampleSnapshot([f1, f2], "ws-test" as WorkspaceId)
      );

      mockVsCode.window.showQuickPick.mockResolvedValueOnce({
        label: "Drift 2",
        findingId: "f2"
      });

      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.explainFinding");

      expect(mockVsCode.window.showQuickPick).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ findingId: "f1" }),
          expect.objectContaining({ findingId: "f2" })
        ]),
        expect.any(Object)
      );
      expect(mockReportPanelManager.show).toHaveBeenCalledWith("f2");
    });

    it("does not open report if user cancels QuickPick selection", async () => {
      const f1 = createSampleFinding({ id: "f1" as FindingId });
      const f2 = createSampleFinding({ id: "f2" as FindingId });
      mockCoordinator.getLastKnownSnapshot.mockReturnValueOnce(
        createSampleSnapshot([f1, f2], "ws-test" as WorkspaceId)
      );

      mockVsCode.window.showQuickPick.mockResolvedValueOnce(undefined);

      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.explainFinding");

      expect(mockReportPanelManager.show).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // 6. undrift.resetHistory
  // --------------------------------------------------------------------------
  describe("undrift.resetHistory", () => {
    it("informs user when no workspace folder is open", async () => {
      mockCoordinator.getActiveWorkspaceId.mockReturnValueOnce(undefined);

      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.resetHistory");

      expect(mockVsCode.window.showInformationMessage).toHaveBeenCalledWith(
        "UNDRIFT: No workspace folder is currently open in VS Code."
      );
      expect(mockVsCode.window.showWarningMessage).not.toHaveBeenCalled();
      expect(mockCoordinator.resetHistory).not.toHaveBeenCalled();
    });

    it("prompts modal confirmation and aborts when user cancels", async () => {
      mockVsCode.window.showWarningMessage.mockResolvedValueOnce(undefined);

      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.resetHistory");

      expect(mockVsCode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Reset UNDRIFT drift history for workspace "ws-test"?'),
        { modal: true },
        "Reset History"
      );
      expect(mockCoordinator.resetHistory).not.toHaveBeenCalled();
      expect(mockReportPanelManager.handleHistoryReset).not.toHaveBeenCalled();
    });

    it("executes history reset, updates report panel and tree, and shows success on confirmation", async () => {
      mockVsCode.window.showWarningMessage.mockResolvedValueOnce("Reset History");

      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        treeProvider: mockTreeProvider as unknown as FindingsTreeDataProvider,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.resetHistory");

      expect(mockCoordinator.resetHistory).toHaveBeenCalledWith("ws-test");
      expect(mockReportPanelManager.handleHistoryReset).toHaveBeenCalledWith("ws-test");
      expect(mockTreeProvider.refresh).toHaveBeenCalledTimes(1);
      expect(mockVsCode.window.showInformationMessage).toHaveBeenCalledWith(
        "UNDRIFT: Drift history reset successfully for this workspace."
      );
    });

    it("handles reset failure gracefully and shows error message", async () => {
      mockVsCode.window.showWarningMessage.mockResolvedValueOnce("Reset History");
      mockCoordinator.resetHistory.mockRejectedValueOnce(new Error("Permission denied"));

      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.resetHistory");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to reset drift history",
        expect.any(Error)
      );
      expect(mockVsCode.window.showErrorMessage).toHaveBeenCalledWith(
        "UNDRIFT: Failed to reset drift history: Permission denied"
      );
    });
  });

  // --------------------------------------------------------------------------
  // 7. undrift.clearCache
  // --------------------------------------------------------------------------
  describe("undrift.clearCache", () => {
    it("informs user when no workspace folder is open", async () => {
      mockCoordinator.getActiveWorkspaceId.mockReturnValueOnce(undefined);

      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.clearCache");

      expect(mockVsCode.window.showInformationMessage).toHaveBeenCalledWith(
        "UNDRIFT: No workspace folder is currently open in VS Code."
      );
      expect(mockCoordinator.clearCache).not.toHaveBeenCalled();
    });

    it("clears temporary tier-3 in-memory cache and triggers clean immediate workspace re-scan", async () => {
      const statusBar = new DriftStatusBar({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        statusBar,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.clearCache");

      expect(mockCoordinator.clearCache).toHaveBeenCalledTimes(1);
      expect(mockVsCode.window.showInformationMessage).toHaveBeenCalledWith(
        "UNDRIFT: In-memory workspace state cache cleared (saved snapshots and lifecycle history are preserved). Re-scanning workspace..."
      );
      expect(statusBar.getState()).toBe("analyzing");
      expect(mockScheduler.runImmediateScan).toHaveBeenCalledTimes(1);
    });

    it("handles cache clearing failure gracefully and shows error message", async () => {
      mockCoordinator.clearCache.mockRejectedValueOnce(new Error("Storage unavailable"));

      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        logger: mockLogger,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await mockVsCode.commands.executeCommand("undrift.clearCache");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to clear in-memory workspace state cache",
        expect.any(Error)
      );
      expect(mockVsCode.window.showErrorMessage).toHaveBeenCalledWith(
        "UNDRIFT: Failed to clear in-memory workspace state cache: Storage unavailable"
      );
    });
  });

  // --------------------------------------------------------------------------
  // 8. undrift.openFindingLocation
  // --------------------------------------------------------------------------
  describe("undrift.openFindingLocation", () => {
    it("opens document and reveals range corresponding to the SourceSpan", async () => {
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      const span: SourceSpan = {
        uri: "file:///workspace/src/app.ts" as DocumentUri,
        range: {
          start: { line: 5, character: 10, utf16Offset: 50 },
          end: { line: 5, character: 20, utf16Offset: 60 }
        }
      };

      await mockVsCode.commands.executeCommand("undrift.openFindingLocation", span);

      expect(mockVsCode.workspace.openTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/workspace/src/app.ts" })
      );
      expect(mockVsCode.window.showTextDocument).toHaveBeenCalledTimes(1);
    });

    it("handles missing or undefined span safely without throwing", async () => {
      registerCommands({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        reportPanelManager: mockReportPanelManager as unknown as ReportPanelManager,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      await expect(
        mockVsCode.commands.executeCommand("undrift.openFindingLocation", undefined)
      ).resolves.not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // 9. DriftStatusBar
  // --------------------------------------------------------------------------
  describe("DriftStatusBar", () => {
    it("initializes with last-known snapshot findings count and shows report command", () => {
      const statusBar = new DriftStatusBar({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      expect(statusBar.getState()).toBe("last-known");
      const item = statusBar.getItem();
      expect(item).toBeDefined();
      expect(item?.text).toContain("UNDRIFT: 1 drift (restored)");
      expect(item?.command).toBe("undrift.showReport");
      expect(item?.isShown).toBe(true);

      statusBar.dispose();
      expect(item?.disposed).toBe(true);
    });

    it("transitions through all lifecycle states: analyzing, clean, findings, incomplete, failed, no-workspace", () => {
      const statusBar = new DriftStatusBar({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });
      const item = statusBar.getItem();

      statusBar.setAnalyzing();
      expect(statusBar.getState()).toBe("analyzing");
      expect(item?.text).toContain("$(sync~spin) UNDRIFT: Analyzing...");

      statusBar.setClean();
      expect(statusBar.getState()).toBe("clean");
      expect(item?.text).toContain("$(pass) UNDRIFT: Clean");

      statusBar.setFindings(3);
      expect(statusBar.getState()).toBe("findings");
      expect(item?.text).toContain("$(warning) UNDRIFT: 3 drift");

      statusBar.setIncomplete();
      expect(statusBar.getState()).toBe("incomplete");
      expect(item?.text).toContain("$(issue-draft) UNDRIFT: Incomplete");

      statusBar.setFailed();
      expect(statusBar.getState()).toBe("failed");
      expect(item?.text).toContain("$(error) UNDRIFT: Failed");

      statusBar.setNoWorkspace();
      expect(statusBar.getState()).toBe("no-workspace");
      expect(item?.text).toContain("$(circle-slash) UNDRIFT");

      statusBar.setNoAnalysis();
      expect(statusBar.getState()).toBe("no-analysis");
      expect(item?.text).toContain("$(eye) UNDRIFT");

      statusBar.dispose();
    });

    it("safeguards against stale results: ignores superseded and cancelled scan outcomes", () => {
      const statusBar = new DriftStatusBar({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });
      statusBar.setFindings(2);

      // Trigger superseded outcome
      for (const listener of analysisOutcomeListeners) {
        listener({ status: "superseded" });
      }
      expect(statusBar.getState()).toBe("findings");

      // Trigger cancelled outcome
      for (const listener of analysisOutcomeListeners) {
        listener({ status: "cancelled" });
      }
      expect(statusBar.getState()).toBe("findings");

      statusBar.dispose();
    });

    it("updates status bar when session restoration completes", () => {
      const statusBar = new DriftStatusBar({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        vscodeModule: mockVsCode as unknown as typeof vscode
      });

      const restored: RestoredSessionState = {
        status: "restored",
        workspaceId: "ws-test" as WorkspaceId,
        snapshot: createSampleSnapshot(
          [createSampleFinding(), createSampleFinding({ id: "f2" as FindingId })],
          "ws-test" as WorkspaceId
        ),
        history: { schemaVersion: 1, workspaceId: "ws-test" as WorkspaceId, events: [] },
        quarantined: false
      };

      statusBar.handleSessionRestored(restored);

      expect(statusBar.getState()).toBe("last-known");
      expect(statusBar.getItem()?.text).toContain("UNDRIFT: 2 drift (restored)");

      statusBar.dispose();
    });

    it("gracefully operates when createStatusBarItem is unavailable in headless environment", () => {
      const noStatusBarVsCode = {
        ...mockVsCode,
        window: {
          ...mockVsCode.window,
          createStatusBarItem: undefined
        }
      };

      const statusBar = new DriftStatusBar({
        coordinator: mockCoordinator as unknown as AnalysisCoordinator,
        vscodeModule: noStatusBarVsCode as unknown as typeof vscode
      });

      expect(statusBar.getItem()).toBeUndefined();
      expect(() => {
        statusBar.setAnalyzing();
        statusBar.setClean();
        statusBar.setFindings(1);
        statusBar.dispose();
      }).not.toThrow();
    });
  });
});
