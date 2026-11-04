// VS Code HoverProvider for UNDRIFT contract drift findings and coverage limitations
// strictly adhering to LLD.md Section 14, PRD.md Section 12, and Phase 6.4.

import * as vscode from "vscode";
import { type SourceSpan, getDiagnosticGuidance } from "@undrift/core";
import type { AnalysisCoordinator } from "../activation/coordinator";
import type { FixProposalService } from "../fixes/fix-service";
import {
  parseDocumentUri,
  sourceSpanToVsCodeRange,
  type DiagnosticFindingSource,
  type DriftDiagnosticProvider
} from "./diagnostic-provider";

/**
 * Options for configuring DriftHoverProvider.
 */
export interface DriftHoverProviderOptions {
  coordinator?: AnalysisCoordinator;
  diagnosticProvider?: DriftDiagnosticProvider;
  fixService?: FixProposalService;
  vscodeModule?: typeof vscode;
}

/**
 * Normalizes document URI to string for consistent comparison.
 */
function normalizeUriKey(uriOrStr?: string | vscode.Uri): string {
  if (!uriOrStr) return "";
  if (typeof uriOrStr === "string") {
    const parsed = parseDocumentUri(uriOrStr);
    return parsed ? parsed.toString() : uriOrStr;
  }
  return uriOrStr.toString();
}

/**
 * Checks if a given VS Code position falls within a SourceSpan.
 */
export function isPositionInSpan(span: SourceSpan, pos: vscode.Position): boolean {
  if (!span.start) return false;
  const startLine = span.start.line;
  const startChar = span.start.character;
  const endLine = span.end ? span.end.line : startLine;
  const endChar = span.end ? span.end.character : startChar;

  if (pos.line < startLine || pos.line > endLine) return false;
  if (pos.line === startLine && pos.character < startChar) return false;
  if (pos.line === endLine && pos.character > endChar) return false;
  return true;
}

/**
 * VS Code HoverProvider offering contextual contract explanations, fix availability status,
 * recommended actions, and one-click navigation to the Integration Report.
 */
export class DriftHoverProvider implements vscode.HoverProvider {
  private readonly coordinator?: AnalysisCoordinator;
  private readonly diagnosticProvider?: DriftDiagnosticProvider;
  private readonly fixService?: FixProposalService;
  private readonly vscodeModule?: typeof vscode;

  constructor(options?: DriftHoverProviderOptions) {
    this.coordinator = options?.coordinator;
    this.diagnosticProvider = options?.diagnosticProvider;
    this.fixService = options?.fixService;
    this.vscodeModule = options?.vscodeModule;
  }

