// Public module exports for fix staleness validation and WorkspaceEdit translation.

export {
  FixStalenessValidator,
  validateFixProposal,
  isUriContainedInRoot,
  isUriInWorkspaceFolders,
  type ProposalValidationReasonCode,
  type ValidatedDocumentSnapshot,
  type ProposalValidationSuccess,
  type ProposalValidationFailure,
  type ProposalValidationResult,
  type DocumentBufferSnapshot,
  type DocumentTextAccessor,
  type GenerationAccessor,
  type StalenessValidatorOptions
} from "./staleness-validator";

export {
  FixApplier,
  prepareFixWorkspaceEdit,
  FixPreparationError,
  type PreparedFixEdit,
  type PrepareFixEditOptions
} from "./fix-applier";

export { FixProposalService } from "./fix-service";
export { DriftCodeActionProvider } from "./code-action-provider";
export {
  FixVerificationCoordinator,
  computeExpectedPostEditHashes,
  type FixVerificationOptions,
  type VerificationRecord,
  type VerificationSession
} from "./fix-verifier";
