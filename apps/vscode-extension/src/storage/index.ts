// Public exports for workspace state persistence module.

export {
  StorageUnavailableError,
  StorageIOError,
  WorkspaceMismatchError,
  IncompleteSnapshotError,
  CorruptedRecordError
} from "./errors";

export {
  type StorageFileSystem,
  type InMemoryStorageFileSystem,
  createVsCodeStorageFileSystem,
  createNodeStorageFileSystem,
  createInMemoryStorageFileSystem,
  joinStorageUri
} from "./storage-filesystem";

export {
  isFileNotFound,
  validateSnapshot,
  validateLifecycleEvent,
  validateLifecycleHistory
} from "./storage-validator";

export {
  WorkspaceStatePersistenceAdapter,
  getWorkspaceStorageKey,
  type StorageLogger,
  type StatePersistenceAdapterOptions
} from "./state-persistence-adapter";
