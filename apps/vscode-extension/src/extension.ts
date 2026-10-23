// VS Code extension entry point for UNDRIFT.
// Wires the production Tree-sitter parser adapter, JavaScript/TypeScript analyzer,
// core analysis engine, and analysis coordinator to VS Code commands and lifecycle.

import * as path from "path";
import * as vscode from "vscode";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { AnalysisEngine, type SourceSpan, StateReconciler } from "@undrift/core";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { AnalysisCoordinator } from "./activation";
import { DriftDiagnosticProvider } from "./diagnostics";
import { OutputChannelLogger } from "./logging";
import { WorkspaceStatePersistenceAdapter } from "./storage";
import { FindingsTreeDataProvider, openFindingLocation, ReportPanelManager } from "./views";
import { WorkspaceManager } from "./workspace";

/**
 * Formats the user-facing warning message for an incomplete analysis scan.
 * When files failed acquisition, explicitly reports the acquisition failure count.
 * When source acquisition succeeded but analysis was marked incomplete due to
 * parsing, analysis, or coverage limitations, avoids falsely reporting zero unacquired files.
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

let logger: OutputChannelLogger | undefined;
let workspaceManager: WorkspaceManager | undefined;
let parser: TreeSitterParserAdapter | undefined;
let analyzer: JsTsAnalyzer | undefined;
let engine: AnalysisEngine | undefined;
let persistence: WorkspaceStatePersistenceAdapter | undefined;
let reconciler: StateReconciler | undefined;
let diagnosticProvider: DriftDiagnosticProvider | undefined;
let treeProvider: FindingsTreeDataProvider | undefined;
let reportPanelManager: ReportPanelManager | undefined;
let coordinator: AnalysisCoordinator | undefined;

/**
 * Activates the UNDRIFT VS Code extension.
 */
