/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import type { FindingCategory, FindingSeverity, SourceSpan, WorkspaceId } from "@undrift/core";

const { mockVsCodeModule } = vi.hoisted(() => {
  const mockVsCodeModule = {
    Uri: {
      parse: (val: string) => ({
        scheme: "file",
        path: val,
        toString: () => val
      }),
      file: (fsPath: string) => ({
        scheme: "file",
        path: fsPath,
        toString: () => `file://${fsPath}`
      })
    },
    Position: class {
      constructor(
        public line: number,
        public character: number
      ) {}
    },
    Range: class {
      constructor(
        public start: any,
        public end: any
      ) {}
    },
    window: {
      showTextDocument: vi.fn().mockResolvedValue({}),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn()
    },
    workspace: {
      openTextDocument: vi.fn().mockResolvedValue({})
    },
    commands: {
      executeCommand: vi.fn()
    }
  };
  return { mockVsCodeModule };
});

vi.mock("vscode", () => mockVsCodeModule);

import type { DiagnosticFindingSource } from "../../apps/vscode-extension/src/diagnostics";
import {
  formatLocationShort,
  OverviewViewModel,
  OverviewViewProvider,
  renderOverviewHtml
} from "../../apps/vscode-extension/src/views/overview-view";
import { renderReportHtml } from "../../apps/vscode-extension/src/views/report-panel";

function createSampleFinding(
  id: string,
  overrides: Partial<DiagnosticFindingSource> = {}
): DiagnosticFindingSource {
  return {
    id: `finding:${id}` as any,
    ruleId: "UND110",
    category: "route" as FindingCategory,
    severity: "warning" as FindingSeverity,
    state: "active",
    title: "Provider has no known consumer",
    summary: "No client calls this route",
    explanation: "Route is orphaned",
    evidenceStrength: "direct",
    observationIds: [],
    sourceLocations: [
      {
        uri: "file:///workspace/src/routes/api.ts",
        start: { line: 14, character: 4 },
        end: { line: 14, character: 30 }
      }
    ],
    limitations: [],
    fixProposalIds: [],
    ...overrides
  };
}

