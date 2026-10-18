// Workspace module exports for discovery, exclusion, and source snapshotting.

export {
  SUPPORTED_EXTENSIONS,
  DEFAULT_EXCLUDE_GLOBS,
  computeContentHash,
  extensionToLanguageId,
  isSupportedSourceFile,
  isPathExcluded,
  WorkspaceSourceSnapshotProvider,
  type SupportedFileExtension,
  type UriLike,
  type WorkspaceFolderLike,
  type OpenDocumentAccessor,
  type WorkspaceAccessor,
  type WorkspaceSnapshotStatus,
  type WorkspaceSnapshotFailure,
  type WorkspaceSnapshotResult,
  type WorkspaceSnapshotOptions
} from "./source-snapshot-provider";

export { WorkspaceManager } from "./workspace-manager";