  private getVsCode(): typeof vscode {
    if (this.vscodeModule) return this.vscodeModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("vscode");
    } catch {
      return vscode;
    }
  }

  /**
   * Provides hover content when the developer points at an active finding span.
   */
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token?: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const vs = this.getVsCode();
    const docUriKey = normalizeUriKey(document.uri);
    if (!docUriKey) return undefined;

    // 1. Resolve active workspace findings from coordinator snapshot
    const wsId =
      typeof this.coordinator?.getActiveWorkspaceId === "function"
        ? this.coordinator.getActiveWorkspaceId()
        : undefined;
    const snapshot =
      wsId && typeof this.coordinator?.getLastKnownSnapshot === "function"
        ? this.coordinator.getLastKnownSnapshot(wsId)
        : undefined;
    const acceptedResult =
      wsId && typeof this.coordinator?.getLastAcceptedAnalysisResult === "function"
        ? this.coordinator.getLastAcceptedAnalysisResult(wsId)
        : undefined;

    const allFindings: readonly DiagnosticFindingSource[] =
      acceptedResult?.findings ?? snapshot?.findings ?? [];
    const activeFindings = allFindings.filter((f) => f.state !== "resolved");

    if (activeFindings.length === 0) {
      return undefined;
    }

    // 2. Identify finding(s) that match the document and hovered position
    const matchedFindings: DiagnosticFindingSource[] = [];
    let primaryRange: vscode.Range | undefined;

    for (const finding of activeFindings) {
      const locations = finding.sourceLocations ?? [];
      const matchingSpan = locations.find((loc) => {
        const locUriKey = normalizeUriKey(loc.uri);
        return locUriKey === docUriKey && isPositionInSpan(loc, position);
      });

      if (matchingSpan) {
        matchedFindings.push(finding);
        if (!primaryRange) {
          primaryRange = sourceSpanToVsCodeRange(matchingSpan);
        }
      }
    }

    // Fallback: If not matched directly by source span, check diagnostics from diagnosticProvider
    if (matchedFindings.length === 0 && this.diagnosticProvider) {
      const diags = this.diagnosticProvider.getDiagnostics(document.uri);
      for (const diag of diags) {
        if (diag.range && diag.range.contains(position)) {
          const matched = activeFindings.find((f) => f.ruleId === diag.code);
          if (matched && !matchedFindings.includes(matched)) {
            matchedFindings.push(matched);
            if (!primaryRange) {
              primaryRange = diag.range;
            }
          }
        }
      }
    }

    if (matchedFindings.length === 0) {
      return undefined;
    }

    // 3. Construct rich Markdown hover content
    const contents: vscode.MarkdownString[] = [];

    for (let i = 0; i < matchedFindings.length; i++) {
      const finding = matchedFindings[i];

      // Check if candidate proposals exist
      let hasProposals = false;
      if (this.fixService) {
        const proposals = this.fixService.getProposalsForFinding(finding.id, wsId);
        hasProposals = proposals.length > 0;
      } else if (
        "fixProposalIds" in finding &&
        Array.isArray(finding.fixProposalIds) &&
        finding.fixProposalIds.length > 0
      ) {
        hasProposals = true;
      }

      const guidance = getDiagnosticGuidance({
        ruleId: finding.ruleId,
        method:
          "method" in finding && typeof finding.method === "string" ? finding.method : undefined,
        route: "route" in finding && typeof finding.route === "string" ? finding.route : undefined,
        targetKey:
          "targetKey" in finding && typeof finding.targetKey === "string"
            ? finding.targetKey
            : undefined,
        expectedDescription:
          "expectedDescription" in finding && typeof finding.expectedDescription === "string"
            ? finding.expectedDescription
            : undefined,
        observedDescription:
          "observedDescription" in finding && typeof finding.observedDescription === "string"
            ? finding.observedDescription
            : undefined,
        summary: finding.summary,
        possibleImpact:
          "impactStatement" in finding && typeof finding.impactStatement === "string"
            ? finding.impactStatement
            : undefined,
        hasAutomatedFix: hasProposals,
        finding: "observationIds" in finding ? finding : undefined
      });

      const md = new vs.MarkdownString("", true);
      md.isTrusted = true;
      md.supportHtml = true;

      // 1. Canonical rule title and code
      md.appendMarkdown(`**UNDRIFT: ${finding.ruleId} — ${guidance.title}**\n\n`);

      // 2. Short explanation of what was detected
      const explanation = guidance.conciseExplanation ?? guidance.whatDetected;
      md.appendMarkdown(`${explanation}\n\n`);

      // 3. Concise explanation of why an automatic fix is unavailable
      if (hasProposals) {
        md.appendMarkdown(
          `**Automatic Fix:** Candidate repair proposals available via Quick Fix (\`Ctrl+.\` / \`Cmd+.\`) or Integration Report.\n\n`
        );
      } else {
        const noFixReason =
          guidance.conciseFixUnavailableReason ??
          guidance.whyNoAutomatedFix ??
          "No automated safe repair proposals are available for this finding.";
        md.appendMarkdown(`**Why no automatic fix?**\n\n${noFixReason}\n\n`);
      }

      // 4. One recommended next action
      if (guidance.suggestedSteps.length > 0) {
        md.appendMarkdown(`**Recommended Action:** ${guidance.suggestedSteps[0]}\n\n`);
      }

      // 5. Link to the full Resolution Guidance in the Integration Report
      const reportArgs = encodeURIComponent(JSON.stringify([finding.id]));
      md.appendMarkdown(
        `[Open full Resolution Guidance in Integration Report](command:undrift.showReport?${reportArgs})`
      );

      contents.push(md);
    }

    return new vs.Hover(contents, primaryRange);
  }
}