describe("Chunk 6.5: Workbench Integration & UI Refresh", () => {
  describe("A. Manifest & Activity Bar Configuration", () => {
    const packageJsonPath = path.resolve(__dirname, "../../apps/vscode-extension/package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    it("registers dedicated Activity Bar viewContainer for UNDRIFT", () => {
      expect(packageJson.contributes.viewsContainers).toBeDefined();
      expect(packageJson.contributes.viewsContainers.activitybar).toBeDefined();

      const containers = packageJson.contributes.viewsContainers.activitybar;
      const undriftContainer = containers.find((c: any) => c.id === "undrift");
      expect(undriftContainer).toBeDefined();
      expect(undriftContainer.title).toBe("UNDRIFT");
      expect(undriftContainer.icon).toBe("resources/undrift.svg");
    });

    it("provides valid original SVG icon with 24x24 viewBox and currentColor", () => {
      const svgPath = path.resolve(__dirname, "../../apps/vscode-extension/resources/undrift.svg");
      expect(fs.existsSync(svgPath)).toBe(true);

      const svgContent = fs.readFileSync(svgPath, "utf8");
      expect(svgContent).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(svgContent).toContain('viewBox="0 0 24 24"');
      expect(svgContent).toContain("currentColor");
      // Must not contain hardcoded gold/yellow colors
      expect(svgContent).not.toContain("#cca700");
      expect(svgContent).not.toContain("gold");
      expect(svgContent).not.toContain("amber");
    });

    it("contributes persistent Overview and Findings views in undrift container", () => {
      expect(packageJson.contributes.views.undrift).toBeDefined();
      const views = packageJson.contributes.views.undrift;

      const overviewView = views.find((v: any) => v.id === "undrift.overview");
      expect(overviewView).toBeDefined();
      expect(overviewView.name).toBe("Overview");
      expect(overviewView.type).toBe("webview");

      const findingsView = views.find((v: any) => v.id === "undrift.findingsView");
      expect(findingsView).toBeDefined();
      expect(findingsView.name).toBe("Findings");
    });

    it("configures title menus for undrift.overview", () => {
      const titleMenus = packageJson.contributes.menus["view/title"];
      const overviewMenus = titleMenus.filter((m: any) =>
        m.when.includes("view == undrift.overview")
      );
      expect(overviewMenus.length).toBeGreaterThanOrEqual(3);

      const cmds = overviewMenus.map((m: any) => m.command);
      expect(cmds).toContain("undrift.scanWorkspace");
      expect(cmds).toContain("undrift.refresh");
      expect(cmds).toContain("undrift.showReport");
    });
  });

  describe("B. Theme-Aware Visual Design & CSS Tokens", () => {
    it("uses native VS Code theme variables without hardcoded text selection gold/amber in Integration Report", () => {
      const html = renderReportHtml({
        workspaceId: "/workspace" as WorkspaceId,
        workspaceLabel: "MyProject",
        status: "freshly-verified",
        findings: [createSampleFinding("1")],
        history: [],
        warnings: []
      });

      // Does NOT use editor-inactiveSelectionBackground for card backgrounds
      expect(html).not.toContain("--card-bg: var(--vscode-editor-inactiveSelectionBackground");
      // Uses native editorWidget / panel tokens
      expect(html).toContain("--card-bg: var(--vscode-editorWidget-background");
      // Declares light and high-contrast body adaptations
      expect(html).toContain("body.vscode-light");
      expect(html).toContain("body.vscode-high-contrast");
      // Does not use large yellow background blocks for banners
      expect(html).not.toContain("background: rgba(204, 167, 0, 0.12)");
      expect(html).toContain("border-left: 4px solid var(--color-warning)");
    });

    it("uses native sidebar theme variables in Sidebar Overview HTML", () => {
      const html = renderOverviewHtml({
        workspaceId: "/workspace" as WorkspaceId,
        workspaceLabel: "MyProject",
        status: "freshly-verified",
        findings: [createSampleFinding("1")],
        warnings: []
      });

      expect(html).toContain("var(--vscode-sideBar-background");
      expect(html).toContain("var(--vscode-sideBar-foreground");
      expect(html).toContain("var(--vscode-sideBarSectionHeader-background");
      expect(html).toContain("body.vscode-light");
      expect(html).toContain("body.vscode-high-contrast");
    });
  });

  describe("C. Sidebar Overview HTML Rendering", () => {
    it("renders header with workspace name, status badge, and last analyzed timestamp", () => {
      const model: OverviewViewModel = {
        workspaceId: "/workspace/shop" as WorkspaceId,
        workspaceLabel: "Shop App",
        status: "freshly-verified",
        timestamp: "2026-11-04T12:00:00Z",
        findings: [],
        warnings: []
      };

      const html = renderOverviewHtml(model);
      expect(html).toContain("UNDRIFT");
      expect(html).toContain("Shop App");
      expect(html).toContain("Verified");
      expect(html).toContain("Analyzed:");
    });

    it("renders compact metrics with findings separated from coverage limitations", () => {
      const model: OverviewViewModel = {
        workspaceId: "/workspace/shop" as WorkspaceId,
        workspaceLabel: "Shop App",
        status: "freshly-verified",
        findings: [
          createSampleFinding("1", { severity: "error" }),
          createSampleFinding("2", { severity: "warning" }),
          createSampleFinding("3", { severity: "info" })
        ],
        warnings: [
          {
            code: "PARTIAL_SHAPE",
            reasonCode: "explicit-unknown-type",
            message: "Request payload has any annotation",
            affectsCompleteness: false
          } as any
        ]
      };

      const html = renderOverviewHtml(model);
      // Active Drift Findings count
      expect(html).toContain('<span class="metric-val metric-val-hero">3</span>');
      expect(html).toContain('<span class="metric-lbl">Active Drift Findings</span>');

      // Breakdown
      expect(html).toContain('<span class="metric-lbl">Errors</span>');
      expect(html).toContain('<span class="metric-val" style="color: var(--color-error)">1</span>');
      expect(html).toContain('<span class="metric-lbl">Warnings</span>');
      expect(html).toContain(
        '<span class="metric-val" style="color: var(--color-warning)">1</span>'
      );
      expect(html).toContain('<span class="metric-lbl">Information</span>');
      expect(html).toContain('<span class="metric-val" style="color: var(--color-info)">1</span>');

      // Separate coverage limitation count
      expect(html).toContain('<span class="metric-lbl">Coverage Limitations</span>');
      expect(html).toContain(
        '<span class="metric-val" style="color: var(--vscode-descriptionForeground)">1</span>'
      );
    });

    it("renders primary Open Full Integration Report action and secondary actions", () => {
      const html = renderOverviewHtml({
        workspaceId: "/workspace" as WorkspaceId,
        workspaceLabel: "Project",
        status: "no-analysis",
        findings: [],
        warnings: []
      });

      expect(html).toContain('data-action="open-report"');
      expect(html).toContain("Open Full Integration Report");
      expect(html).toContain('data-action="scan"');
      expect(html).toContain("Scan Workspace");
      expect(html).toContain('data-action="refresh"');
      expect(html).toContain("Refresh");
    });

    it("renders clickable finding items with source locations", () => {
      const finding = createSampleFinding("10", {
        ruleId: "UND120",
        title: "HTTP Method Conflict",
        category: "route",
        severity: "error",
        observed: { method: "POST", route: "/api/checkout" } as any,
        sourceLocations: [
          {
            uri: "file:///workspace/server/checkout.ts",
            start: { line: 24, character: 2 },
            end: { line: 24, character: 30 }
          }
        ]
      });

      const html = renderOverviewHtml({
        workspaceId: "/workspace" as WorkspaceId,
        workspaceLabel: "Project",
        status: "freshly-verified",
        findings: [finding],
        warnings: []
      });

      expect(html).toContain("UND120 · HTTP Method Conflict");
      expect(html).toContain("POST /api/checkout");
      expect(html).toContain("checkout.ts:25");
      expect(html).toContain('data-action="open-location"');
    });

    it("renders friendly zero-findings clean state", () => {
      const html = renderOverviewHtml({
        workspaceId: "/workspace" as WorkspaceId,
        workspaceLabel: "Clean Project",
        status: "freshly-verified",
        findings: [],
        warnings: []
      });

      expect(html).toContain("No Contract Drift Detected");
      expect(html).toContain("All analyzed frontend consumers and backend providers are in sync.");
    });

    it("renders appropriate empty states for no-workspace and not-scanned", () => {
      const noWsHtml = renderOverviewHtml({
        workspaceLabel: "No Workspace",
        status: "no-workspace",
        findings: [],
        warnings: []
      });
      expect(noWsHtml).toContain("No Workspace Open");

      const notScannedHtml = renderOverviewHtml({
        workspaceId: "/ws" as WorkspaceId,
        workspaceLabel: "Unscanned",
        status: "no-analysis",
        findings: [],
        warnings: []
      });
      expect(notScannedHtml).toContain("Not Scanned Yet");
    });

    it("formats short location strings cleanly", () => {
      const span: SourceSpan = {
        uri: "file:///project/src/controllers/userController.ts",
        start: { line: 9, character: 0 },
        end: { line: 9, character: 20 }
      };
      expect(formatLocationShort(span)).toBe("userController.ts:10");
      expect(formatLocationShort(undefined)).toBe("");
    });
  });

  describe("D. OverviewViewProvider & Dynamic Activity Bar Badge", () => {
    it("updates badge on WebviewView when findings are present", () => {
      const provider = new OverviewViewProvider();
      const mockWebviewView: any = {
        webview: {
          options: {},
          html: "",
          onDidReceiveMessage: vi.fn()
        },
        onDidDispose: vi.fn(),
        badge: undefined
      };

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      // Simulate completed scan outcome with 5 active findings
      const findings = [
        createSampleFinding("1"),
        createSampleFinding("2"),
        createSampleFinding("3"),
        createSampleFinding("4"),
        createSampleFinding("5")
      ];

      provider.handleAnalysisOutcome({
        status: "success",
        workspaceId: "/workspace/test" as WorkspaceId,
        result: {
          findings,
          warnings: [],
          statistics: { activeFindings: 5 } as any,
          complete: true
        } as any
      });

      expect(mockWebviewView.badge).toBeDefined();
      expect(mockWebviewView.badge.value).toBe(5);
      expect(mockWebviewView.badge.tooltip).toBe(
        "5 active drift findings in the current workspace"
      );
    });

    it("removes badge (sets undefined) when count becomes zero", () => {
      const provider = new OverviewViewProvider();
      const mockWebviewView: any = {
        webview: {
          options: {},
          html: "",
          onDidReceiveMessage: vi.fn()
        },
        onDidDispose: vi.fn(),
        badge: { value: 3, tooltip: "3 findings" }
      };

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      // Simulate scan outcome with 0 findings
      provider.handleAnalysisOutcome({
        status: "success",
        workspaceId: "/workspace/clean" as WorkspaceId,
        result: {
          findings: [],
          warnings: [],
          statistics: { activeFindings: 0 } as any,
          complete: true
        } as any
      });

      expect(mockWebviewView.badge).toBeUndefined();
    });

    it("does NOT include coverage limitations in the badge count", () => {
      const provider = new OverviewViewProvider();
      const mockWebviewView: any = {
        webview: {
          options: {},
          html: "",
          onDidReceiveMessage: vi.fn()
        },
        onDidDispose: vi.fn(),
        badge: undefined
      };

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      // 2 findings and 4 coverage warnings
      const findings = [createSampleFinding("1"), createSampleFinding("2")];
      const warnings = [
        { code: "PARTIAL_SHAPE", affectsCompleteness: false } as any,
        { code: "PARTIAL_SHAPE", affectsCompleteness: false } as any,
        { code: "DYNAMIC_ROUTE", affectsCompleteness: false } as any,
        { code: "DYNAMIC_ROUTE", affectsCompleteness: false } as any
      ];

      provider.handleAnalysisOutcome({
        status: "success",
        workspaceId: "/workspace/test" as WorkspaceId,
        result: {
          findings,
          warnings,
          statistics: { activeFindings: 2 } as any,
          complete: true
        } as any
      });

      // Badge must strictly be 2 (findings only), not 6!
      expect(mockWebviewView.badge.value).toBe(2);
      expect(mockWebviewView.badge.tooltip).toBe(
        "2 active drift findings in the current workspace"
      );
    });

    it("handles webview message dispatch for openReport, scan, and refresh", () => {
      const mockExecuteCommand = vi.fn();
      const mockVs: any = {
        commands: {
          executeCommand: mockExecuteCommand
        }
      };

      const provider = new OverviewViewProvider({ vscodeModule: mockVs });
      let messageHandler: ((msg: any) => void) | undefined;
      const mockWebviewView: any = {
        webview: {
          options: {},
          html: "",
          onDidReceiveMessage: vi.fn((cb) => {
            messageHandler = cb;
          })
        },
        onDidDispose: vi.fn()
      };

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
      expect(messageHandler).toBeDefined();

      // Trigger openReport
      messageHandler!({ command: "openReport" });
      expect(mockExecuteCommand).toHaveBeenCalledWith("undrift.showReport");

      // Trigger scanWorkspace
      messageHandler!({ command: "scanWorkspace" });
      expect(mockExecuteCommand).toHaveBeenCalledWith("undrift.scanWorkspace");

      // Trigger refresh
      messageHandler!({ command: "refresh" });
      expect(mockExecuteCommand).toHaveBeenCalledWith("undrift.refresh");
    });
  });
});
