// VS Code extension command registrations for UNDRIFT.
// strictly adhering to LLD.md Sections 14.8, 16.2, and Chunk 4.8 specification.

import type * as vscode from "vscode";
import type { SourceSpan } from "@undrift/core";
import type { AnalysisCoordinator } from "../activation/coordinator";
import type { ExtensionLogger } from "../logging/output-channel";
import type { DriftStatusBar } from "../status";
import {
  openFindingLocation,
  type FindingsTreeDataProvider,
  type ReportPanelManager
} from "../views";

/**
 * Formats user-facing warning message for an incomplete analysis scan.
 */
export function formatIncompleteScanMessage(
  filesCount: number,
  findingsCount: number,
  failuresCount: number
): string {
  const failureDetail =
    failuresCount > 0
      ? ` (${failuresCount} file${failuresCount === 1 ? "" : "s"} could not be acquired)`
      : "";
  return `UNDRIFT: Analysis incomplete${failureDetail}. Analyzed ${filesCount} file${filesCount === 1 ? "" : "s"}, found ${findingsCount} finding${findingsCount === 1 ? "" : "s"}.`;
}

export interface CommandDependencies {
  coordinator: AnalysisCoordinator;
  reportPanelManager: ReportPanelManager;
  treeProvider?: FindingsTreeDataProvider;
  statusBar?: DriftStatusBar;
  logger?: ExtensionLogger;
  vscodeModule?: typeof vscode;
}

/**
 * Registers all UNDRIFT extension commands and returns disposables for cleanup.
 */
