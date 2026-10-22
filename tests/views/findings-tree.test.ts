// Comprehensive test suite for UNDRIFT Contract Drift sidebar view (FindingsTreeDataProvider)
// strictly adhering to LLD.md Sections 14.3, 14.5, 14.9, and Chunk 4.6 specification.

import Module from "module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisSnapshot,
  DocumentUri,
  Finding,
  FindingCategory,
  FindingLifecycleEvent,
  FindingSeverity,
  PersistedFindingRecord,
  SourceSpan,
  WorkspaceId
} from "@undrift/core";
import type {
  AnalysisCoordinator,
  CoordinatorAnalysisResult,
  RestoredSessionState
} from "../../apps/vscode-extension/src/activation/coordinator";
import {
  EmptyTreeItem,
  FindingTreeItem,
  FindingsTreeDataProvider,
  GroupTreeItem,
  LocationTreeItem,
  MetadataTreeItem,
  openFindingLocation,
  StatusTreeItem,
  TreeCollapsibleState
} from "../../apps/vscode-extension/src/views";

const {
  MockPosition,
  MockRange,
  MockUri,
  MockThemeIcon,
  MockThemeColor,
  MockTreeItem,
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
    public accessibilityInformation?: unknown;

    constructor(
      public label: string | unknown,
      public collapsibleState: MockTreeItemCollapsibleState = MockTreeItemCollapsibleState.None
    ) {}
  }

  class MockEventEmitter<T> {
    private listeners: ((e: T) => unknown)[] = [];
    public event = (listener: (e: T) => unknown) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          this.listeners = this.listeners.filter((l) => l !== listener);
        }
      };
    };
    public fire(data?: T): void {
      for (const l of [...this.listeners]) {
        try {
          l(data as T);
        } catch {
          // ignore
        }
      }
    }
    public dispose(): void {
      this.listeners = [];
    }
  }

  const mockVsCodeModule = {
    Position: MockPosition,
    Range: MockRange,
    Uri: MockUri,
    ThemeIcon: MockThemeIcon,
    ThemeColor: MockThemeColor,
    TreeItem: MockTreeItem,
    TreeItemCollapsibleState: MockTreeItemCollapsibleState,
    EventEmitter: MockEventEmitter,
    window: {
      showTextDocument: vi.fn().mockResolvedValue({}),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      registerTreeDataProvider: vi.fn().mockReturnValue({ dispose: vi.fn() })
    },
    workspace: {
      openTextDocument: vi.fn().mockResolvedValue({ uri: MockUri.file("/test/app.ts") })
    },
    commands: {
      registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() })
    }
  };

  return {
    MockPosition,
    MockRange,
    MockUri,
    MockThemeIcon,
    MockThemeColor,
    MockTreeItem,
    mockVsCodeModule
  };
});

vi.mock("vscode", () => mockVsCodeModule);

// Intercept Module.prototype.require for CJS require("vscode")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalRequire = (Module as any).prototype.require;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Module as any).prototype.require = function (id: string, ...args: any[]) {
  if (id === "vscode") {
    return mockVsCodeModule;
  }
  return originalRequire.call(this, id, ...args);
};

// Fixture factories
function createSampleFinding(id: string, overrides?: Partial<Finding>): Finding {
  return {
    id: `finding:${id}`,
    ruleId: "UND200",
    category: "request-shape",
    severity: "error",
    state: "active",
    title: `Sample finding ${id}`,
    summary: `Summary of finding ${id}`,
    evidenceStrength: "exact",
    sourceLocations: [
      {
        uri: "file:///workspace/src/consumer.ts" as DocumentUri,
        range: { start: 10, end: 50 },
        start: { line: 5, character: 2 },
        end: { line: 5, character: 30 }
      },
      {
        uri: "file:///workspace/src/provider.ts" as DocumentUri,
        range: { start: 100, end: 150 },
        start: { line: 12, character: 4 },
        end: { line: 12, character: 40 }
      }
    ],
    limitations: [],
    suggestedFixes: [],
    ...overrides
  };
}

function createSampleSnapshot(
  workspaceId: WorkspaceId,
  generation: number,
  findings: readonly PersistedFindingRecord[] = []
): AnalysisSnapshot {
  return {
    schemaVersion: 1,
    snapshotId: `snap:${workspaceId}:${generation}`,
    workspaceId,
    generation,
    analyzedAt: 1700000000000 + generation * 1000,
    coverage: {
      complete: true,
      filesConsidered: 2,
      filesAnalyzed: 2,
      unsupportedFiles: 0,
      limitations: []
    },
    findings
  };
}

