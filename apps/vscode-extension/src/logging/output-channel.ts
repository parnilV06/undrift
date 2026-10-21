// Extension logging facade directing diagnostic logs to a dedicated VS Code OutputChannel
// as specified in LLD.md Section 14.1 and Chunk 4.2.

import type { OutputChannel } from "vscode";

/**
 * Diagnostic logger interface used by extension services.
 */
export interface ExtensionLogger {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
  show(): void;
  dispose(): void;
}

/**
 * OutputChannel logger directing logs to VS Code's output panel.
 */
export class OutputChannelLogger implements ExtensionLogger {
  private channel?: OutputChannel;

  constructor(private readonly channelName = "UNDRIFT") {}

  private getChannel(): OutputChannel {
    if (!this.channel) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vscode = require("vscode");
      this.channel = vscode.window.createOutputChannel(this.channelName);
    }
    return this.channel!;
  }

  info(message: string): void {
    const timestamp = new Date().toISOString();
    this.getChannel().appendLine(`[${timestamp}] [INFO] ${message}`);
  }

  warn(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    const errSuffix = error
      ? ` Error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      : "";
    this.getChannel().appendLine(`[${timestamp}] [WARN] ${message}${errSuffix}`);
  }

  error(message: string, error?: unknown): void {
    const timestamp = new Date().toISOString();
    const errSuffix = error
      ? ` Error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      : "";
    this.getChannel().appendLine(`[${timestamp}] [ERROR] ${message}${errSuffix}`);
  }

  show(): void {
    this.channel?.show(true);
  }

  dispose(): void {
    this.channel?.dispose();
    this.channel = undefined;
  }
}
