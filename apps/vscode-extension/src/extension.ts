// VS Code extension entry point for UNDRIFT.
// Wires the production Tree-sitter parser adapter, JavaScript/TypeScript analyzer,
// core analysis engine, and analysis coordinator to VS Code commands and lifecycle.

import * as path from "path";
import * as vscode from "vscode";
import { JsTsAnalyzer } from "@undrift/analyzer-js-ts";
import { AnalysisEngine } from "@undrift/core";
import { TreeSitterParserAdapter } from "@undrift/parser-tree-sitter";
import { AnalysisCoordinator } from "./activation";
import { OutputChannelLogger } from "./logging";
import { WorkspaceManager } from "./workspace";

let logger: OutputChannelLogger | undefined;
let workspaceManager: WorkspaceManager | undefined;
let parser: TreeSitterParserAdapter | undefined;
let analyzer: JsTsAnalyzer | undefined;
let engine: AnalysisEngine | undefined;
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

  // 7. Instantiate AnalysisCoordinator
  coordinator = new AnalysisCoordinator({
    workspaceManager,
    engine,
    ownsEngine: true,
    logger
  });

  // 8. Register undrift.scanWorkspace command
  const scanCommand = vscode.commands.registerCommand("undrift.scanWorkspace", async () => {
    if (!coordinator) {
      void vscode.window.showErrorMessage("UNDRIFT: Analysis coordinator is not initialized.");
      return;
    }

    try {
      const outcome = await coordinator.runWorkspaceScan();

      switch (outcome.status) {
        case "success": {
          const filesCount = outcome.result?.statistics.filesParsed ?? outcome.totalAcquired ?? 0;
          const findingsCount = outcome.result?.findings.length ?? 0;
          void vscode.window.showInformationMessage(
            `UNDRIFT: Analysis complete. Analyzed ${filesCount} file${filesCount === 1 ? "" : "s"}, found ${findingsCount} contract drift finding${findingsCount === 1 ? "" : "s"}.`
          );
          break;
        }

        case "incomplete": {
          const filesCount = outcome.result?.statistics.filesParsed ?? outcome.totalAcquired ?? 0;
          const findingsCount = outcome.result?.findings.length ?? 0;
          const failuresCount = outcome.failures?.length ?? 0;
          void vscode.window.showWarningMessage(
            `UNDRIFT: Analysis incomplete (${failuresCount} file${failuresCount === 1 ? "" : "s"} could not be acquired). Analyzed ${filesCount} file${filesCount === 1 ? "" : "s"}, found ${findingsCount} finding${findingsCount === 1 ? "" : "s"}.`
          );
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

  logger.info("UNDRIFT extension activated successfully.");
}

/**
 * Deactivates the UNDRIFT VS Code extension and safely cleans up all resources.
 */
export async function deactivate(): Promise<void> {
  if (coordinator) {
    try {
      await coordinator.dispose();
    } catch {
      // Ignore cleanup error on deactivation
    }
    coordinator = undefined;
  }

  engine = undefined;
  parser = undefined;
  analyzer = undefined;
  workspaceManager = undefined;

  if (logger) {
    logger.dispose();
    logger = undefined;
  }
}