function createSampleLifecycleEvent(
  findingId: string,
  transitionKind: "detected" | "changed" | "resolved" | "reintroduced" = "detected",
  observedAt = 1700000000000
): FindingLifecycleEvent {
  return {
    eventId: `evt:${findingId}:${observedAt}`,
    findingId,
    observedAt,
    triggerGeneration: 1,
    transitionKind,
    resultingState: transitionKind === "resolved" ? "resolved" : "active"
  };
}

interface MockCoordinatorController {
  coordinator: AnalysisCoordinator;
  fireAnalysisCompleted: (result: CoordinatorAnalysisResult) => void;
  listenersCount: () => number;
}

function createMockCoordinator(
  initialWorkspaceId: WorkspaceId = "ws-default" as WorkspaceId,
  initialSnapshot?: AnalysisSnapshot,
  initialHistory: readonly FindingLifecycleEvent[] = []
): MockCoordinatorController {
  const listeners: ((outcome: CoordinatorAnalysisResult) => void)[] = [];
  const snapshots = new Map<WorkspaceId, AnalysisSnapshot>();
  const histories = new Map<WorkspaceId, readonly FindingLifecycleEvent[]>();

  if (initialSnapshot) {
    snapshots.set(initialWorkspaceId, initialSnapshot);
  }
  histories.set(initialWorkspaceId, initialHistory);

  const coordinator = {
    getActiveWorkspaceId: vi.fn(() => initialWorkspaceId),
    getLastKnownSnapshot: vi.fn((wsId: WorkspaceId) => snapshots.get(wsId)),
    getLastKnownHistory: vi.fn((wsId: WorkspaceId) => histories.get(wsId) ?? []),
    onAnalysisCompleted: vi.fn((listener: (outcome: CoordinatorAnalysisResult) => void) => {
      listeners.push(listener);
      return {
        dispose: () => {
          const idx = listeners.indexOf(listener);
          if (idx !== -1) listeners.splice(idx, 1);
        }
      };
    }),
    restoreSession: vi.fn().mockResolvedValue({
      status: initialSnapshot ? "restored" : "no-analysis",
      workspaceId: initialWorkspaceId,
      snapshot: initialSnapshot,
      history: initialHistory,
      seededGeneration: initialSnapshot?.generation ?? 0
    }),
    getScheduler: vi.fn(() => ({
      runImmediateScan: vi.fn().mockResolvedValue({ status: "success" })
    })),
    dispose: vi.fn().mockResolvedValue(undefined)
  } as unknown as AnalysisCoordinator;

  return {
    coordinator,
    fireAnalysisCompleted: (outcome: CoordinatorAnalysisResult) => {
      if (outcome.status === "success" && outcome.workspaceId && outcome.result) {
        // update coordinator mock in-memory stores
        const snap = createSampleSnapshot(
          outcome.workspaceId,
          outcome.generation ?? 1,
          outcome.result.findings as unknown as readonly PersistedFindingRecord[]
        );
        snapshots.set(outcome.workspaceId, snap);
      }
      for (const l of [...listeners]) {
        l(outcome);
      }
    },
    listenersCount: () => listeners.length
  };
}