export function activate(context: vscode.ExtensionContext): void {
  // 1. Initialize diagnostic output channel logger
  logger = new OutputChannelLogger("UNDRIFT");
  context.subscriptions.push({
    dispose: () => {
      logger?.dispose();
      logger = undefined;
    }
  });

  logger.info("Activating UNDRIFT extension...");

  // 2. Initialize workspace source snapshot manager
  workspaceManager = new WorkspaceManager();

  // 3. Resolve bundled Tree-sitter WASM assets directory: <extensionDir>/dist/wasm
  const wasmDirectory = path.join(context.extensionPath, "dist", "wasm");

  // 4. Instantiate production TreeSitterParserAdapter with bundled WASM directory
  parser = new TreeSitterParserAdapter({
    parserRuntimeOptions: { wasmDirectory },
    grammarRegistryOptions: { wasmDirectory }
  });

  // 5. Instantiate production JavaScript/TypeScript analyzer
  analyzer = new JsTsAnalyzer();

  // 6. Instantiate core AnalysisEngine with parser and analyzer
  engine = new AnalysisEngine({
    parsers: [parser],
    analyzers: [analyzer]
  });

  // 7. Instantiate workspace state persistence adapter
  persistence = new WorkspaceStatePersistenceAdapter({
    storageUri: () => context.storageUri,
    logger: {
      info: (msg) => logger?.info(`[Storage] ${msg}`),
      warn: (msg, err) => logger?.warn(`[Storage] ${msg}`, err),
      error: (msg, err) => logger?.error(`[Storage] ${msg}`, err)
    }
  });

  // 8. Instantiate state reconciler
  reconciler = new StateReconciler();

  // 9. Instantiate VS Code diagnostic provider
  diagnosticProvider = new DriftDiagnosticProvider({ logger });
  context.subscriptions.push(diagnosticProvider);

  // 10. Instantiate AnalysisCoordinator
  coordinator = new AnalysisCoordinator({
    workspaceManager,
    engine,
    ownsEngine: true,
    persistence,
    reconciler,
    diagnosticProvider,
    logger
  });

  // 11. Instantiate and register findings tree view provider
  treeProvider = new FindingsTreeDataProvider({
    coordinator,
    logger
  });
  if (typeof vscode.window.registerTreeDataProvider === "function") {
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider("undrift.findingsView", treeProvider)
    );
  }
  context.subscriptions.push(treeProvider);

  // 12. Instantiate and register report panel manager
  reportPanelManager = new ReportPanelManager({
    coordinator,
    logger
  });
  context.subscriptions.push(reportPanelManager);

  // 13. Restore persisted session state for current workspace if available
  void coordinator
    .restoreSession()
    .then((restored) => {
      treeProvider?.handleSessionRestored(restored);
      reportPanelManager?.handleSessionRestored(restored);
    })
    .catch((err) => {
      logger?.warn("Session restoration encountered an error during activation", err);
    });

  // 13. Register workspace change events with the analysis scheduler
  const eventDisposables = coordinator.getScheduler().registerWorkspaceEvents();
  context.subscriptions.push(eventDisposables);

  // 14. Register undrift.scanWorkspace command
  const scanCommand = vscode.commands.registerCommand("undrift.scanWorkspace", async () => {
    if (!coordinator) {
      void vscode.window.showErrorMessage("UNDRIFT: Analysis coordinator is not initialized.");
      return;
    }

    try {
      const outcome = await coordinator.getScheduler().runImmediateScan();

      switch (outcome.status) {
        case "success": {
          const filesCount = outcome.result?.statistics.filesParsed ?? outcome.totalAcquired ?? 0;
          const findingsCount = outcome.result?.findings.length ?? 0;
          if (outcome.persistenceStatus === "failed") {
            const reason = outcome.persistenceError ? `: ${outcome.persistenceError}` : "";
            logger?.error(`State persistence failed${reason}`);
            void vscode.window.showWarningMessage(
              `UNDRIFT: Analysis complete (${findingsCount} finding${findingsCount === 1 ? "" : "s"}), but failed to save analysis state${reason}.`
            );
          } else {
            void vscode.window.showInformationMessage(
              `UNDRIFT: Analysis complete. Analyzed ${filesCount} file${filesCount === 1 ? "" : "s"}, found ${findingsCount} contract drift finding${findingsCount === 1 ? "" : "s"}.`
            );
          }
          break;
        }

        case "incomplete": {
          const filesCount = outcome.result?.statistics.filesParsed ?? outcome.totalAcquired ?? 0;
          const findingsCount = outcome.result?.findings.length ?? 0;
          const failuresCount = outcome.failures?.length ?? 0;
          void vscode.window.showWarningMessage(
            formatIncompleteScanMessage(filesCount, findingsCount, failuresCount)
          );
          break;
        }

        case "cancelled": {
          logger?.info("UNDRIFT: Workspace analysis was cancelled.");
          break;
        }

        case "superseded": {
          logger?.info("UNDRIFT: Workspace analysis was superseded by a newer scan.");
          break;
        }

        case "no-workspace": {
          void vscode.window.showInformationMessage(
            "UNDRIFT: No workspace folder is currently open in VS Code."
          );
          break;
        }

        case "failed": {
          const msg = outcome.errorMessage ?? "Workspace analysis failed.";
          logger?.error(`Analysis failed: ${msg}`);
          void vscode.window.showErrorMessage(`UNDRIFT: Analysis failed — ${msg}`);
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger?.error("Unexpected error executing workspace scan", err);
      void vscode.window.showErrorMessage(`UNDRIFT: Scan encountered an error: ${msg}`);
    }
  });

  context.subscriptions.push(scanCommand);

  // 15. Register undrift.refresh command
  const refreshCommand = vscode.commands.registerCommand("undrift.refresh", async () => {
    if (!coordinator) {
      void vscode.window.showErrorMessage("UNDRIFT: Analysis coordinator is not initialized.");
      return;
    }
    treeProvider?.refresh();
    await coordinator.getScheduler().runImmediateScan();
  });
  context.subscriptions.push(refreshCommand);

  // 16. Register undrift.openFindingLocation command
  const openLocationCommand = vscode.commands.registerCommand(
    "undrift.openFindingLocation",
    async (span?: SourceSpan) => {
      await openFindingLocation(span);
    }
  );
  context.subscriptions.push(openLocationCommand);

  // 17. Register undrift.showReport command
  const showReportCommand = vscode.commands.registerCommand(
    "undrift.showReport",
    async (targetFindingId?: string) => {
      if (!reportPanelManager) {
        void vscode.window.showErrorMessage("UNDRIFT: Report panel manager is not initialized.");
        return;
      }
      await reportPanelManager.show(targetFindingId);
    }
  );
  context.subscriptions.push(showReportCommand);

  logger.info("UNDRIFT extension activated successfully.");
}

/**
 * Deactivates the UNDRIFT VS Code extension and safely cleans up all resources.
 */
export async function deactivate(): Promise<void> {
  if (reportPanelManager) {
    try {
      reportPanelManager.dispose();
    } catch {
      // Ignore cleanup error on deactivation
    }
    reportPanelManager = undefined;
  }

  if (treeProvider) {
    try {
      treeProvider.dispose();
    } catch {
      // Ignore cleanup error on deactivation
    }
    treeProvider = undefined;
  }

  if (coordinator) {
    try {
      await coordinator.dispose();
    } catch {
      // Ignore cleanup error on deactivation
    }
    coordinator = undefined;
  }

  if (diagnosticProvider) {
    try {
      diagnosticProvider.dispose();
    } catch {
      // Ignore cleanup error on deactivation
    }
    diagnosticProvider = undefined;
  }

  persistence = undefined;
  reconciler = undefined;
  engine = undefined;
  parser = undefined;
  analyzer = undefined;
  workspaceManager = undefined;

  if (logger) {
    logger.dispose();
    logger = undefined;
  }
}
