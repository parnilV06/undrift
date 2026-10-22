// Public exports for extension activation and coordination.

export {
  AnalysisCoordinator,
  deriveWorkspaceId,
  CancellationTokenSourceLike,
  type AnalysisCoordinatorOptions,
  type CoordinatorAnalysisResult,
  type CoordinatorOutcomeStatus,
  type CancellationTokenLike,
  type SessionRestorationStatus,
  type RestoredSessionState,
  type PersistenceOutcomeStatus
} from "./coordinator";

export {
  AnalysisScheduler,
  DEFAULT_DEBOUNCE_DELAY_MS,
  type AnalysisSchedulerOptions,
  type WorkspaceEventSource
} from "./scheduler";