describe("UNDRIFT Phase 4, Chunk 4.6: Findings Sidebar & Tree View", () => {
  let provider: FindingsTreeDataProvider;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (provider && !provider.isDisposed) {
      provider.dispose();
    }
  });

  describe("1. Findings grouping by severity and category", () => {
    it("groups findings by severity into Errors, Warnings, and Information by default", () => {
      const f1 = createSampleFinding("1", { severity: "error", title: "Route missing" });
      const f2 = createSampleFinding("2", { severity: "warning", title: "Param optional" });
      const f3 = createSampleFinding("3", { severity: "info", title: "Limitation noted" });

      provider = new FindingsTreeDataProvider({ groupBy: "severity" });
      provider.handleAnalysisOutcome({
        status: "success",
        workspaceId: "ws-1" as WorkspaceId,
        generation: 1,
        result: {
          workspaceId: "ws-1" as WorkspaceId,
          generation: 1,
          generatedAt: 1700000000000,
          complete: true,
          findings: [f1, f2, f3],
          observations: [],
          relationships: [],
          warnings: [],
          statistics: {
            filesConsidered: 1,
            filesParsed: 1,
            filesWithWarnings: 0,
            consumerObservations: 1,
            providerObservations: 1,
            relationships: 1,
            activeFindings: 3,
            unresolvedPatterns: 0,
            durationMs: 5
          }
        }
      });

      const rootItems = provider.getChildren();
      // First is status item, then 3 group items
      expect(rootItems).toHaveLength(4);
      expect(rootItems[0]).toBeInstanceOf(StatusTreeItem);

      const groupItems = rootItems.slice(1) as GroupTreeItem[];
      expect(groupItems.map((g) => g.groupKey)).toEqual(["error", "warning", "info"]);
      expect(groupItems.map((g) => g.label)).toEqual([
        "Errors (1)",
        "Warnings (1)",
        "Information (1)"
      ]);
      expect(groupItems[0].collapsibleState).toBe(TreeCollapsibleState.Expanded);

      // Inspect children under Errors group
      const errorFindings = provider.getChildren(groupItems[0]) as FindingTreeItem[];
      expect(errorFindings).toHaveLength(1);
      expect(errorFindings[0].finding.id).toBe("finding:1");
      expect(errorFindings[0].collapsibleState).toBe(TreeCollapsibleState.Collapsed);
    });

    it("omits empty severity groups when there are no matching findings", () => {
      const f1 = createSampleFinding("1", { severity: "warning" });

      provider = new FindingsTreeDataProvider();
      provider.handleAnalysisOutcome({
        status: "success",
        workspaceId: "ws-1" as WorkspaceId,
        result: {
          workspaceId: "ws-1" as WorkspaceId,
          generation: 1,
          generatedAt: 1700000000000,
          complete: true,
          findings: [f1],
          observations: [],
          relationships: [],
          warnings: [],
          statistics: {
            filesConsidered: 1,
            filesParsed: 1,
            filesWithWarnings: 0,
            consumerObservations: 1,
            providerObservations: 1,
            relationships: 1,
            activeFindings: 1,
            unresolvedPatterns: 0,
            durationMs: 1
          }
        }
      });

      const rootItems = provider.getChildren();
      expect(rootItems).toHaveLength(2); // status + Warnings
      expect((rootItems[1] as GroupTreeItem).groupKey).toBe("warning");
    });

    it("groups findings by category when configured or toggled", () => {
      const f1 = createSampleFinding("1", { category: "existence", title: "Route not found" });
      const f2 = createSampleFinding("2", { category: "type", title: "Type mismatch" });

      provider = new FindingsTreeDataProvider({ groupBy: "category" });
      provider.handleAnalysisOutcome({
        status: "success",
        workspaceId: "ws-1" as WorkspaceId,
        result: {
          workspaceId: "ws-1" as WorkspaceId,
          generation: 1,
          generatedAt: 1700000000000,
          complete: true,
          findings: [f1, f2],
          observations: [],
          relationships: [],
          warnings: [],
          statistics: {
            filesConsidered: 1,
            filesParsed: 1,
            filesWithWarnings: 0,
            consumerObservations: 1,
            providerObservations: 1,
            relationships: 1,
            activeFindings: 2,
            unresolvedPatterns: 0,
            durationMs: 1
          }
        }
      });

      const rootItems = provider.getChildren();
      const groupItems = rootItems.slice(1) as GroupTreeItem[];
      expect(groupItems.map((g) => g.groupKey)).toEqual(["existence", "type"]);
      expect(groupItems.map((g) => g.label)).toEqual(["Missing Endpoint (1)", "Type Mismatch (1)"]);

      // Switch grouping dynamically
      provider.setGrouping("severity");
      const severityItems = provider.getChildren().slice(1) as GroupTreeItem[];
      expect(severityItems[0].groupKey).toBe("error");
    });
  });

  describe("2. Finding representation: severity, category, evidence, and lifecycle metadata", () => {
    it("displays concise titles, rule badge, evidence class, and lifecycle event", () => {
      const f1 = createSampleFinding("abc", {
        title: "Missing POST /api/items",
        ruleId: "UND100",
        category: "existence",
        severity: "error",
        evidenceStrength: "exact",
        summary: "Frontend invokes POST /api/items but backend exposes no matching route."
      });
      const event = createSampleLifecycleEvent("finding:abc", "detected", 1700000000000);

      const item = new FindingTreeItem(f1, event);

      expect(item.label).toBe("Missing POST /api/items");
      expect(item.contextValue).toBe("undrift.finding.error");
      expect(item.description).toBe("UND100 • existence • exact • lifecycle: detected");
      expect(item.tooltip).toContain("Missing POST /api/items [UND100]");
      expect(item.tooltip).toContain("Severity: error");
      expect(item.tooltip).toContain("Category: existence");
      expect(item.tooltip).toContain("Evidence: exact");
      expect(item.tooltip).toContain("Frontend invokes POST /api/items");
      expect(item.tooltip).toContain("Lifecycle: detected");
      expect(item.command).toEqual({
        command: "undrift.openFindingLocation",
        title: "Open Location",
        arguments: [f1.sourceLocations[0]]
      });
    });

    it("presents child detail nodes: consumer/provider locations and metadata", () => {
      const f1 = createSampleFinding("xyz", {
        title: "Payload mismatch",
        ruleId: "UND200",
        evidenceStrength: "structural",
        sourceLocations: [
          {
            uri: "file:///workspace/src/client.ts" as DocumentUri,
            range: { start: 10, end: 30 },
            start: { line: 15, character: 4 },
            end: { line: 15, character: 20 }
          },
          {
            uri: "file:///workspace/src/server.ts" as DocumentUri,
            range: { start: 40, end: 60 },
            start: { line: 42, character: 8 },
            end: { line: 42, character: 35 }
          }
        ]
      });

      const item = new FindingTreeItem(f1, createSampleLifecycleEvent("finding:xyz", "changed"));
      provider = new FindingsTreeDataProvider();

      const details = provider.getChildren(item);
      expect(details).toHaveLength(5);

      // Consumer location
      const consumerLoc = details[0] as LocationTreeItem;
      expect(consumerLoc.kind).toBe("location");
      expect(consumerLoc.role).toBe("consumer");
      expect(consumerLoc.label).toBe("Consumer: client.ts:16");
      expect(consumerLoc.description).toBe("line 16, col 5");
      expect(consumerLoc.command).toBeDefined();

      // Provider location
      const providerLoc = details[1] as LocationTreeItem;
      expect(providerLoc.kind).toBe("location");
      expect(providerLoc.role).toBe("provider");
      expect(providerLoc.label).toBe("Provider: server.ts:43");
      expect(providerLoc.description).toBe("line 43, col 9");

      // Evidence metadata
      const evidenceMeta = details[2] as MetadataTreeItem;
      expect(evidenceMeta.kind).toBe("metadata");
      expect(evidenceMeta.metaKey).toBe("evidence");
      expect(evidenceMeta.label).toBe("Evidence: structural");

      // Rule metadata
      const ruleMeta = details[3] as MetadataTreeItem;
      expect(ruleMeta.kind).toBe("metadata");
      expect(ruleMeta.metaKey).toBe("rule");
      expect(ruleMeta.label).toBe("Rule: UND200");

      // Lifecycle history metadata
      const historyMeta = details[4] as MetadataTreeItem;
      expect(historyMeta.kind).toBe("metadata");
      expect(historyMeta.metaKey).toBe("history");
      expect(historyMeta.label).toBe("History: changed");
    });
  });

  describe("3. Empty-workspace, no-analysis, and zero-findings states", () => {
    it("renders empty-workspace guidance when no workspace folder is open", () => {
      provider = new FindingsTreeDataProvider();
      provider.handleSessionRestored({
        status: "no-workspace",
        seededGeneration: 0
      });

      const items = provider.getChildren();
      expect(items).toHaveLength(1);
      expect(items[0]).toBeInstanceOf(EmptyTreeItem);
      expect(items[0].label).toBe("No workspace open");
      expect(items[0].description).toBe("Open a workspace folder to detect API contract drift");
    });

    it("renders no-prior-analysis status and message when workspace has never run a scan", () => {
      provider = new FindingsTreeDataProvider();
      provider.handleSessionRestored({
        status: "no-analysis",
        workspaceId: "ws-clean" as WorkspaceId,
        seededGeneration: 0
      });

      const items = provider.getChildren();
      expect(items).toHaveLength(2);
      expect(items[0]).toBeInstanceOf(StatusTreeItem);
      expect(items[0].label).toBe("No Prior Analysis");
      expect(items[1]).toBeInstanceOf(EmptyTreeItem);
      expect(items[1].label).toBe("No analysis available");
      expect(items[1].description).toBe("Run 'UNDRIFT: Scan Workspace' to detect contract drift");
    });

    it("renders green clean state when analysis completed with zero findings", () => {
      provider = new FindingsTreeDataProvider();
      provider.handleAnalysisOutcome({
        status: "success",
        workspaceId: "ws-clean" as WorkspaceId,
        result: {
          workspaceId: "ws-clean" as WorkspaceId,
          generation: 1,
          generatedAt: 1700000000000,
          complete: true,
          findings: [],
          observations: [],
          relationships: [],
          warnings: [],
          statistics: {
            filesConsidered: 5,
            filesParsed: 5,
            filesWithWarnings: 0,
            consumerObservations: 2,
            providerObservations: 2,
            relationships: 2,
            activeFindings: 0,
            unresolvedPatterns: 0,
            durationMs: 12
          }
        }
      });

      const items = provider.getChildren();
      expect(items).toHaveLength(2);
      expect(items[0]).toBeInstanceOf(StatusTreeItem);
      expect(items[0].label).toBe("Freshly Verified Current Source");
      expect(items[1]).toBeInstanceOf(EmptyTreeItem);
      expect(items[1].label).toBe("No contract drift detected");
      expect(items[1].description).toBe("All analyzed consumer and provider contracts match");
    });
  });

  describe("4. Restored last-known snapshot state and timestamp", () => {
    it("distinguishes last-known analyzed state with restored timestamp on session restoration", () => {
      const f1 = createSampleFinding("p1");
      const snap = createSampleSnapshot("ws-restored" as WorkspaceId, 3, [
        f1 as unknown as PersistedFindingRecord
      ]);

      provider = new FindingsTreeDataProvider();
      provider.handleSessionRestored({
        status: "restored",
        workspaceId: "ws-restored" as WorkspaceId,
        snapshot: snap,
        seededGeneration: 3
      });

      const status = provider.getStatus();
      expect(status.state).toBe("last-known");
      expect(status.timestamp).toBe(new Date(snap.analyzedAt).toISOString());

      const items = provider.getChildren();
      const statusItem = items[0] as StatusTreeItem;
      expect(statusItem.label).toBe("Last Known Analyzed State");
      expect(statusItem.description).toContain("Analyzed:");
      expect(statusItem.tooltip).toContain("Showing last known analyzed state");

      // Findings from restored snapshot are accessible in groups
      const groups = items.slice(1) as GroupTreeItem[];
      expect(groups).toHaveLength(1);
      expect(groups[0].findings).toHaveLength(1);
    });
  });

  describe("5. Complete accepted analysis refreshes the tree", () => {
    it("transitions state to freshly-verified and updates findings and timestamp", () => {
      const mockCtrl = createMockCoordinator();
      provider = new FindingsTreeDataProvider({ coordinator: mockCtrl.coordinator });

      const onDidChangeSpy = vi.fn();
      provider.onDidChangeTreeData(onDidChangeSpy);

      const f1 = createSampleFinding("fresh1", { severity: "error" });
      const f2 = createSampleFinding("fresh2", { severity: "warning" });

      mockCtrl.fireAnalysisCompleted({
        status: "success",
        workspaceId: "ws-default" as WorkspaceId,
        generation: 1,
        result: {
          workspaceId: "ws-default" as WorkspaceId,
          generation: 1,
          generatedAt: 1700000005000,
          complete: true,
          findings: [f1, f2],
          observations: [],
          relationships: [],
          warnings: [],
          statistics: {
            filesConsidered: 2,
            filesParsed: 2,
            filesWithWarnings: 0,
            consumerObservations: 2,
            providerObservations: 2,
            relationships: 2,
            activeFindings: 2,
            unresolvedPatterns: 0,
            durationMs: 10
          }
        }
      });

      expect(onDidChangeSpy).toHaveBeenCalled();

      const status = provider.getStatus();
      expect(status.state).toBe("freshly-verified");
      expect(status.timestamp).toBe(new Date(1700000005000).toISOString());

      const items = provider.getChildren();
      const statusItem = items[0] as StatusTreeItem;
      expect(statusItem.label).toBe("Freshly Verified Current Source");

      const groups = items.slice(1) as GroupTreeItem[];
      expect(groups).toHaveLength(2);
      expect(groups.map((g) => g.groupKey)).toEqual(["error", "warning"]);
    });
  });

  describe("6. Incomplete analysis preserves last known complete findings", () => {
    it("preserves last known complete findings and timestamp without false resolutions", () => {
      // 1. Initial complete state with 2 findings
      const f1 = createSampleFinding("f1", { severity: "error" });
      const f2 = createSampleFinding("f2", { severity: "warning" });
      const snap = createSampleSnapshot("ws-inc" as WorkspaceId, 1, [
        f1 as unknown as PersistedFindingRecord,
        f2 as unknown as PersistedFindingRecord
      ]);

      const mockCtrl = createMockCoordinator("ws-inc" as WorkspaceId, snap);
      provider = new FindingsTreeDataProvider({ coordinator: mockCtrl.coordinator });

      // Verify baseline last-known state
      expect(provider.getStatus().state).toBe("last-known");
      expect(provider.getFindings()).toHaveLength(2);

      // 2. Fire an incomplete scan outcome
      mockCtrl.fireAnalysisCompleted({
        status: "incomplete",
        workspaceId: "ws-inc" as WorkspaceId,
        generation: 2,
        failures: [{ uri: "file:///workspace/unreadable.ts" as DocumentUri, reason: "EACCES" }],
        totalAcquired: 1,
        result: {
          workspaceId: "ws-inc" as WorkspaceId,
          generation: 2,
          generatedAt: 1700000002000,
          complete: false,
          findings: [f1], // partial result missing f2
          observations: [],
          relationships: [],
          warnings: [],
          statistics: {
            filesConsidered: 1,
            filesParsed: 1,
            filesWithWarnings: 0,
            consumerObservations: 1,
            providerObservations: 1,
            relationships: 1,
            activeFindings: 1,
            unresolvedPatterns: 0,
            durationMs: 5
          }
        }
      });

      // Verification: Status indicates incomplete coverage
      const status = provider.getStatus();
      expect(status.state).toBe("analysis-incomplete");
      expect(status.message).toContain("Coverage incomplete");

      // CRITICAL SAFETY CHECK: Both f1 AND f2 are preserved!
      // Incomplete analysis must not drop f2 or claim it was resolved!
      const activeFindings = provider.getFindings();
      expect(activeFindings).toHaveLength(2);
      expect(activeFindings.map((f) => f.id)).toEqual(["finding:f1", "finding:f2"]);

      // Status tree item communicates retained state
      const items = provider.getChildren();
      const statusItem = items[0] as StatusTreeItem;
      expect(statusItem.label).toBe("Analysis Incomplete");
      expect(statusItem.description).toContain("Retaining last state");
    });
  });

  describe("7. Failed, cancelled, and superseded results cannot replace tree state", () => {
    it("retains last known complete findings when analysis fails", () => {
      const f1 = createSampleFinding("f1");
      const snap = createSampleSnapshot("ws-fail" as WorkspaceId, 1, [
        f1 as unknown as PersistedFindingRecord
      ]);
      const mockCtrl = createMockCoordinator("ws-fail" as WorkspaceId, snap);
      provider = new FindingsTreeDataProvider({ coordinator: mockCtrl.coordinator });

      mockCtrl.fireAnalysisCompleted({
        status: "failed",
        workspaceId: "ws-fail" as WorkspaceId,
        errorMessage: "AST parser crashed"
      });

      expect(provider.getStatus().state).toBe("analysis-failed");
      expect(provider.getStatus().message).toBe("AST parser crashed");
      expect(provider.getFindings()).toHaveLength(1);
    });

    it("retains last known complete findings when analysis is cancelled", () => {
      const f1 = createSampleFinding("f1");
      const snap = createSampleSnapshot("ws-cancel" as WorkspaceId, 1, [
        f1 as unknown as PersistedFindingRecord
      ]);
      const mockCtrl = createMockCoordinator("ws-cancel" as WorkspaceId, snap);
      provider = new FindingsTreeDataProvider({ coordinator: mockCtrl.coordinator });

      mockCtrl.fireAnalysisCompleted({
        status: "cancelled",
        workspaceId: "ws-cancel" as WorkspaceId
      });

      expect(provider.getStatus().state).toBe("analysis-cancelled");
      expect(provider.getFindings()).toHaveLength(1);
    });

    it("completely ignores superseded analysis outcomes without modifying tree state", () => {
      const f1 = createSampleFinding("f1");
      const snap = createSampleSnapshot("ws-super" as WorkspaceId, 1, [
        f1 as unknown as PersistedFindingRecord
      ]);
      const mockCtrl = createMockCoordinator("ws-super" as WorkspaceId, snap);
      provider = new FindingsTreeDataProvider({ coordinator: mockCtrl.coordinator });

      const onDidChangeSpy = vi.fn();
      provider.onDidChangeTreeData(onDidChangeSpy);

      mockCtrl.fireAnalysisCompleted({
        status: "superseded",
        workspaceId: "ws-super" as WorkspaceId
      });

      expect(onDidChangeSpy).not.toHaveBeenCalled();
      expect(provider.getStatus().state).toBe("last-known");
      expect(provider.getFindings()).toHaveLength(1);
    });
  });

  describe("8. Stale-result prevention for late-finishing obsolete scans", () => {
    it("ignores late-finishing obsolete scan outcomes to prevent stale findings", () => {
      const mockCtrl = createMockCoordinator("ws-order" as WorkspaceId);
      provider = new FindingsTreeDataProvider({ coordinator: mockCtrl.coordinator });

      // Scan 2 completes first (accepted)
      const freshFinding = createSampleFinding("scan2-finding");
      mockCtrl.fireAnalysisCompleted({
        status: "success",
        workspaceId: "ws-order" as WorkspaceId,
        generation: 2,
        result: {
          workspaceId: "ws-order" as WorkspaceId,
          generation: 2,
          generatedAt: 2000,
          complete: true,
          findings: [freshFinding],
          observations: [],
          relationships: [],
          warnings: [],
          statistics: {
            filesConsidered: 1,
            filesParsed: 1,
            filesWithWarnings: 0,
            consumerObservations: 1,
            providerObservations: 1,
            relationships: 1,
            activeFindings: 1,
            unresolvedPatterns: 0,
            durationMs: 1
          }
        }
      });

      expect(provider.getFindings()[0].id).toBe("finding:scan2-finding");

      // Scan 1 finishes late and is classified as superseded
      mockCtrl.fireAnalysisCompleted({
        status: "superseded",
        workspaceId: "ws-order" as WorkspaceId,
        generation: 1
      });

      // Tree state remains locked to Scan 2
      expect(provider.getFindings()[0].id).toBe("finding:scan2-finding");
      expect(provider.getStatus().state).toBe("freshly-verified");
    });
  });

  describe("9. Lifecycle history association and latest-event selection", () => {
    it("selects the latest lifecycle transition event for each finding", () => {
      const f1 = createSampleFinding("f-life");
      const snap = createSampleSnapshot("ws-life" as WorkspaceId, 2, [
        f1 as unknown as PersistedFindingRecord
      ]);
      const history = [
        createSampleLifecycleEvent("finding:f-life", "detected", 1000),
        createSampleLifecycleEvent("finding:f-life", "changed", 2000),
        createSampleLifecycleEvent("finding:other", "detected", 1500)
      ];

      const mockCtrl = createMockCoordinator("ws-life" as WorkspaceId, snap, history);
      provider = new FindingsTreeDataProvider({ coordinator: mockCtrl.coordinator });

      const rootItems = provider.getChildren();
      const groupItem = rootItems[1] as GroupTreeItem;
      const findingItems = provider.getChildren(groupItem) as FindingTreeItem[];

      expect(findingItems).toHaveLength(1);
      expect(findingItems[0].latestLifecycleEvent?.transitionKind).toBe("changed");
      expect(findingItems[0].latestLifecycleEvent?.observedAt).toBe(2000);
      expect(findingItems[0].description).toContain("lifecycle: changed");
    });
  });

  describe("10. Multi-workspace isolation", () => {
    it("maintains isolated findings and verification states across workspaces", () => {
      provider = new FindingsTreeDataProvider();

      const fA = createSampleFinding("A", { title: "Finding in Workspace A" });
      const fB = createSampleFinding("B", { title: "Finding in Workspace B" });

      // Workspace A has freshly verified findings
      provider.handleAnalysisOutcome({
        status: "success",
        workspaceId: "ws-A" as WorkspaceId,
        result: {
          workspaceId: "ws-A" as WorkspaceId,
          generation: 1,
          generatedAt: 1000,
          complete: true,
          findings: [fA],
          observations: [],
          relationships: [],
          warnings: [],
          statistics: {
            filesConsidered: 1,
            filesParsed: 1,
            filesWithWarnings: 0,
            consumerObservations: 1,
            providerObservations: 1,
            relationships: 1,
            activeFindings: 1,
            unresolvedPatterns: 0,
            durationMs: 1
          }
        }
      });

      // Workspace B has restored findings
      provider.handleSessionRestored({
        status: "restored",
        workspaceId: "ws-B" as WorkspaceId,
        snapshot: createSampleSnapshot("ws-B" as WorkspaceId, 1, [
          fB as unknown as PersistedFindingRecord
        ]),
        seededGeneration: 1
      });

      // Currently active is ws-B (most recent)
      expect(provider.getActiveWorkspaceId()).toBe("ws-B");
      expect(provider.getFindings()).toEqual([fB]);
      expect(provider.getStatus().state).toBe("last-known");

      // Switch to ws-A
      provider.setActiveWorkspaceId("ws-A" as WorkspaceId);
      expect(provider.getActiveWorkspaceId()).toBe("ws-A");
      expect(provider.getFindings()).toEqual([fA]);
      expect(provider.getStatus().state).toBe("freshly-verified");

      // Workspace A findings must never leak into Workspace B
      expect(provider.getFindings("ws-B" as WorkspaceId)).toEqual([fB]);
    });
  });

  describe("11. Refresh mechanism and listener deduplication", () => {
    it("fires onDidChangeTreeData without accumulating duplicate listeners", () => {
      provider = new FindingsTreeDataProvider();
      const fireSpy = vi.fn();
      const sub = provider.onDidChangeTreeData(fireSpy);

      provider.refresh();
      expect(fireSpy).toHaveBeenCalledTimes(1);

      provider.refresh();
      expect(fireSpy).toHaveBeenCalledTimes(2);

      sub.dispose();
      provider.refresh();
      expect(fireSpy).toHaveBeenCalledTimes(2); // no longer called after unsubscribe
    });

    it("re-setting coordinator disposes previous subscription cleanly", () => {
      const ctrl1 = createMockCoordinator("ws-1" as WorkspaceId);
      const ctrl2 = createMockCoordinator("ws-2" as WorkspaceId);

      provider = new FindingsTreeDataProvider({ coordinator: ctrl1.coordinator });
      expect(ctrl1.listenersCount()).toBe(1);

      provider.setCoordinator(ctrl2.coordinator);
      expect(ctrl1.listenersCount()).toBe(0); // old subscription disposed
      expect(ctrl2.listenersCount()).toBe(1); // new subscription active
    });
  });

  describe("12. Disposal and resource cleanup", () => {
    it("cleans up all subscriptions and enters disposed state safely", () => {
      const mockCtrl = createMockCoordinator();
      provider = new FindingsTreeDataProvider({ coordinator: mockCtrl.coordinator });

      expect(mockCtrl.listenersCount()).toBe(1);
      expect(provider.isDisposed).toBe(false);

      provider.dispose();
      expect(provider.isDisposed).toBe(true);
      expect(mockCtrl.listenersCount()).toBe(0);

      // Safe no-ops after disposal
      provider.refresh();
      expect(provider.getChildren()).toEqual([]);
      provider.handleAnalysisOutcome({
        status: "success",
        workspaceId: "ws-1" as WorkspaceId
      });
      expect(provider.getFindings()).toEqual([]);
    });
  });

  describe("13. Navigation command: openFindingLocation", () => {
    it("opens document and sets editor selection to the source span range", async () => {
      const span: SourceSpan = {
        uri: "file:///workspace/src/app.ts" as DocumentUri,
        range: { start: 10, end: 30 },
        start: { line: 12, character: 4 },
        end: { line: 12, character: 25 }
      };

      await openFindingLocation(span, mockVsCodeModule as unknown as typeof import("vscode"));

      expect(mockVsCodeModule.workspace.openTextDocument).toHaveBeenCalledWith(
        expect.objectContaining({ path: expect.stringContaining("app.ts") })
      );
      expect(mockVsCodeModule.window.showTextDocument).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          selection: expect.objectContaining({
            start: expect.objectContaining({ line: 12, character: 4 }),
            end: expect.objectContaining({ line: 12, character: 25 })
          })
        })
      );
    });

    it("gracefully no-ops when span or URI is missing", async () => {
      await expect(
        openFindingLocation(undefined, mockVsCodeModule as unknown as typeof import("vscode"))
      ).resolves.toBeUndefined();
      await expect(
        openFindingLocation(
          { uri: "" as DocumentUri } as SourceSpan,
          mockVsCodeModule as unknown as typeof import("vscode")
        )
      ).resolves.toBeUndefined();
    });
  });
});
