// VS Code extension entry point for UNDRIFT.
// Wires the production Tree-sitter parser adapter, JavaScript/TypeScript analyzer,
// core analysis engine, and analysis coordinator to VS Code commands and lifecycle.

import * as path from "path";
import * as vscode from "vscode";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { AnalysisEngine, type SourceSpan, StateReconciler } from "@undrift/core";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { AnalysisCoordinator } from "./activation";
import { registerCommands, formatIncompleteScanMessage } from "./commands";
import { DriftDiagnosticProvider, DriftHoverProvider } from "./diagnostics";
import { DriftCodeActionProvider, FixProposalService, FixVerificationCoordinator } from "./fixes";
import { OutputChannelLogger } from "./logging";
import { DriftStatusBar } from "./status";
import { WorkspaceStatePersistenceAdapter } from "./storage";
import {
  FindingsTreeDataProvider,
  openFindingLocation,
  OverviewViewProvider,
  ReportPanelManager
} from "./views";
import { WorkspaceManager } from "./workspace";

export { formatIncompleteScanMessage };

let logger: OutputChannelLogger | undefined;
let workspaceManager: WorkspaceManager | undefined;
let parser: TreeSitterParserAdapter | undefined;
let analyzer: JsTsAnalyzer | undefined;
let engine: AnalysisEngine | undefined;
let persistence: WorkspaceStatePersistenceAdapter | undefined;
let reconciler: StateReconciler | undefined;
let diagnosticProvider: DriftDiagnosticProvider | undefined;
let treeProvider: FindingsTreeDataProvider | undefined;
let treeView: vscode.TreeView<unknown> | undefined;
let overviewProvider: OverviewViewProvider | undefined;
let reportPanelManager: ReportPanelManager | undefined;
let statusBar: DriftStatusBar | undefined;
let coordinator: AnalysisCoordinator | undefined;
let fixService: FixProposalService | undefined;
let verificationCoordinator: FixVerificationCoordinator | undefined;
let codeActionProvider: DriftCodeActionProvider | undefined;
let hoverProvider: DriftHoverProvider | undefined;

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

  // 10b. Instantiate FixProposalService
  fixService = new FixProposalService(coordinator);

  // 10c. Register CodeActionProvider for supported languages
  codeActionProvider = new DriftCodeActionProvider(fixService);
  const languageFilters: vscode.DocumentFilter[] = [
    { language: "javascript" },
    { language: "typescript" },
    { language: "javascriptreact" },
    { language: "typescriptreact" }
  ];
  if (typeof vscode.languages?.registerCodeActionsProvider === "function") {
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(languageFilters, codeActionProvider, {
        providedCodeActionKinds: DriftCodeActionProvider.providedCodeActionKinds
      })
    );
  }

  // 10d. Register HoverProvider for supported languages
  hoverProvider = new DriftHoverProvider({
    coordinator,
    diagnosticProvider,
    fixService
  });
  if (typeof vscode.languages?.registerHoverProvider === "function") {
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(languageFilters, hoverProvider)
    );
  }

  // Helper to synchronize numeric badge across Activity Bar views
  const syncActivityBarBadge = (count: number) => {
    const badge =
      count > 0
        ? {
            value: count,
            tooltip: `${count} active drift finding${count === 1 ? "" : "s"} in the current workspace`
          }
        : undefined;

    if (treeView) {
      treeView.badge = badge;
    }
    const wv = overviewProvider?.getWebviewView();
    if (wv) {
      wv.badge = badge;
    }
  };

  // 11. Instantiate and register findings tree view provider
  treeProvider = new FindingsTreeDataProvider({
    coordinator,
    logger
  });
  if (typeof vscode.window.createTreeView === "function") {
    treeView = vscode.window.createTreeView("undrift.findingsView", {
      treeDataProvider: treeProvider
    });
    context.subscriptions.push(treeView);
  } else if (typeof vscode.window.registerTreeDataProvider === "function") {
    context.subscriptions.push(
      vscode.window.registerTreeDataProvider("undrift.findingsView", treeProvider)
    );
  }
  context.subscriptions.push(treeProvider);

  // 11b. Instantiate and register persistent sidebar overview provider
  overviewProvider = new OverviewViewProvider({
    coordinator,
    logger,
    extensionUri: context.extensionUri
  });
  if (typeof vscode.window.registerWebviewViewProvider === "function") {
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("undrift.overview", overviewProvider)
    );
  }
  context.subscriptions.push(overviewProvider);

  // 11c. Subscribe to coordinator analysis completion for badge synchronization
  context.subscriptions.push(
    coordinator.onAnalysisCompleted((outcome) => {
      const wsId = outcome.workspaceId ?? coordinator?.getActiveWorkspaceId();
      if (wsId) {
        const snap = coordinator?.getLastKnownSnapshot(wsId);
        const activeCount = snap?.findings.filter((f) => f.state !== "resolved").length ?? 0;
        syncActivityBarBadge(activeCount);
      } else {
        syncActivityBarBadge(0);
      }
    })
  );

  // 12. Instantiate and register report panel manager
  reportPanelManager = new ReportPanelManager({
    coordinator,
    fixService,
    logger,
    extensionUri: context.extensionUri
  });
  context.subscriptions.push(reportPanelManager);

  // 12b. Instantiate fix verification coordinator
  verificationCoordinator = new FixVerificationCoordinator({
    coordinator,
    fixService,
    reportPanelManager,
    logger
  });
  fixService.setVerificationCoordinator(verificationCoordinator);
  context.subscriptions.push(verificationCoordinator);

  // 13. Instantiate status bar item
  statusBar = new DriftStatusBar({
    coordinator,
    logger
  });
  context.subscriptions.push(statusBar);

  // 14. Restore persisted session state for current workspace if available
  void coordinator
    .restoreSession()
    .then((restored) => {
      treeProvider?.handleSessionRestored(restored);
      reportPanelManager?.handleSessionRestored(restored);
      overviewProvider?.handleSessionRestored(restored);
      statusBar?.handleSessionRestored(restored);

      const activeCount =
        restored.snapshot?.findings.filter((f) => f.state !== "resolved").length ?? 0;
      syncActivityBarBadge(activeCount);
    })
    .catch((err) => {
      logger?.warn("Session restoration encountered an error during activation", err);
    });

  // 15. Register workspace change events with the analysis scheduler
  const eventDisposables = coordinator.getScheduler().registerWorkspaceEvents();
  context.subscriptions.push(eventDisposables);

  // 16. Register all extension commands
  const commandDisposables = registerCommands({
    coordinator,
    reportPanelManager,
    treeProvider,
    statusBar,
    fixService,
    verificationCoordinator,
    logger
  });
  for (const disposable of commandDisposables) {
    context.subscriptions.push(disposable);
  }

  logger.info("UNDRIFT extension activated successfully.");
}

