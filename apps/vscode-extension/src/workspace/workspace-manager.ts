// High-level workspace manager coordinating source discovery and snapshots.
// As specified in LLD.md Section 3 and Section 4.4.

import type { DocumentUri, SourceDocument } from "@undrift/core";
import {
  WorkspaceSourceSnapshotProvider,
  type WorkspaceAccessor,
  type WorkspaceSnapshotOptions,
  type WorkspaceSnapshotResult
} from "./source-snapshot-provider";

/**
 * High-level manager coordinating workspace discovery, folder resolution,
 * and immutable source snapshots for UNDRIFT.
 */
export class WorkspaceManager {
  private readonly provider: WorkspaceSourceSnapshotProvider;
  private readonly accessor?: WorkspaceAccessor;

  constructor(accessor?: WorkspaceAccessor, options?: WorkspaceSnapshotOptions) {
    this.accessor = accessor;
    this.provider = new WorkspaceSourceSnapshotProvider(accessor, options);
  }

  /**
   * Returns the underlying WorkspaceSourceSnapshotProvider instance.
   */
  getSnapshotProvider(): WorkspaceSourceSnapshotProvider {
    return this.provider;
  }

  /**
   * Returns the list of active workspace root URIs.
   */
  getWorkspaceRoots(): DocumentUri[] {
    if (this.accessor) {
      const folders = this.accessor.getWorkspaceFolders();
      return folders ? folders.map((f) => f.uri.toString()) : [];
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const vscode = require("vscode");
      const folders = vscode.workspace.workspaceFolders;
      return folders ? folders.map((f: { uri: { toString(): string } }) => f.uri.toString()) : [];
    } catch {
      return [];
    }
  }

  /**
   * Discovers supported files in the workspace and acquires an immutable SourceDocument snapshot.
   */
  async createWorkspaceSnapshot(cancellationToken?: {
    isCancellationRequested: boolean;
  }): Promise<WorkspaceSnapshotResult> {
    return this.provider.createSnapshot(cancellationToken);
  }

  /**
   * Captures a single source-document snapshot for a specific file URI.
   */
  async captureDocument(uri: DocumentUri): Promise<SourceDocument> {
    return this.provider.captureDocument(uri);
  }
}
