// Custom error hierarchy for state persistence operations strictly adhering to
// LLD.md Sections 5.6, 14.10, 16.4, and 17.

/**
 * Error thrown when workspace storage is unavailable (e.g., ExtensionContext.storageUri is undefined).
 */
export class StorageUnavailableError extends Error {
  readonly code = "STORAGE_UNAVAILABLE";

  constructor(
    message = "Workspace storage is unavailable (ExtensionContext.storageUri is undefined)."
  ) {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

/**
 * Error thrown when an unexpected I/O failure occurs while accessing persistent storage.
 */
export class StorageIOError extends Error {
  readonly code = "STORAGE_IO_ERROR";

  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "StorageIOError";
  }
}

/**
 * Error thrown when a record or operation does not match the expected workspace identity.
 */
export class WorkspaceMismatchError extends Error {
  readonly code = "WORKSPACE_MISMATCH";

  constructor(message: string) {
    super(message);
    this.name = "WorkspaceMismatchError";
  }
}

/**
 * Error thrown when an incomplete analysis snapshot is attempted to be saved
 * as the latest complete analysis snapshot.
 */
export class IncompleteSnapshotError extends Error {
  readonly code = "INCOMPLETE_SNAPSHOT";

  constructor(message = "Cannot save incomplete snapshot as latest complete analysis snapshot.") {
    super(message);
    this.name = "IncompleteSnapshotError";
  }
}

/**
 * Error thrown internally when persisted data is malformed, corrupted, or violates schema contracts.
 */
export class CorruptedRecordError extends Error {
  readonly code = "CORRUPTED_RECORD";

  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "CorruptedRecordError";
  }
}
