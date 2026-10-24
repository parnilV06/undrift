// VS Code CodeActionProvider offering review actions for candidate fix proposals
// adhering strictly to LLD.md Section 13.3, PRD.md Section 13.3, and Phase 5 Chunk 5.3.

import * as vscode from "vscode";
import type { FixProposalService } from "./fix-service";

function getCodeActionKind(): typeof vscode.CodeActionKind {
  try {
    const mod = vscode as unknown as Record<string, unknown>;
    const kind = mod.CodeActionKind as typeof vscode.CodeActionKind | undefined;
    if (kind) return kind;
  } catch {
    // Vitest mock without CodeActionKind export
  }
  return {
    QuickFix: { value: "quickfix" }
  } as unknown as typeof vscode.CodeActionKind;
}

function getCodeActionClass(): typeof vscode.CodeAction {
  try {
    const mod = vscode as unknown as Record<string, unknown>;
    const cls = mod.CodeAction as typeof vscode.CodeAction | undefined;
    if (cls) return cls;
  } catch {
    // Vitest mock without CodeAction export
  }
  return class MockCodeAction {
    public isPreferred?: boolean;
    public diagnostics?: vscode.Diagnostic[];
    public command?: vscode.Command;
    constructor(
      public title: string,
      public kind?: vscode.CodeActionKind
    ) {}
  } as unknown as typeof vscode.CodeAction;
}

/**
 * Provider contributing reviewable QuickFix code actions for detected contract drift findings.
 * Selecting an action navigates the developer to the Integration Report review panel.
 * Never applies edits automatically.
 */
export class DriftCodeActionProvider implements vscode.CodeActionProvider {
  public static get providedCodeActionKinds(): readonly vscode.CodeActionKind[] {
    return [getCodeActionKind().QuickFix];
  }

  constructor(private readonly fixService: FixProposalService) {}

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token?: vscode.CancellationToken
  ): vscode.CodeAction[] {
    const uriStr = document.uri.toString();

    // Query candidate proposals for this document and range
    const matches = this.fixService.getProposalsForDocument(uriStr, {
      start: { line: range.start.line, character: range.start.character },
      end: { line: range.end.line, character: range.end.character }
    });

    if (matches.length === 0) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];
    const seenProposalIds = new Set<string>();

    for (const { proposal, finding } of matches) {
      if (seenProposalIds.has(proposal.id)) {
        continue;
      }
      seenProposalIds.add(proposal.id);

      // Only UND120 method-conflict proposals are supported in this chunk
      if (finding.ruleId !== "UND120") {
        continue;
      }

      // Format distinct review action labels
      const roleLabel = proposal.targetRole === "consumer" ? "consumer-side" : "provider-side";
      const title = `UNDRIFT: Review ${roleLabel} method repair`;

      const CodeActionClass = getCodeActionClass();
      const codeActionKind = getCodeActionKind();
      const action = new CodeActionClass(title, codeActionKind.QuickFix);
      action.isPreferred = false;

      // Associate with relevant diagnostics in the context
      if (context.diagnostics && context.diagnostics.length > 0) {
        const matchingDiags = context.diagnostics.filter(
          (d) =>
            d.source === "UNDRIFT" &&
            (typeof d.code === "string" ? d.code === finding.ruleId : true)
        );
        if (matchingDiags.length > 0) {
          action.diagnostics = [...matchingDiags];
        }
      }

      // Invokes report review flow; NEVER applies edit immediately
      action.command = {
        command: "undrift.showReport",
        title: "Review Repair Proposal",
        arguments: [finding.id, proposal.id]
      };

      actions.push(action);
    }

    return actions;
  }
}
