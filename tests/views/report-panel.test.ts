// Comprehensive test suite for UNDRIFT Integration Report and Finding Details experience (ReportPanelManager)
// strictly adhering to LLD.md Sections 14.3, 14.5, 14.6, 14.8, 14.9, and Chunk 4.7 specification.

import Module from "module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AnalysisCoverageSummary,
  AnalysisResult,
  AnalysisSnapshot,
  AnalysisWarning,
  DocumentUri,
  Finding,
  FindingCategory,
  FindingId,
  FindingLifecycleEvent,
  FindingLifecycleTransition,
  FindingSeverity,
  FixProposal,
  FixProposalId,
  PersistedFindingRecord,
  ReconciliationResult,
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
  escapeHtml,
  formatContractValue,
  formatTimestamp,
  openFindingLocation,
  renderReportHtml,
  ReportPanelManager,
  type ReportViewModel
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

  class MockWebview {
    public html = "";
    public messageListeners: ((msg: unknown) => void)[] = [];

    public onDidReceiveMessage(listener: (msg: unknown) => void) {
      this.messageListeners.push(listener);
      return {
        dispose: () => {
          this.messageListeners = this.messageListeners.filter((l) => l !== listener);
        }
      };
    }

    public postMessage = vi.fn().mockResolvedValue(true);

    public emitMessage(msg: unknown): void {
      for (const l of [...this.messageListeners]) {
        try {
          l(msg);
        } catch {
          // ignore
        }
      }
    }
  }

  class MockWebviewPanel {
    public webview = new MockWebview();
    public disposeListeners: (() => void)[] = [];
    public visible = true;
    public viewColumn = 1;

    constructor(
      public readonly viewType: string,
      public title: string,
      public readonly showOptions: unknown,
      public readonly options: unknown
    ) {}

    public reveal(column?: number): void {
      this.visible = true;
      if (column !== undefined) {
        this.viewColumn = column;
      }
    }

    public onDidDispose(listener: () => void) {
      this.disposeListeners.push(listener);
      return {
        dispose: () => {
          this.disposeListeners = this.disposeListeners.filter((l) => l !== listener);
        }
      };
    }

    public dispose(): void {
      this.visible = false;
      for (const l of [...this.disposeListeners]) {
        try {
          l();
        } catch {
          // ignore
        }
      }
      this.disposeListeners = [];
    }
  }

  let createdPanel: MockWebviewPanel | undefined;

  const mockVsCodeModule = {
    Position: MockPosition,
    Range: MockRange,
    Uri: MockUri,
    ThemeIcon: MockThemeIcon,
    ThemeColor: MockThemeColor,
    TreeItem: MockTreeItem,
    TreeItemCollapsibleState: MockTreeItemCollapsibleState,
    ViewColumn: {
      One: 1,
      Two: 2
    },
    window: {
      createWebviewPanel: vi.fn((viewType, title, showOptions, options) => {
        createdPanel = new MockWebviewPanel(viewType, title, showOptions, options);
        return createdPanel;
      }),
      showTextDocument: vi.fn().mockResolvedValue({}),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn()
    },
    workspace: {
      openTextDocument: vi.fn().mockResolvedValue({ uri: MockUri.file("/test/app.ts") })
    },
    commands: {
      registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      executeCommand: vi.fn()
    },
    getLastCreatedPanel: () => createdPanel,
    resetCreatedPanel: () => {
      createdPanel = undefined;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const originalRequire = (Module as any).prototype.require;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(Module as any).prototype.require = function (id: string, ...args: any[]) {
  if (id === "vscode") {
    return mockVsCodeModule;
  }
  return originalRequire.call(this, id, ...args);
};

// Fixture helpers
function createSampleFinding(id: string, overrides?: Partial<Finding>): Finding {
  return {
    id: `finding:${id}`,
    ruleId: "UND200",
    category: "request-shape",
    severity: "error",
    state: "active",
    title: `Sample finding ${id}`,
    summary: `Summary of finding ${id}`,
    explanation: `Full explanation of finding ${id}`,
    impactStatement: `Frontend request will fail with 400 Bad Request`,
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
    expected: { type: "object", properties: { id: "string" } },
    observed: { type: "object", properties: { id: "number" } },
    limitations: [],
    observationIds: [],
    fixProposalIds: [],
    ...overrides
  };
}

function createSampleRecord(
  id: string,
  overrides?: Partial<PersistedFindingRecord>
): PersistedFindingRecord {
  return {
    id: `finding:${id}`,
    ruleId: "UND100",
    category: "existence",
    severity: "warning",
    state: "active",
    title: `Persisted finding ${id}`,
    summary: `Persisted summary ${id}`,
    evidenceStrength: "high",
    sourceLocations: [
      {
        uri: "file:///workspace/src/client.ts" as DocumentUri,
        range: { start: 20, end: 60 },
        start: { line: 10, character: 1 },
        end: { line: 10, character: 25 }
      }
    ],
    limitations: [],
    ...overrides
  };
}

function createSampleLifecycleEvent(
  findingId: string,
  transitionKind: FindingLifecycleTransition,
  observedAt: number,
  overrides?: Partial<FindingLifecycleEvent>
): FindingLifecycleEvent {
  return {
    eventId: `evt:${findingId}:${transitionKind}:${observedAt}`,
    workspaceId: "/workspace/app" as WorkspaceId,
    findingId: findingId as FindingId,
    transitionKind,
    observedAt,
    triggerGeneration: 1,
    newState: "active",
    context: {
      reason: "Detected during workspace scan",
      newSeverity: "error",
      newSummary: `Active issue ${findingId}`
    },
    ...overrides
  };
}

describe("Chunk 4.7: Integration Report & Finding Details", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVsCodeModule.resetCreatedPanel();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("A. HTML Rendering Utilities & Presentation Models", () => {
    it("safely escapes HTML in untrusted repository inputs", () => {
      expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(escapeHtml("foo \"bar\" & 'baz' <qux>")).toBe(
        "foo &quot;bar&quot; &amp; &#39;baz&#39; &lt;qux&gt;"
      );
      expect(escapeHtml("")).toBe("");
      expect(escapeHtml(undefined as unknown as string)).toBe("");
    });

    it("formats timestamps gracefully handling valid and invalid inputs", () => {
      const valid = formatTimestamp("2026-10-23T04:10:00.000Z");
      expect(valid).toContain("2026");

      expect(formatTimestamp(undefined)).toBe("unknown time");
      expect(formatTimestamp("not-a-date")).toBe("not-a-date");
    });

    it("formats expected and observed contract values honestly without dumping internal garbage", () => {
      expect(formatContractValue(undefined)).toBe("");
      expect(formatContractValue(null)).toBe("");
      expect(formatContractValue("string")).toBe("string");
      expect(formatContractValue(123)).toBe("123");

      const formattedJson = formatContractValue({ id: "string", nested: { count: 42 } });
      expect(formattedJson).toContain("&quot;id&quot;: &quot;string&quot;");
      expect(formattedJson).toContain("&quot;count&quot;: 42");

      // XSS inside values is escaped
      const malicious = formatContractValue({ payload: "<img src=x onerror=alert(1)>" });
      expect(malicious).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(malicious).not.toContain("<img");
    });

    it("renders restrictive Content Security Policy in generated webview HTML", () => {
      const model: ReportViewModel = {
        workspaceId: "test-workspace",
        status: "no-analysis",
        findings: [],
        history: [],
        warnings: []
      };

      const html = renderReportHtml(model, "test-nonce-12345");
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("default-src 'none'");
      expect(html).toContain("script-src 'nonce-test-nonce-12345'");
      expect(html).toContain("style-src 'unsafe-inline'");
      expect(html).toContain('nonce="test-nonce-12345"');
    });

    it("renders verification status badges correctly for each state", () => {
      // 1. no-workspace
      const noWsHtml = renderReportHtml({
        workspaceId: "no-workspace",
        status: "no-workspace",
        findings: [],
        history: [],
        warnings: []
      });
      expect(noWsHtml).toContain("No Workspace Open");
      expect(noWsHtml).toContain("Open a workspace folder in VS Code to detect API contract drift");

      // 2. no-analysis
      const noAnalysisHtml = renderReportHtml({
        workspaceId: "/test/ws",
        status: "no-analysis",
        findings: [],
        history: [],
        warnings: []
      });
      expect(noAnalysisHtml).toContain("No Prior Analysis");
      expect(noAnalysisHtml).toContain(
        "UNDRIFT has not run contract verification for this workspace yet."
      );

      // 3. last-known
      const lastKnownHtml = renderReportHtml({
        workspaceId: "/test/ws",
        status: "last-known",
        timestamp: "2026-10-23T04:00:00.000Z",
        findings: [],
        history: [],
        warnings: []
      });
      expect(lastKnownHtml).toContain("Last Known Analyzed State");
      expect(lastKnownHtml).toContain("Showing Last Known Analyzed State:");

      // 4. freshly-verified
      const verifiedHtml = renderReportHtml({
        workspaceId: "/test/ws",
        status: "freshly-verified",
        timestamp: "2026-10-23T04:15:00.000Z",
        findings: [],
        history: [],
        warnings: []
      });
      expect(verifiedHtml).toContain("Freshly Verified Current Source");
      expect(verifiedHtml).not.toContain("Showing Last Known Analyzed State:");

      // 5. analysis-incomplete
      const incompleteHtml = renderReportHtml({
        workspaceId: "/test/ws",
        status: "analysis-incomplete",
        findings: [],
        history: [],
        warnings: [
          {
            code: "PARSE_ERROR",
            message: "Syntax error encountered in server.ts",
            affectsCompleteness: true
          }
        ]
      });
      expect(incompleteHtml).toContain("Analysis Incomplete");
      expect(incompleteHtml).toContain("Coverage Incomplete:");
      expect(incompleteHtml).toContain("Syntax error encountered in server.ts");

      // 6. analysis-failed
      const failedHtml = renderReportHtml({
        workspaceId: "/test/ws",
        status: "analysis-failed",
        findings: [],
        history: [],
        warnings: []
      });
      expect(failedHtml).toContain("Analysis Failed");

      // 7. analysis-cancelled
      const cancelledHtml = renderReportHtml({
        workspaceId: "/test/ws",
        status: "analysis-cancelled",
        findings: [],
        history: [],
        warnings: []
      });
      expect(cancelledHtml).toContain("Analysis Cancelled");
    });

    it("renders zero-findings clean contract state when findings are empty", () => {
      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        timestamp: "2026-10-23T04:15:00.000Z",
        findings: [],
        history: [],
        warnings: []
      });

      expect(html).toContain('<span class="metric-value">0</span>');
      expect(html).toContain("No Contract Drift Detected:");
      expect(html).toContain(
        "All analyzed frontend consumer API calls match backend provider routes and schemas."
      );
    });

    it("renders summary counters and severity/category breakdown", () => {
      const findings = [
        createSampleFinding("1", { severity: "error", category: "request-shape" }),
        createSampleFinding("2", { severity: "error", category: "response-shape" }),
        createSampleFinding("3", { severity: "warning", category: "route" }),
        createSampleFinding("4", { severity: "info", category: "type" })
      ];

      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        timestamp: "2026-10-23T04:15:00.000Z",
        findings,
        history: [],
        warnings: []
      });

      expect(html).toContain('<span class="metric-value">4</span>');
      expect(html).toContain('<span class="metric-label">Active Drift Findings</span>');
      expect(html).toContain('<span class="metric-label">Errors</span>');
      expect(html).toContain('<span class="metric-label">Warnings</span>');
      expect(html).toContain('<span class="metric-label">Information</span>');
      expect(html).toContain("Request Shape:");
      expect(html).toContain("Response Shape:");
      expect(html).toContain("Route Parameter:");
      expect(html).toContain("Type Mismatch:");
    });

    it("renders full finding details honestly without fabricating missing fields", () => {
      const f1 = createSampleFinding("drift-1", {
        title: "GET /api/users request param drift",
        ruleId: "UND200",
        category: "request-shape",
        severity: "error",
        evidenceStrength: "exact",
        summary: "Consumer sends id as string but provider requires number",
        explanation:
          "The query parameter 'id' type diverges between fetch call and Express validator.",
        impactStatement: "Request rejected at runtime with validation HTTP 400 error.",
        expected: { id: "number" },
        observed: { id: "string" },
        limitations: [
          {
            code: "DYNAMIC_ROUTE",
            message: "Provider route uses dynamic regex",
            affectsCompleteness: false
          }
        ]
      });

      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        findings: [f1],
        history: [],
        warnings: []
      });

      expect(html).toContain("GET /api/users request param drift");
      expect(html).toContain("UND200");
      expect(html).toContain("request-shape");
      expect(html).toContain("Evidence: exact");
      expect(html).toContain("Consumer sends id as string but provider requires number");
      expect(html).toContain(
        "The query parameter &#39;id&#39; type diverges between fetch call and Express validator."
      );
      expect(html).toContain(
        "Impact:</strong> Request rejected at runtime with validation HTTP 400 error."
      );
      expect(html).toContain("Expected Contract");
      expect(html).toContain("Observed Contract");
      expect(html).toContain("Known Limitations:");
      expect(html).toContain("[DYNAMIC_ROUTE] Provider route uses dynamic regex");
      expect(html).toContain("Consumer");
      expect(html).toContain("Provider");
      expect(html).toContain("consumer.ts:6:3");
      expect(html).toContain("provider.ts:13:5");
    });

    it("does not fabricate expected or observed comparison boxes when contract values are undefined", () => {
      const fWithoutComparison = createSampleRecord("no-values", {
        title: "Endpoint missing provider",
        ruleId: "UND100",
        expected: undefined,
        observed: undefined
      });

      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        findings: [fWithoutComparison],
        history: [],
        warnings: []
      });

      expect(html).toContain("Endpoint missing provider");
      expect(html).not.toContain("Expected Contract");
      expect(html).not.toContain("Observed Contract");
      expect(html).not.toContain('<div class="comparison-box">');
    });

    it("renders lifecycle event history deterministically with context deltas and analysis-time disclaimer", () => {
      const findingId = "finding:lifecycle-test";
      const events: FindingLifecycleEvent[] = [
        createSampleLifecycleEvent(findingId, "detected", 1000, {
          triggerGeneration: 1,
          context: {
            reason: "Initial scan detection",
            newSeverity: "error",
            newSummary: "First seen"
          }
        }),
        createSampleLifecycleEvent(findingId, "changed", 2000, {
          triggerGeneration: 2,
          context: {
            reason: "Modified in commit 2",
            previousSeverity: "error",
            newSeverity: "warning",
            previousSummary: "First seen",
            newSummary: "Updated warning summary"
          }
        }),
        createSampleLifecycleEvent(findingId, "resolved", 3000, {
          triggerGeneration: 3,
          context: { reason: "Provider updated to match consumer" }
        }),
        createSampleLifecycleEvent(findingId, "reintroduced", 4000, {
          triggerGeneration: 4,
          context: { reason: "Consumer reverted contract change", newSeverity: "error" }
        })
      ];

      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        findings: [createSampleFinding("lifecycle-test", { id: findingId as FindingId })],
        history: events,
        warnings: []
      });

      expect(html).toContain("Lifecycle History");
      expect(html).toContain("detected");
      expect(html).toContain("changed");
      expect(html).toContain("resolved");
      expect(html).toContain("reintroduced");
      expect(html).toContain("Initial scan detection");
      expect(html).toContain("Modified in commit 2");
      expect(html).toContain("Provider updated to match consumer");
      expect(html).toContain("Consumer reverted contract change");
      expect(html).toContain("severity: error &rarr; warning");
      expect(html).toContain(
        "Historical references reflect code at analysis time; source locations and contents may have changed."
      );
    });

    it("prevents XSS by properly escaping malicious inputs across all finding fields", () => {
      const maliciousFinding = createSampleFinding("xss", {
        title: "<script>alert('title-xss')</script>",
        ruleId: "UND100<script>evil()</script>" as unknown as RuleId,
        category: "drift<img src=x onerror=alert(1)>" as unknown as FindingCategory,
        summary: "<b>malicious summary</b>",
        explanation: "<style>body{display:none}</style>",
        impactStatement: "<svg onload=alert(2)>",
        limitations: [
          {
            code: "INCOMPLETE_SCOPE",
            message: "<iframe src='evil.com'></iframe>",
            affectsCompleteness: false
          }
        ],
        expected: { "<evil>": "payload" },
        observed: ["<script>hack()</script>"]
      });

      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        findings: [maliciousFinding],
        history: [],
        warnings: []
      });

      expect(html).not.toContain("<script>alert('title-xss')</script>");
      expect(html).toContain("&lt;script&gt;alert(&#39;title-xss&#39;)&lt;/script&gt;");

      expect(html).not.toContain("<script>evil()</script>");
      expect(html).toContain("&lt;script&gt;evil()&lt;/script&gt;");

      expect(html).not.toContain("<img src=x onerror=alert(1)>");
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");

      expect(html).not.toContain("<b>malicious summary</b>");
      expect(html).toContain("&lt;b&gt;malicious summary&lt;/b&gt;");

      expect(html).not.toContain("<style>body{display:none}</style>");
      expect(html).toContain("&lt;style&gt;body{display:none}&lt;/style&gt;");

      expect(html).not.toContain("<svg onload=alert(2)>");
      expect(html).toContain("&lt;svg onload=alert(2)&gt;");

      expect(html).not.toContain("<iframe src='evil.com'></iframe>");
      expect(html).toContain("&lt;iframe src=&#39;evil.com&#39;&gt;&lt;/iframe&gt;");

      expect(html).not.toContain("<script>hack()</script>");
      expect(html).toContain("&lt;script&gt;hack()&lt;/script&gt;");
    });

    it("highlights target finding card when targetFindingId is specified", () => {
      const f1 = createSampleFinding("1");
      const f2 = createSampleFinding("2");

      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        findings: [f1, f2],
        history: [],
        warnings: [],
        targetFindingId: "finding:2"
      });

      expect(html).toContain('id="finding-finding:2"');
      expect(html).toContain("target-highlight");
    });
  });

  interface TestCoordinator extends AnalysisCoordinator {
    _emitOutcome(outcome: CoordinatorAnalysisResult): void;
  }

  function createMockCoordinator(overrides?: Partial<AnalysisCoordinator>): TestCoordinator {
    const listeners: ((res: CoordinatorAnalysisResult) => void)[] = [];
    const mockScheduler = {
      runImmediateScan: vi.fn().mockResolvedValue({ status: "success" }),
      scheduleScan: vi.fn()
    };

    return {
      getActiveWorkspaceId: vi.fn().mockReturnValue("/workspace/app" as WorkspaceId),
      getLastKnownSnapshot: vi.fn().mockReturnValue(undefined),
      getLastKnownHistory: vi.fn().mockReturnValue([]),
      onAnalysisCompleted: vi.fn((listener) => {
        listeners.push(listener);
        return {
          dispose: () => {
            const idx = listeners.indexOf(listener);
            if (idx !== -1) listeners.splice(idx, 1);
          }
        };
      }),
      getScheduler: vi.fn().mockReturnValue(mockScheduler),
      // Helper for test to emit outcomes
      _emitOutcome: (outcome: CoordinatorAnalysisResult) => {
        for (const l of [...listeners]) {
          l(outcome);
        }
      },
      ...overrides
    } as unknown as TestCoordinator;
  }

  describe("B. ReportPanelManager Coordinator Integration & Acceptance Boundaries", () => {
    it("initializes without crash when coordinator has no snapshot (no-analysis state)", () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      const state = manager.getState("/workspace/app" as WorkspaceId);
      expect(state).toBeDefined();
      expect(state?.status).toBe("no-analysis");
      expect(state?.findings).toEqual([]);

      manager.dispose();
    });

    it("initializes from coordinator's existing snapshot as 'last-known' with original timestamp", () => {
      const sampleSnap: AnalysisSnapshot = {
        workspaceId: "/workspace/app" as WorkspaceId,
        analyzedAt: 1729650000000,
        generation: 1,
        findings: [createSampleRecord("persisted-1")],
        coverage: {
          complete: true,
          filesScanned: 10,
          filesWithWarnings: 0,
          unresolvedPatterns: 0,
          warnings: []
        }
      };

      const coordinator = createMockCoordinator({
        getLastKnownSnapshot: vi.fn().mockReturnValue(sampleSnap),
        getLastKnownHistory: vi
          .fn()
          .mockReturnValue([
            createSampleLifecycleEvent("finding:persisted-1", "detected", 1729650000000)
          ])
      });

      const manager = new ReportPanelManager(coordinator);
      const state = manager.getState("/workspace/app" as WorkspaceId);

      expect(state?.status).toBe("last-known");
      expect(state?.timestamp).toBe(new Date(1729650000000).toISOString());
      expect(state?.findings).toHaveLength(1);
      expect(state?.findings[0].id).toBe("finding:persisted-1");
      expect(state?.history).toHaveLength(1);

      manager.dispose();
    });

    it("updates report state to 'freshly-verified' when coordinator accepts complete analysis", () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      const findings = [createSampleFinding("fresh-1")];
      const outcome: CoordinatorAnalysisResult = {
        status: "success",
        workspaceId: "/workspace/app" as WorkspaceId,
        generation: 2,
        result: {
          workspaceId: "/workspace/app" as WorkspaceId,
          findings,
          warnings: [],
          generatedAt: 1729655000000,
          complete: true
        } as unknown as AnalysisResult,
        reconciliation: {
          currentSnapshot: {
            workspaceId: "/workspace/app" as WorkspaceId,
            analyzedAt: 1729655000000,
            generation: 2,
            findings: findings as unknown as readonly PersistedFindingRecord[],
            coverage: {
              complete: true,
              filesScanned: 5,
              filesWithWarnings: 0,
              unresolvedPatterns: 0,
              warnings: []
            }
          }
        } as unknown as ReconciliationResult
      };

      coordinator._emitOutcome(outcome);

      const state = manager.getState("/workspace/app" as WorkspaceId);
      expect(state?.status).toBe("freshly-verified");
      expect(state?.timestamp).toBe(new Date(1729655000000).toISOString());
      expect(state?.findings).toHaveLength(1);
      expect(state?.findings[0].id).toBe("finding:fresh-1");

      manager.dispose();
    });

    it("retains last known complete findings when subsequent analysis is incomplete", () => {
      const initialFinding = createSampleFinding("known-1");
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      // 1. Initial successful complete run
      coordinator._emitOutcome({
        status: "success",
        workspaceId: "/workspace/app" as WorkspaceId,
        generation: 1,
        result: {
          workspaceId: "/workspace/app" as WorkspaceId,
          findings: [initialFinding],
          warnings: [],
          generatedAt: 1000,
          complete: true
        }
      });

      expect(manager.getState("/workspace/app" as WorkspaceId)?.status).toBe("freshly-verified");
      expect(manager.getState("/workspace/app" as WorkspaceId)?.findings).toHaveLength(1);

      // 2. Incomplete run occurs (e.g. parse error)
      const warning: AnalysisWarning = {
        code: "PARSE_ERROR",
        message: "File has parse error",
        affectsCompleteness: true
      };
      coordinator._emitOutcome({
        status: "incomplete",
        workspaceId: "/workspace/app" as WorkspaceId,
        generation: 2,
        result: {
          workspaceId: "/workspace/app" as WorkspaceId,
          findings: [], // empty incomplete findings must not overwrite
          warnings: [warning],
          generatedAt: 2000,
          complete: false
        }
      });

      const state = manager.getState("/workspace/app" as WorkspaceId);
      expect(state?.status).toBe("analysis-incomplete");
      // Retains previous findings!
      expect(state?.findings).toHaveLength(1);
      expect(state?.findings[0].id).toBe("finding:known-1");
      // Records incomplete warnings
      expect(state?.warnings).toHaveLength(1);
      expect(state?.warnings[0].code).toBe("PARSE_ERROR");

      manager.dispose();
    });

    it("does NOT overwrite verified findings when analysis is superseded, cancelled, or failed", () => {
      const verifiedFinding = createSampleFinding("verified-1");
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      // 1. Initial verified state
      coordinator._emitOutcome({
        status: "success",
        workspaceId: "/workspace/app" as WorkspaceId,
        generation: 1,
        result: {
          workspaceId: "/workspace/app" as WorkspaceId,
          findings: [verifiedFinding],
          warnings: [],
          generatedAt: 1000,
          complete: true
        }
      });

      // 2. Superseded outcome arrives
      coordinator._emitOutcome({
        status: "superseded",
        workspaceId: "/workspace/app" as WorkspaceId,
        generation: 2
      });

      // State is untouched
      let state = manager.getState("/workspace/app" as WorkspaceId);
      expect(state?.status).toBe("freshly-verified");
      expect(state?.findings).toHaveLength(1);

      // 3. Cancelled outcome arrives
      coordinator._emitOutcome({
        status: "cancelled",
        workspaceId: "/workspace/app" as WorkspaceId,
        generation: 3
      });

      state = manager.getState("/workspace/app" as WorkspaceId);
      expect(state?.status).toBe("analysis-cancelled");
      expect(state?.findings).toHaveLength(1);

      // 4. Failed outcome arrives
      coordinator._emitOutcome({
        status: "failed",
        workspaceId: "/workspace/app" as WorkspaceId,
        generation: 4,
        errorMessage: "Storage disk full"
      });

      state = manager.getState("/workspace/app" as WorkspaceId);
      expect(state?.status).toBe("analysis-failed");
      // Does not wipe out the finding record
      expect(state?.findings).toHaveLength(1);

      manager.dispose();
    });

    it("handles session restoration lifecycle event properly", () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      const restoredSession: RestoredSessionState = {
        status: "restored",
        workspaceId: "/workspace/fresh-restored" as WorkspaceId,
        snapshot: {
          workspaceId: "/workspace/fresh-restored" as WorkspaceId,
          analyzedAt: 1729600000000,
          generation: 1,
          findings: [createSampleRecord("restored-item")],
          coverage: {
            complete: true,
            filesScanned: 8,
            filesWithWarnings: 0,
            unresolvedPatterns: 0,
            warnings: []
          }
        },
        history: [createSampleLifecycleEvent("finding:restored-item", "detected", 1729600000000)],
        seededGeneration: 1
      };

      manager.handleSessionRestored(restoredSession);

      const state = manager.getState("/workspace/fresh-restored" as WorkspaceId);
      expect(state?.status).toBe("last-known");
      expect(state?.timestamp).toBe(new Date(1729600000000).toISOString());
      expect(state?.findings).toHaveLength(1);
      expect(state?.findings[0].id).toBe("finding:restored-item");

      manager.dispose();
    });

    it("maintains strict workspace isolation without leaking findings or history across workspaces", () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      // Outcome for Workspace A
      coordinator._emitOutcome({
        status: "success",
        workspaceId: "/workspace/proj-a" as WorkspaceId,
        generation: 1,
        result: {
          workspaceId: "/workspace/proj-a" as WorkspaceId,
          findings: [createSampleFinding("proj-a-drift")],
          warnings: [],
          generatedAt: 1000,
          complete: true
        }
      });

      // Outcome for Workspace B
      coordinator._emitOutcome({
        status: "success",
        workspaceId: "/workspace/proj-b" as WorkspaceId,
        generation: 1,
        result: {
          workspaceId: "/workspace/proj-b" as WorkspaceId,
          findings: [createSampleFinding("proj-b-drift-1"), createSampleFinding("proj-b-drift-2")],
          warnings: [],
          generatedAt: 2000,
          complete: true
        }
      });

      const stateA = manager.getState("/workspace/proj-a" as WorkspaceId);
      const stateB = manager.getState("/workspace/proj-b" as WorkspaceId);

      expect(stateA?.findings).toHaveLength(1);
      expect(stateA?.findings[0].id).toBe("finding:proj-a-drift");

      expect(stateB?.findings).toHaveLength(2);
      expect(stateB?.findings[0].id).toBe("finding:proj-b-drift-1");
      expect(stateB?.findings[1].id).toBe("finding:proj-b-drift-2");

      manager.dispose();
    });
  });

  describe("C. Webview Lifecycle, Navigation & Message Dispatch", () => {
    function createMockCoordinator(overrides?: Partial<AnalysisCoordinator>): AnalysisCoordinator {
      const mockScheduler = {
        runImmediateScan: vi.fn().mockResolvedValue({ status: "success" }),
        scheduleScan: vi.fn()
      };

      return {
        getActiveWorkspaceId: vi.fn().mockReturnValue("/workspace/app" as WorkspaceId),
        getLastKnownSnapshot: vi.fn().mockReturnValue(undefined),
        getLastKnownHistory: vi.fn().mockReturnValue([]),
        onAnalysisCompleted: vi.fn().mockReturnValue({ dispose: vi.fn() }),
        getScheduler: vi.fn().mockReturnValue(mockScheduler),
        ...overrides
      } as unknown as AnalysisCoordinator;
    }

    it("creates a webview panel on show() and updates its HTML content", async () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      await manager.show();

      expect(mockVsCodeModule.window.createWebviewPanel).toHaveBeenCalledTimes(1);
      const panel = mockVsCodeModule.getLastCreatedPanel();
      expect(panel).toBeDefined();
      expect(panel?.title).toBe("UNDRIFT Integration Report");
      expect(panel?.webview.html).toContain("<!DOCTYPE html>");
      expect(panel?.webview.html).toContain("UNDRIFT Integration Report");

      manager.dispose();
    });

    it("reveals existing panel rather than creating duplicate panels on repeated show() calls", async () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      await manager.show();
      expect(mockVsCodeModule.window.createWebviewPanel).toHaveBeenCalledTimes(1);

      const panel = mockVsCodeModule.getLastCreatedPanel();
      const revealSpy = vi.spyOn(panel!, "reveal");

      // Second call to show()
      await manager.show();
      expect(mockVsCodeModule.window.createWebviewPanel).toHaveBeenCalledTimes(1);
      expect(revealSpy).toHaveBeenCalledTimes(1);

      manager.dispose();
    });

    it("clears currentPanel reference when user closes the panel and recreates on next show()", async () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      await manager.show();
      expect(mockVsCodeModule.window.createWebviewPanel).toHaveBeenCalledTimes(1);

      const panel1 = mockVsCodeModule.getLastCreatedPanel();
      // Simulate user closing the tab in VS Code
      panel1?.dispose();

      // Show again
      await manager.show();
      expect(mockVsCodeModule.window.createWebviewPanel).toHaveBeenCalledTimes(2);

      manager.dispose();
    });

    it("dispatches openLocation webview message to openFindingLocation safely", async () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      await manager.show();
      const panel = mockVsCodeModule.getLastCreatedPanel();

      const span: SourceSpan = {
        uri: "file:///workspace/app/src/index.ts" as DocumentUri,
        start: { line: 15, character: 4 },
        end: { line: 15, character: 30 },
        range: { start: 100, end: 150 }
      };

      // Emit webview message
      await manager.handleWebviewMessage({
        command: "openLocation",
        span
      });

      expect(mockVsCodeModule.workspace.openTextDocument).toHaveBeenCalled();
      expect(mockVsCodeModule.window.showTextDocument).toHaveBeenCalled();

      manager.dispose();
    });

    it("ignores malformed or malicious webview messages safely without throwing", async () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      await expect(manager.handleWebviewMessage(null)).resolves.not.toThrow();
      await expect(manager.handleWebviewMessage(undefined)).resolves.not.toThrow();
      await expect(manager.handleWebviewMessage("random string")).resolves.not.toThrow();
      await expect(manager.handleWebviewMessage({})).resolves.not.toThrow();
      await expect(
        manager.handleWebviewMessage({ command: "openLocation" })
      ).resolves.not.toThrow();
      await expect(
        manager.handleWebviewMessage({ command: "openLocation", span: "invalid" })
      ).resolves.not.toThrow();
      await expect(
        manager.handleWebviewMessage({ command: "unknownCommand" })
      ).resolves.not.toThrow();

      manager.dispose();
    });

    it("triggers immediate workspace scan when scanWorkspace message is received", async () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      await manager.handleWebviewMessage({
        command: "scanWorkspace"
      });

      expect(coordinator.getScheduler().runImmediateScan).toHaveBeenCalledTimes(1);

      manager.dispose();
    });

    it("properly disposes webview panel and subscriptions on manager.dispose()", async () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      await manager.show();
      const panel = mockVsCodeModule.getLastCreatedPanel();
      const panelDisposeSpy = vi.spyOn(panel!, "dispose");

      manager.dispose();
      expect(panelDisposeSpy).toHaveBeenCalledTimes(1);

      // Subsequent show() does nothing when disposed
      await manager.show();
      expect(mockVsCodeModule.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    });
  });

  describe("C. Proposal Review & Application Experience (Chunk 5.3)", () => {
    function createSampleProposal(
      targetRole: "consumer" | "provider",
      overrides?: Partial<FixProposal>
    ): FixProposal {
      return {
        id: `prop:${targetRole}:1` as FixProposalId,
        findingId: "finding:und120:users" as FindingId,
        workspaceId: "/test/workspace" as WorkspaceId,
        generation: 1,
        targetRole,
        title:
          targetRole === "consumer"
            ? "Change frontend request method to POST"
            : "Change backend endpoint method to GET",
        rationale:
          targetRole === "consumer"
            ? "Aligns frontend request method with backend endpoint POST."
            : "Aligns backend endpoint method with frontend request GET.",
        assumptions: {
          authoritativeSide: targetRole === "consumer" ? "provider" : "consumer",
          breakingChange: targetRole === "provider"
        },
        riskLevel: "low",
        verificationExpectation: "Re-analysis will confirm method alignment.",
        edits: [
          {
            id: `edit:${targetRole}:1`,
            proposalId: `prop:${targetRole}:1` as FixProposalId,
            targetUri: targetRole === "consumer" ? "/test/consumer.ts" : "/test/provider.ts",
            span: {
              uri: targetRole === "consumer" ? "/test/consumer.ts" : "/test/provider.ts",
              start: { line: 5, character: 10 },
              end: { line: 5, character: 15 }
            },
            currentText: targetRole === "consumer" ? '"GET"' : "post",
            replacementText: targetRole === "consumer" ? '"POST"' : "get",
            expectedContentHash: "hash123",
            expectedDocumentVersion: 1
          }
        ],
        createdAt: 1000,
        ...overrides
      };
    }

    it("renders candidate repair proposals with distinct roles, diffs, rationale, and assumptions", () => {
      const finding = createSampleFinding("und120:users", { ruleId: "UND120" });
      const consumerProp = createSampleProposal("consumer");
      const providerProp = createSampleProposal("provider");

      const proposalsByFinding = new Map([
        [finding.id, [consumerProp, providerProp]]
      ]);

      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        findings: [finding],
        history: [],
        warnings: [],
        proposalsByFinding
      });

      expect(html).toContain("Candidate Repair Proposals (2 available)");
      expect(html).toContain("Proposals represent alternative repairs, not authoritative recommendations.");
      expect(html).toContain("Consumer Repair (Frontend)");
      expect(html).toContain("Provider Repair (Backend)");
      expect(html).toContain("Change frontend request method to POST");
      expect(html).toContain("Change backend endpoint method to GET");
      expect(html).toContain("Provider (Backend)");
      expect(html).toContain("Consumer (Frontend)");
      expect(html).toContain("Aligns frontend request method with backend endpoint POST.");
      expect(html).toContain("&quot;GET&quot;");
      expect(html).toContain("&quot;POST&quot;");
      expect(html).toContain('data-action="apply-fix"');
      expect(html).toContain('data-proposal-id="prop:consumer:1"');
      expect(html).toContain('data-proposal-id="prop:provider:1"');
    });

    it("highlights target proposal card when targetProposalId is provided", () => {
      const finding = createSampleFinding("und120:users", { ruleId: "UND120" });
      const consumerProp = createSampleProposal("consumer");
      const providerProp = createSampleProposal("provider");

      const proposalsByFinding = new Map([
        [finding.id, [consumerProp, providerProp]]
      ]);

      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        findings: [finding],
        history: [],
        warnings: [],
        proposalsByFinding,
        targetProposalId: "prop:consumer:1"
      });

      expect(html).toContain('id="proposal-prop:consumer:1"');
      expect(html).toContain("proposal-target-highlight");
    });

    it("renders manual resolution notes when no safe proposals are available", () => {
      const und120Finding = createSampleFinding("und120:no-fix", { ruleId: "UND120" });
      const und200Finding = createSampleFinding("und200:no-fix", { ruleId: "UND200" });

      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        findings: [und120Finding, und200Finding],
        history: [],
        warnings: [],
        proposalsByFinding: new Map([
          [und120Finding.id, []],
          [und200Finding.id, []]
        ])
      });

      expect(html).toContain(
        "No automated safe repair proposals are available for this finding. Method evidence could not be determined conservatively without ambiguity. Manual inspection and repair is required."
      );
      expect(html).toContain(
        "Automated repair proposals are not supported for rule <code>UND200</code>. Manual resolution is required."
      );
    });

    it("escapes proposal fields to prevent XSS", () => {
      const finding = createSampleFinding("xss:prop", { ruleId: "UND120" });
      const maliciousProp = createSampleProposal("consumer", {
        title: "<script>alert('title-xss')</script>",
        rationale: "<img src=x onerror=alert('rationale-xss')>",
        edits: [
          {
            id: "edit:xss",
            proposalId: "prop:consumer:1" as FixProposalId,
            targetUri: "/test/consumer.ts",
            span: {
              uri: "/test/consumer.ts",
              start: { line: 1, character: 1 },
              end: { line: 1, character: 5 }
            },
            currentText: "<tag>old</tag>",
            replacementText: "<script>pwned()</script>",
            expectedContentHash: "hash",
            expectedDocumentVersion: 1
          }
        ]
      });

      const proposalsByFinding = new Map([[finding.id, [maliciousProp]]]);

      const html = renderReportHtml({
        workspaceId: "/test/workspace",
        status: "freshly-verified",
        findings: [finding],
        history: [],
        warnings: [],
        proposalsByFinding
      });

      expect(html).not.toContain("<script>alert('title-xss')</script>");
      expect(html).toContain("&lt;script&gt;alert(&#39;title-xss&#39;)&lt;/script&gt;");

      expect(html).not.toContain("<img src=x onerror=alert('rationale-xss')>");
      expect(html).toContain("&lt;img src=x onerror=alert(&#39;rationale-xss&#39;)&gt;");

      expect(html).not.toContain("<script>pwned()</script>");
      expect(html).toContain("&lt;script&gt;pwned()&lt;/script&gt;");
    });

    it("dispatches undrift.applyFix command when valid applyFix message is received", async () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      mockVsCodeModule.commands.executeCommand.mockClear();

      await manager.handleWebviewMessage({
        command: "applyFix",
        proposalId: "prop:consumer:1"
      });

      expect(mockVsCodeModule.commands.executeCommand).toHaveBeenCalledWith(
        "undrift.applyFix",
        "prop:consumer:1"
      );

      manager.dispose();
    });

    it("ignores malformed, empty, or oversized applyFix messages", async () => {
      const coordinator = createMockCoordinator();
      const manager = new ReportPanelManager(coordinator);

      mockVsCodeModule.commands.executeCommand.mockClear();

      await manager.handleWebviewMessage({ command: "applyFix", proposalId: "" });
      await manager.handleWebviewMessage({ command: "applyFix", proposalId: "   " });
      await manager.handleWebviewMessage({ command: "applyFix", proposalId: 12345 });
      await manager.handleWebviewMessage({ command: "applyFix", proposalId: "x".repeat(300) });
      await manager.handleWebviewMessage({ command: "applyFix" });

      expect(mockVsCodeModule.commands.executeCommand).not.toHaveBeenCalled();

      manager.dispose();
    });
  });
});
