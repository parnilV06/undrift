// Native VS Code Status Bar Item for UNDRIFT
// strictly adhering to LLD.md Section 14.8 and Chunk 4.8 specification.

import type * as vscode from "vscode";
import type { WorkspaceId } from "@undrift/core";
import type {
  AnalysisCoordinator,
  CoordinatorAnalysisResult,
  RestoredSessionState
} from "../activation/coordinator";
import type { ExtensionLogger } from "../logging/output-channel";

export type StatusBarState =
  | "analyzing"
  | "clean"
  | "findings"
  | "last-known"
  | "incomplete"
  | "failed"
  | "no-analysis"
  | "no-workspace";

export interface DriftStatusBarOptions {
  coordinator?: AnalysisCoordinator;
  vscodeModule?: typeof vscode;
  logger?: ExtensionLogger;
}

export class DriftStatusBar implements vscode.Disposable {
  private statusBarItem?: vscode.StatusBarItem;
  private readonly vscodeModule?: typeof vscode;
  private readonly logger?: ExtensionLogger;
  private coordinator?: AnalysisCoordinator;
  private coordinatorSubscription?: { dispose(): void };
  private currentState: StatusBarState = "no-analysis";
  private activeWorkspaceId?: WorkspaceId;
  private disposed = false;

  constructor(options: DriftStatusBarOptions = {}) {
    this.vscodeModule = options.vscodeModule;
    this.logger = options.logger;

    const vs = this.getVsCode();
    if (vs?.window?.createStatusBarItem) {
      this.statusBarItem = vs.window.createStatusBarItem(vs.StatusBarAlignment?.Left ?? 1, 10);
      this.statusBarItem.command = "undrift.showReport";
      this.statusBarItem.name = "UNDRIFT Status";

      this.setNoAnalysis();
      this.statusBarItem.show();
    } else {
      this.setNoAnalysis();
    }

    if (options.coordinator) {
      this.setCoordinator(options.coordinator);
    }
  }

  private getVsCode(): typeof vscode | undefined {
    if (this.vscodeModule) return this.vscodeModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("vscode");
    } catch {
      return undefined;
    }
  }

  public setCoordinator(coordinator: AnalysisCoordinator): void {
    if (this.coordinatorSubscription) {
      this.coordinatorSubscription.dispose();
      this.coordinatorSubscription = undefined;
    }

    this.coordinator = coordinator;

    this.coordinatorSubscription = coordinator.onAnalysisCompleted((outcome) => {
      this.handleAnalysisOutcome(outcome);
    });

    const wsId = coordinator.getActiveWorkspaceId();
    if (wsId) {
      this.activeWorkspaceId = wsId;
      const snap = coordinator.getLastKnownSnapshot(wsId);
      if (snap) {
        const count = snap.findings.filter((f) => f.state !== "resolved").length;
        this.setLastKnown(count);
      } else {
        this.setNoAnalysis();
      }
    }
  }

  public setAnalyzing(): void {
    if (this.disposed) return;
    this.currentState = "analyzing";
    if (this.statusBarItem) {
      this.statusBarItem.text = "$(sync~spin) UNDRIFT: Analyzing...";
      this.statusBarItem.tooltip = "UNDRIFT: Analyzing API contracts...";
    }
  }

  public setClean(): void {
    if (this.disposed) return;
    this.currentState = "clean";
    if (this.statusBarItem) {
      this.statusBarItem.text = "$(pass) UNDRIFT: Clean";
      this.statusBarItem.tooltip =
        "UNDRIFT: All analyzed consumer contracts match providers (0 drift findings)";
    }
  }

  public setFindings(count: number): void {
    if (this.disposed) return;
    this.currentState = "findings";
    if (this.statusBarItem) {
      this.statusBarItem.text = `$(warning) UNDRIFT: ${count} drift`;
      this.statusBarItem.tooltip = `UNDRIFT: ${count} active contract drift finding${count === 1 ? "" : "s"}`;
    }
  }

  public setLastKnown(count: number): void {
    if (this.disposed) return;
    this.currentState = "last-known";
    if (this.statusBarItem) {
      this.statusBarItem.text = `$(history) UNDRIFT: ${count} drift (restored)`;
      this.statusBarItem.tooltip = `UNDRIFT: Showing restored last-known state (${count} active finding${count === 1 ? "" : "s"})`;
    }
  }

  public setIncomplete(): void {
    if (this.disposed) return;
    this.currentState = "incomplete";
    if (this.statusBarItem) {
      this.statusBarItem.text = "$(issue-draft) UNDRIFT: Incomplete";
      this.statusBarItem.tooltip =
        "UNDRIFT: Analysis incomplete (results gated due to coverage or warnings)";
    }
  }

  public setFailed(): void {
    if (this.disposed) return;
    this.currentState = "failed";
    if (this.statusBarItem) {
      this.statusBarItem.text = "$(error) UNDRIFT: Failed";
      this.statusBarItem.tooltip = "UNDRIFT: Workspace analysis failed";
    }
  }

  public setNoAnalysis(): void {
    if (this.disposed) return;
    this.currentState = "no-analysis";
    if (this.statusBarItem) {
      this.statusBarItem.text = "$(eye) UNDRIFT";
      this.statusBarItem.tooltip = "UNDRIFT: Click to view report or scan workspace";
    }
  }

  public setNoWorkspace(): void {
    if (this.disposed) return;
    this.currentState = "no-workspace";
    if (this.statusBarItem) {
      this.statusBarItem.text = "$(circle-slash) UNDRIFT";
      this.statusBarItem.tooltip = "UNDRIFT: No workspace folder open";
    }
  }

  public handleAnalysisOutcome(outcome: CoordinatorAnalysisResult): void {
    if (this.disposed) return;

    switch (outcome.status) {
      case "superseded":
        // Stale result: do not clobber status bar
        return;

      case "no-workspace":
        this.setNoWorkspace();
        return;

      case "success": {
        const findings = outcome.result?.findings ?? [];
        const activeCount = findings.filter((f) => f.state !== "resolved").length;
        if (activeCount === 0) {
          this.setClean();
        } else {
          this.setFindings(activeCount);
        }
        return;
      }

      case "incomplete":
        this.setIncomplete();
        return;

      case "failed":
        this.setFailed();
        return;

      case "cancelled":
        // Cancelled scan does not overwrite status bar with obsolete findings
        return;
    }
  }

  public handleSessionRestored(restored: RestoredSessionState): void {
    if (this.disposed) return;

    if (!restored.workspaceId || restored.status === "no-workspace") {
      this.setNoWorkspace();
      return;
    }

    this.activeWorkspaceId = restored.workspaceId;

    if (restored.snapshot) {
      const activeCount = restored.snapshot.findings.filter((f) => f.state !== "resolved").length;
      this.setLastKnown(activeCount);
    } else {
      this.setNoAnalysis();
    }
  }

  public getState(): StatusBarState {
    return this.currentState;
  }

  public getItem(): vscode.StatusBarItem | undefined {
    return this.statusBarItem;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.coordinatorSubscription) {
      this.coordinatorSubscription.dispose();
      this.coordinatorSubscription = undefined;
    }

    if (this.statusBarItem) {
      this.statusBarItem.dispose();
      this.statusBarItem = undefined;
    }
  }
}
