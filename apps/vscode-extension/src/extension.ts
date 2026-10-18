// VS Code extension entry point for UNDRIFT.
// Connects the workspace source-snapshot module and registers the workspace scan command.

import * as vscode from "vscode";
import { WorkspaceManager } from "./workspace";

let workspaceManager: WorkspaceManager | undefined;

/**
 * Activates the UNDRIFT VS Code extension.
 */
export function activate(context: vscode.ExtensionContext): void {
  workspaceManager = new WorkspaceManager();

  const scanCommand = vscode.commands.registerCommand("undrift.scanWorkspace", async () => {
    if (!workspaceManager) {
      return;
    }
    const result = await workspaceManager.createWorkspaceSnapshot();
    void vscode.window.showInformationMessage(
      `UNDRIFT: Discovered ${result.totalDiscovered} files (${result.totalAcquired} acquired, status: ${result.status}).`
    );
  });

  context.subscriptions.push(scanCommand);
}

/**
 * Deactivates the UNDRIFT VS Code extension and cleans up resources.
 */
export function deactivate(): void {
  workspaceManager = undefined;
}
