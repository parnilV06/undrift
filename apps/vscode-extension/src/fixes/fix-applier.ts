// Fix proposal WorkspaceEdit translator adhering strictly to
// LLD.md Section 13.2, PRD.md Section 13.3, and Phase 5 Chunk 5.2 requirements.
// Validates target roles and maps exact UTF-16 code unit coordinates to vscode.WorkspaceEdit.
// IMPORTANT SCOPE BOUNDARY: Does NOT call workspace.applyEdit, register commands, or write to disk.

import * as vscode from "vscode";
import type { FixProposal, FixTargetRole } from "@undrift/core";
import {
  FixStalenessValidator,
  type ProposalValidationFailure,
  type ProposalValidationResult,
  type ProposalValidationSuccess,
  type StalenessValidatorOptions
} from "./staleness-validator";

/**
 * Encapsulates a safely prepared WorkspaceEdit bound to its validated proposal.
 */
export interface PreparedFixEdit {
  readonly proposal: FixProposal;
  readonly workspaceEdit: vscode.WorkspaceEdit;
  readonly targetRole: FixTargetRole;
  readonly editCount: number;
}

/**
 * Options configuring fix edit preparation and role checking.
 */
export interface PrepareFixEditOptions {
  /** Optional target role filter. If specified, must strictly match proposal.targetRole. */
  readonly expectedTargetRole?: FixTargetRole;
  /** Custom WorkspaceEdit factory seam for testing. */
  readonly workspaceEditFactory?: () => vscode.WorkspaceEdit;
  /** Custom URI parser seam for testing. */
  readonly uriParser?: (uri: string) => vscode.Uri;
}

/**
 * Custom typed error thrown when translation cannot proceed safely.
 */
export class FixPreparationError extends Error {
  constructor(
    public readonly reasonCode: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "FixPreparationError";
  }
}

/**
 * Translates a successfully validated FixProposal into a ready-to-review VS Code WorkspaceEdit.
 *
 * Enforces that only validated proposals are translated.
 * Operates purely in-memory: does NOT invoke `vscode.workspace.applyEdit` or touch filesystem APIs.
 */
export function prepareFixWorkspaceEdit(
  validation: ProposalValidationSuccess,
  options?: PrepareFixEditOptions
): PreparedFixEdit {
  // 1. Guard against unvalidated, falsy, or rejected input
  if (!validation || validation.valid !== true || !validation.proposal) {
    throw new FixPreparationError(
      "UNVALIDATED_PROPOSAL",
      "Cannot prepare WorkspaceEdit for an unvalidated or rejected fix proposal."
    );
  }

  const proposal = validation.proposal;

  // 2. Validate target role against caller expectation
  if (options?.expectedTargetRole && options.expectedTargetRole !== proposal.targetRole) {
    throw new FixPreparationError(
      "TARGET_ROLE_MISMATCH",
      `Target role mismatch: requested '${options.expectedTargetRole}', but proposal targets '${proposal.targetRole}'.`,
      { expected: options.expectedTargetRole, actual: proposal.targetRole }
    );
  }

  // 3. Reject empty or missing edits
  if (!proposal.edits || proposal.edits.length === 0) {
    throw new FixPreparationError(
      "EMPTY_PROPOSAL",
      `Fix proposal '${proposal.id}' does not contain any edits to prepare.`
    );
  }

  // 4. Construct WorkspaceEdit with exact replacement coordinates
  const createEdit = options?.workspaceEditFactory ?? (() => new vscode.WorkspaceEdit());
  const parseUri = options?.uriParser ?? ((u: string) => vscode.Uri.parse(u));
  const wsEdit = createEdit();

  for (const edit of proposal.edits) {
    if (
      !edit.documentUri ||
      !edit.start ||
      !edit.end ||
      edit.newText === undefined ||
      edit.range === undefined
    ) {
      throw new FixPreparationError(
        "MALFORMED_PROPOSAL",
        `Proposed edit '${edit.id}' contains incomplete or malformed coordinate metadata.`
      );
    }

    const uri = parseUri(edit.documentUri);
    const range = new vscode.Range(
      new vscode.Position(edit.start.line, edit.start.character),
      new vscode.Position(edit.end.line, edit.end.character)
    );

    wsEdit.replace(uri, range, edit.newText);
  }

  return {
    proposal,
    workspaceEdit: wsEdit,
    targetRole: proposal.targetRole,
    editCount: proposal.edits.length
  };
}

/**
 * High-level coordinator validating a proposal and preparing a WorkspaceEdit in one safe flow.
 */
export class FixApplier {
  private readonly validator: FixStalenessValidator;

  constructor(validator?: FixStalenessValidator) {
    this.validator = validator ?? new FixStalenessValidator();
  }

  /**
   * Validates the proposal and prepares its WorkspaceEdit if valid.
   * Returns validation failure without preparing edits if any check fails.
   */
  async validateAndPrepare(
    proposal: FixProposal,
    options?: StalenessValidatorOptions & PrepareFixEditOptions
  ): Promise<
    | { success: true; preparedEdit: PreparedFixEdit; validation: ProposalValidationSuccess }
    | { success: false; validation: ProposalValidationFailure }
  > {
    const validationResult: ProposalValidationResult = await this.validator.validateProposal(
      proposal,
      options
    );

    if (!validationResult.valid) {
      return {
        success: false,
        validation: validationResult
      };
    }

    const preparedEdit = prepareFixWorkspaceEdit(validationResult, options);

    return {
      success: true,
      preparedEdit,
      validation: validationResult
    };
  }
}