/**
 * Deactivates the UNDRIFT VS Code extension and safely cleans up all resources.
 */
export async function deactivate(): Promise<void> {
  if (statusBar) {
    try {
      statusBar.dispose();
    } catch {
      // Ignore cleanup error on deactivation
    }
    statusBar = undefined;
  }

  if (reportPanelManager) {
    try {
      reportPanelManager.dispose();
    } catch {
      // Ignore cleanup error on deactivation
    }
    reportPanelManager = undefined;
  }

  if (overviewProvider) {
    try {
      overviewProvider.dispose();
    } catch {
      // Ignore cleanup error on deactivation
    }
    overviewProvider = undefined;
  }

  if (treeView) {
    try {
      treeView.dispose();
    } catch {
      // Ignore cleanup error on deactivation
    }
    treeView = undefined;
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

  if (verificationCoordinator) {
    try {
      verificationCoordinator.dispose();
    } catch {
      // Ignore cleanup error on deactivation
    }
    verificationCoordinator = undefined;
  }

  persistence = undefined;
  reconciler = undefined;
  engine = undefined;
  parser = undefined;
  analyzer = undefined;
  workspaceManager = undefined;
  codeActionProvider = undefined;
  hoverProvider = undefined;
  fixService = undefined;

  if (logger) {
    logger.dispose();
    logger = undefined;
  }
}
