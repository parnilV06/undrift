import * as vscode from "vscode";
import { UNDRIFT_CORE_VERSION } from "@undrift/core";

export function activate(context: vscode.ExtensionContext): void {
  const scanCommand = vscode.commands.registerCommand("undrift.scanWorkspace", async () => {
    void vscode.window.showInformationMessage(
      `UNDRIFT core ${UNDRIFT_CORE_VERSION}: workspace scan will be implemented next.`
    );
  });

  const reportCommand = vscode.commands.registerCommand("undrift.showReport", async () => {
    void vscode.window.showInformationMessage("UNDRIFT integration report will be implemented next.");
  });

  context.subscriptions.push(scanCommand, reportCommand);
}

export function deactivate(): void {
  // Reserved for future cleanup of watchers and analysis workers.
}