export function registerCommands(deps: CommandDependencies): vscode.Disposable[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vs = deps.vscodeModule ?? require("vscode");
  const disposables: vscode.Disposable[] = [];

  // 1. undrift.scanWorkspace
  disposables.push(
    vs.commands.registerCommand("undrift.scanWorkspace", async () => {
      deps.statusBar?.setAnalyzing();
      try {
        const outcome = await deps.coordinator.getScheduler().runImmediateScan();

        switch (outcome.status) {
          case "success": {
            const filesCount = outcome.result?.statistics.filesParsed ?? outcome.totalAcquired ?? 0;
            const findingsCount = outcome.result?.findings.length ?? 0;
            if (outcome.persistenceStatus === "failed") {
              const reason = outcome.persistenceError ? `: ${outcome.persistenceError}` : "";
              deps.logger?.error(`State persistence failed${reason}`);
              void vs.window.showWarningMessage(
                `UNDRIFT: Analysis complete (${findingsCount} finding${findingsCount === 1 ? "" : "s"}), but failed to save analysis state${reason}.`
              );
            } else {
              void vs.window.showInformationMessage(
                `UNDRIFT: Analysis complete. Analyzed ${filesCount} file${filesCount === 1 ? "" : "s"}, found ${findingsCount} contract drift finding${findingsCount === 1 ? "" : "s"}.`
              );
            }
            break;
          }

          case "incomplete": {
            const filesCount = outcome.result?.statistics.filesParsed ?? outcome.totalAcquired ?? 0;
            const findingsCount = outcome.result?.findings.length ?? 0;
            const failuresCount = outcome.failures?.length ?? 0;
            void vs.window.showWarningMessage(
              formatIncompleteScanMessage(filesCount, findingsCount, failuresCount)
            );
            break;
          }

          case "cancelled": {
            deps.logger?.info("UNDRIFT: Workspace analysis was cancelled.");
            break;
          }

          case "superseded": {
            deps.logger?.info("UNDRIFT: Workspace analysis was superseded by a newer scan.");
            break;
          }

          case "no-workspace": {
            void vs.window.showInformationMessage(
              "UNDRIFT: No workspace folder is currently open in VS Code."
            );
            break;
          }

          case "failed": {
            const msg = outcome.errorMessage ?? "Workspace analysis failed.";
            deps.logger?.error(`Analysis failed: ${msg}`);
            void vs.window.showErrorMessage(`UNDRIFT: Analysis failed — ${msg}`);
            break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger?.error("Unexpected error executing workspace scan", err);
        void vs.window.showErrorMessage(`UNDRIFT: Scan encountered an error: ${msg}`);
      }
    })
  );

  // 2. undrift.refresh
  disposables.push(
    vs.commands.registerCommand("undrift.refresh", async () => {
      deps.treeProvider?.refresh();
      deps.statusBar?.setAnalyzing();
      await deps.coordinator.getScheduler().runImmediateScan();
    })
  );

  // 3. undrift.showReport
  disposables.push(
    vs.commands.registerCommand("undrift.showReport", async (targetFindingId?: string) => {
      await deps.reportPanelManager.show(targetFindingId);
    })
  );

  // 4. undrift.explainFinding
  disposables.push(
    vs.commands.registerCommand("undrift.explainFinding", async (arg?: unknown) => {
      let targetFindingId: string | undefined;

      if (typeof arg === "string" && arg) {
        targetFindingId = arg;
      } else if (arg && typeof arg === "object") {
        if (
          "finding" in arg &&
          arg.finding &&
          typeof (arg.finding as { id?: string }).id === "string"
        ) {
          targetFindingId = (arg.finding as { id: string }).id;
        } else if ("id" in arg && typeof (arg as { id?: string }).id === "string") {
          targetFindingId = (arg as { id: string }).id;
        }
      }

      if (targetFindingId) {
        await deps.reportPanelManager.show(targetFindingId);
        return;
      }

      // No argument provided: show quickpick from active findings
      const wsId = deps.coordinator.getActiveWorkspaceId();
      const snapshot = wsId ? deps.coordinator.getLastKnownSnapshot(wsId) : undefined;
      const findings = snapshot?.findings.filter((f) => f.state !== "resolved") ?? [];

      if (findings.length === 0) {
        void vs.window.showInformationMessage(
          "UNDRIFT: No active contract drift findings to explain in the current workspace."
        );
        await deps.reportPanelManager.show();
        return;
      }

      if (findings.length === 1) {
        await deps.reportPanelManager.show(findings[0].id);
        return;
      }

      const quickPickItems = findings.map((f) => ({
        label: f.title,
        description: `[${f.ruleId}] ${f.severity}`,
        detail: f.summary,
        findingId: f.id
      }));

      const picked = await vs.window.showQuickPick(quickPickItems, {
        placeHolder: "Select a contract drift finding to explain"
      });

      if (picked) {
        await deps.reportPanelManager.show(picked.findingId);
      }
    })
  );

  // 5. undrift.resetHistory
  disposables.push(
    vs.commands.registerCommand("undrift.resetHistory", async () => {
      const wsId = deps.coordinator.getActiveWorkspaceId();
      if (!wsId) {
        void vs.window.showInformationMessage(
          "UNDRIFT: No workspace folder is currently open in VS Code."
        );
        return;
      }

      const choice = await vs.window.showWarningMessage(
        `Reset UNDRIFT drift history for workspace "${wsId}"? This will clear all historical lifecycle events while preserving the latest snapshot.`,
        { modal: true },
        "Reset History"
      );

      if (choice !== "Reset History") {
        return;
      }

      try {
        await deps.coordinator.resetHistory(wsId);
        deps.reportPanelManager.handleHistoryReset(wsId);
        deps.treeProvider?.refresh();
        void vs.window.showInformationMessage(
          "UNDRIFT: Drift history reset successfully for this workspace."
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger?.error("Failed to reset drift history", err);
        void vs.window.showErrorMessage(`UNDRIFT: Failed to reset drift history: ${msg}`);
      }
    })
  );

  // 6. undrift.clearCache
  disposables.push(
    vs.commands.registerCommand("undrift.clearCache", async () => {
      const wsId = deps.coordinator.getActiveWorkspaceId();
      if (!wsId) {
        void vs.window.showInformationMessage(
          "UNDRIFT: No workspace folder is currently open in VS Code."
        );
        return;
      }

      try {
        await deps.coordinator.clearCache();
        deps.logger?.info("In-memory workspace state cache cleared; re-scanning workspace...");
        void vs.window.showInformationMessage(
          "UNDRIFT: In-memory workspace state cache cleared (saved snapshots and lifecycle history are preserved). Re-scanning workspace..."
        );
        deps.statusBar?.setAnalyzing();
        await deps.coordinator.getScheduler().runImmediateScan();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        deps.logger?.error("Failed to clear in-memory workspace state cache", err);
        void vs.window.showErrorMessage(
          `UNDRIFT: Failed to clear in-memory workspace state cache: ${msg}`
        );
      }
    })
  );

  // 7. undrift.openFindingLocation
  disposables.push(
    vs.commands.registerCommand("undrift.openFindingLocation", async (span?: SourceSpan) => {
      await openFindingLocation(span, vs);
    })
  );

  return disposables;
}
