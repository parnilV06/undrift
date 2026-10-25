// Native VS Code Integration Report & Finding Details Webview Panel for UNDRIFT
// strictly adhering to LLD.md Sections 14.3, 14.6, 14.8, 14.9, and Chunk 4.7 specification.

import * as crypto from "crypto";
import type * as vscode from "vscode";
import type {
  AnalysisCoverageSummary,
  AnalysisWarning,
  EvidenceStrength,
  FindingCategory,
  FindingLifecycleEvent,
  FindingLifecycleTransition,
  FindingSeverity,
  FixProposal,
  SourceSpan,
  WorkspaceId
} from "@undrift/core";
import type {
  AnalysisCoordinator,
  CoordinatorAnalysisResult,
  RestoredSessionState
} from "../activation/coordinator";
import type { DiagnosticFindingSource } from "../diagnostics";
import type { FixProposalService } from "../fixes/fix-service";
import type { ExtensionLogger } from "../logging/output-channel";
import { openFindingLocation, type VerificationState } from "./findings-tree";

/**
 * Presentation view model consumed by the Integration Report Webview.
 */
export interface ReportViewModel {
  readonly workspaceId?: WorkspaceId;
  readonly workspaceLabel: string;
  readonly status: VerificationState;
  readonly timestamp?: string;
  readonly statusMessage?: string;
  readonly findings: readonly DiagnosticFindingSource[];
  readonly provisionalFindings?: readonly DiagnosticFindingSource[];
  readonly history: readonly FindingLifecycleEvent[];
  readonly warnings: readonly AnalysisWarning[];
  readonly coverage?: AnalysisCoverageSummary;
  readonly targetFindingId?: string;
  readonly targetProposalId?: string;
  readonly proposalsByFinding?: ReadonlyMap<string, readonly FixProposal[]>;
}

/**
 * Inbound messages sent from webview to extension host.
 */
export interface OpenLocationMessage {
  readonly command: "openLocation";
  readonly span: SourceSpan;
}

export interface TriggerScanMessage {
  readonly command: "scanWorkspace" | "refresh";
}

export interface ApplyFixMessage {
  readonly command: "applyFix";
  readonly proposalId: string;
}

export type ReportWebviewMessage = OpenLocationMessage | TriggerScanMessage | ApplyFixMessage;

/**
 * Options for configuring ReportPanelManager.
 */
export interface ReportPanelManagerOptions {
  coordinator?: AnalysisCoordinator;
  fixService?: FixProposalService;
  vscodeModule?: typeof vscode;
  logger?: ExtensionLogger;
}

interface WorkspaceReportState {
  workspaceId: WorkspaceId;
  status: VerificationState;
  timestamp?: string;
  message?: string;
  findings: readonly DiagnosticFindingSource[];
  provisionalFindings?: readonly DiagnosticFindingSource[];
  history: readonly FindingLifecycleEvent[];
  warnings: readonly AnalysisWarning[];
  coverage?: AnalysisCoverageSummary;
}

/**
 * Escapes raw strings for safe HTML interpolation to prevent XSS.
 */
export function escapeHtml(str: string | null | undefined): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Formats ISO timestamps or unix epoch numbers into readable locale strings.
 */
export function formatTimestamp(isoOrEpoch?: string | number): string {
  if (!isoOrEpoch) return "unknown time";
  try {
    const d = typeof isoOrEpoch === "number" ? new Date(isoOrEpoch) : new Date(isoOrEpoch);
    if (isNaN(d.getTime())) return String(isoOrEpoch);
    return d.toLocaleString();
  } catch {
    return String(isoOrEpoch);
  }
}

/**
 * Extracts filename basename from a document URI string safely.
 */
export function extractBaseName(uriStr?: string): string {
  if (!uriStr) return "";
  try {
    const normalized = uriStr.replace(/\\/g, "/");
    return normalized.split("/").pop() ?? uriStr;
  } catch {
    return uriStr;
  }
}

/**
 * Formats structured expected or observed contract values readably without raw unformatted dumps.
 */
export function formatContractValue(val: unknown): string {
  if (val === undefined || val === null) {
    return "";
  }
  if (typeof val === "string") {
    return escapeHtml(val);
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  try {
    const json = JSON.stringify(val, null, 2);
    return escapeHtml(json);
  } catch {
    return escapeHtml(String(val));
  }
}

/**
 * Generates random cryptographic nonce for Webview Content Security Policy.
 */
export function generateNonce(): string {
  try {
    return crypto.randomBytes(16).toString("hex");
  } catch {
    return "nonce-" + Math.random().toString(36).slice(2);
  }
}

/**
 * Pure function rendering the complete, self-contained HTML for the Integration Report Webview.
 * Fully decoupled from VS Code APIs for fast, deterministic unit testing.
 */
export function renderReportHtml(model: ReportViewModel, nonce = generateNonce()): string {
  const activeFindings = model.findings.filter((f) => f.state !== "resolved");
  const errorCount = activeFindings.filter((f) => f.severity === "error").length;
  const warningCount = activeFindings.filter((f) => f.severity === "warning").length;
  const infoCount = activeFindings.filter((f) => f.severity === "info").length;

  const categoryLabels: Record<FindingCategory, string> = {
    existence: "Missing Endpoint",
    route: "Route Parameter",
    "request-shape": "Request Shape",
    "response-shape": "Response Shape",
    type: "Type Mismatch",
    "analysis-limit": "Analysis Limitation"
  };

  const categoryCounts: Record<FindingCategory, number> = {
    existence: 0,
    route: 0,
    "request-shape": 0,
    "response-shape": 0,
    type: 0,
    "analysis-limit": 0
  };

  for (const f of activeFindings) {
    const cat = f.category ?? "existence";
    if (cat in categoryCounts) {
      categoryCounts[cat]++;
    }
  }

  // Pre-index lifecycle events by finding ID, sorted chronologically descending
  const historyByFinding = new Map<string, FindingLifecycleEvent[]>();
  for (const evt of model.history) {
    let list = historyByFinding.get(evt.findingId);
    if (!list) {
      list = [];
      historyByFinding.set(evt.findingId, list);
    }
    list.push(evt);
  }
  for (const list of historyByFinding.values()) {
    list.sort((a, b) => b.observedAt - a.observedAt || a.eventId.localeCompare(b.eventId));
  }

  // Collect any proposals that are applied, verified, still_active, or unresolved
  // that belong to findings not currently shown in activeFindings (e.g. resolved findings)
  const activeFindingIds = new Set(activeFindings.map((f) => f.id));
  const standaloneProposals: FixProposal[] = [];
  if (model.proposalsByFinding) {
    for (const [findingId, proposals] of model.proposalsByFinding.entries()) {
      if (!activeFindingIds.has(findingId)) {
        for (const p of proposals) {
          if (p.status !== "proposed") {
            standaloneProposals.push(p);
          }
        }
      }
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UNDRIFT Integration Report</title>
  <style>
    :root {
      --color-error: var(--vscode-errorForeground, #f14c4c);
      --color-warning: var(--vscode-editorWarning-foreground, #cca700);
      --color-info: var(--vscode-editorInfo-foreground, #3794ff);
      --color-success: #89d185;
      --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(127, 127, 127, 0.08));
      --border-color: var(--vscode-panel-border, rgba(127, 127, 127, 0.25));
    }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-editor-foreground, #cccccc);
      background-color: var(--vscode-editor-background, #1e1e1e);
      margin: 0;
      padding: 24px 32px;
      line-height: 1.5;
    }
    h1, h2, h3, h4 {
      font-weight: 600;
      margin-top: 0;
      color: var(--vscode-editor-foreground, #ffffff);
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 24px;
    }
    .header-titles h1 {
      font-size: 20px;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .header-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888888);
    }
    .header-actions {
      display: flex;
      gap: 8px;
    }
    button {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: 1px solid transparent;
      padding: 6px 14px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.1s ease;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    button.btn-secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
    }
    button.btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    button.btn-sm {
      padding: 3px 8px;
      font-size: 11px;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-status {
      padding: 4px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: none;
    }
    .badge-fresh {
      background: rgba(137, 209, 133, 0.15);
      color: var(--color-success);
      border: 1px solid rgba(137, 209, 133, 0.4);
    }
    .badge-last-known {
      background: rgba(55, 148, 255, 0.15);
      color: var(--color-info);
      border: 1px solid rgba(55, 148, 255, 0.4);
    }
    .badge-incomplete {
      background: rgba(204, 167, 0, 0.15);
      color: var(--color-warning);
      border: 1px solid rgba(204, 167, 0, 0.4);
    }
    .badge-failed {
      background: rgba(241, 76, 76, 0.15);
      color: var(--color-error);
      border: 1px solid rgba(241, 76, 76, 0.4);
    }
    .badge-cancelled, .badge-neutral {
      background: rgba(127, 127, 127, 0.15);
      color: var(--vscode-descriptionForeground, #888888);
      border: 1px solid rgba(127, 127, 127, 0.3);
    }
    .badge-error {
      background: rgba(241, 76, 76, 0.2);
      color: var(--color-error);
    }
    .badge-warning {
      background: rgba(204, 167, 0, 0.2);
      color: var(--color-warning);
    }
    .badge-info {
      background: rgba(55, 148, 255, 0.2);
      color: var(--color-info);
    }
    .badge-category {
      background: rgba(127, 127, 127, 0.18);
      color: var(--vscode-editor-foreground, #cccccc);
    }
    .badge-evidence {
      background: rgba(127, 127, 127, 0.15);
      color: var(--vscode-descriptionForeground, #999999);
      border: 1px solid rgba(127, 127, 127, 0.3);
    }
    .banner {
      padding: 14px 18px;
      border-radius: 4px;
      margin-bottom: 24px;
      font-size: 13px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      border: 1px solid transparent;
    }
    .banner-incomplete {
      background: rgba(204, 167, 0, 0.12);
      border-color: rgba(204, 167, 0, 0.35);
      color: var(--vscode-editor-foreground, #eeeeee);
    }
    .banner-failed {
      background: rgba(241, 76, 76, 0.12);
      border-color: rgba(241, 76, 76, 0.35);
      color: var(--vscode-editor-foreground, #eeeeee);
    }
    .banner-clean {
      background: rgba(137, 209, 133, 0.12);
      border-color: rgba(137, 209, 133, 0.35);
      color: var(--vscode-editor-foreground, #eeeeee);
    }
    .banner-info {
      background: rgba(55, 148, 255, 0.12);
      border-color: rgba(55, 148, 255, 0.35);
      color: var(--vscode-editor-foreground, #eeeeee);
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .metric-value {
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
    }
    .metric-label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888888);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .category-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 24px;
    }
    .category-pill {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 4px 10px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .category-pill-count {
      font-weight: 700;
      color: var(--vscode-editor-foreground, #ffffff);
    }
    .section-title {
      font-size: 15px;
      margin: 28px 0 16px 0;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .finding-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 18px;
      margin-bottom: 20px;
      position: relative;
    }
    .finding-card.target-highlight {
      border-color: var(--vscode-focusBorder, #007acc);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007acc);
    }
    .finding-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .finding-title-group h3 {
      font-size: 15px;
      margin: 0 0 6px 0;
    }
    .finding-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .finding-summary {
      font-size: 13px;
      margin-bottom: 12px;
      color: var(--vscode-editor-foreground, #dddddd);
    }
    .finding-explanation {
      font-size: 12.5px;
      color: var(--vscode-descriptionForeground, #999999);
      margin-bottom: 16px;
      padding: 10px 14px;
      background: rgba(0, 0, 0, 0.15);
      border-left: 3px solid var(--border-color);
      border-radius: 0 4px 4px 0;
    }
    .comparison-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
      margin: 16px 0;
    }
    .comparison-box {
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 12px;
    }
    .comparison-box-title {
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      color: var(--vscode-descriptionForeground, #888888);
      margin-bottom: 6px;
    }
    pre, code {
      font-family: var(--vscode-editor-font-family, "Consolas", "Courier New", monospace);
      font-size: 12px;
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .locations-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 14px 0;
    }
    .location-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 12px;
      background: rgba(127, 127, 127, 0.05);
      border: 1px solid var(--border-color);
      border-radius: 4px;
    }
    .location-info {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
    }
    .location-role {
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #888888);
    }
    .lifecycle-timeline {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px dashed var(--border-color);
    }
    .timeline-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground, #888888);
      margin-bottom: 8px;
    }
    .timeline-events {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .timeline-event {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 11.5px;
      color: var(--vscode-descriptionForeground, #999999);
    }
    .historical-disclaimer {
      font-size: 11px;
      font-style: italic;
      color: var(--vscode-descriptionForeground, #777777);
      margin-top: 6px;
    }
    .warnings-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-top: 10px;
    }
    .warnings-table th, .warnings-table td {
      border: 1px solid var(--border-color);
      padding: 8px 12px;
      text-align: left;
    }
    .warnings-table th {
      background: rgba(127, 127, 127, 0.1);
      font-weight: 600;
    }
    .proposals-section {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid var(--border-color);
    }
    .proposals-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--vscode-editor-foreground, #ffffff);
      margin-bottom: 4px;
    }
    .proposals-disclaimer {
      font-size: 11.5px;
      font-style: italic;
      color: var(--vscode-descriptionForeground, #888888);
      margin-bottom: 12px;
      line-height: 1.4;
    }
    .proposals-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .proposal-card {
      background: rgba(127, 127, 127, 0.04);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 14px 16px;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .proposal-card.proposal-target-highlight {
      border-color: var(--vscode-focusBorder, #007fd4);
      box-shadow: 0 0 8px rgba(0, 127, 212, 0.4);
    }
    .proposal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .proposal-header h4 {
      margin: 0;
      font-size: 13.5px;
      font-weight: 600;
    }
    .badge-consumer {
      background: rgba(55, 148, 255, 0.15);
      color: #58a6ff;
      border: 1px solid rgba(55, 148, 255, 0.35);
    }
    .badge-provider {
      background: rgba(137, 209, 133, 0.15);
      color: #89d185;
      border: 1px solid rgba(137, 209, 133, 0.35);
    }
    .badge-risk-low {
      background: rgba(137, 209, 133, 0.15);
      color: #89d185;
      border: 1px solid rgba(137, 209, 133, 0.3);
    }
    .badge-risk-medium {
      background: rgba(204, 167, 0, 0.15);
      color: #cca700;
      border: 1px solid rgba(204, 167, 0, 0.3);
    }
    .badge-risk-high {
      background: rgba(241, 76, 76, 0.15);
      color: #f14c4c;
      border: 1px solid rgba(241, 76, 76, 0.3);
    }
    .badge-verification {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 3px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .badge-pending {
      background: rgba(204, 167, 0, 0.15);
      color: #cca700;
      border: 1px solid rgba(204, 167, 0, 0.35);
    }
    .badge-verified {
      background: rgba(137, 209, 133, 0.15);
      color: #89d185;
      border: 1px solid rgba(137, 209, 133, 0.35);
    }
    .badge-active {
      background: rgba(241, 76, 76, 0.15);
      color: #f14c4c;
      border: 1px solid rgba(241, 76, 76, 0.35);
    }
    .badge-unresolved {
      background: rgba(204, 167, 0, 0.15);
      color: #cca700;
      border: 1px solid rgba(204, 167, 0, 0.35);
    }
    .badge-stale {
      background: rgba(127, 127, 127, 0.15);
      color: #999999;
      border: 1px solid rgba(127, 127, 127, 0.35);
    }
    .verification-status-banner {
      font-size: 12px;
      padding: 8px 12px;
      border-radius: 4px;
      margin: 10px 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .verification-status-pending {
      background: rgba(204, 167, 0, 0.08);
      border: 1px solid rgba(204, 167, 0, 0.3);
      color: #cca700;
    }
    .verification-status-verified {
      background: rgba(137, 209, 133, 0.08);
      border: 1px solid rgba(137, 209, 133, 0.3);
      color: #89d185;
    }
    .verification-status-active {
      background: rgba(241, 76, 76, 0.08);
      border: 1px solid rgba(241, 76, 76, 0.3);
      color: #f14c4c;
    }
    .verification-status-unresolved {
      background: rgba(204, 167, 0, 0.08);
      border: 1px solid rgba(204, 167, 0, 0.3);
      color: #cca700;
    }
    .proposal-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      margin: 10px 0;
      font-size: 11.5px;
      padding: 8px 10px;
      background: rgba(127, 127, 127, 0.05);
      border-radius: 4px;
    }
    .proposal-meta-item {
      color: var(--vscode-descriptionForeground, #999999);
    }
    .proposal-meta-item strong {
      color: var(--vscode-editor-foreground, #cccccc);
    }
    .proposal-rationale {
      font-size: 12px;
      margin: 8px 0;
      color: var(--vscode-editor-foreground, #cccccc);
      line-height: 1.45;
    }
    .proposal-diff {
      margin: 10px 0;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      overflow: hidden;
    }
    .diff-header {
      font-size: 11px;
      padding: 4px 10px;
      background: rgba(127, 127, 127, 0.1);
      border-bottom: 1px solid var(--border-color);
      color: var(--vscode-descriptionForeground, #888888);
    }
    .diff-body {
      padding: 6px 10px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .diff-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 6px;
      border-radius: 2px;
    }
    .diff-old {
      background: rgba(241, 76, 76, 0.15);
      color: #f88;
    }
    .diff-new {
      background: rgba(137, 209, 133, 0.15);
      color: #8fd;
    }
    .diff-sign {
      font-weight: bold;
      user-select: none;
      width: 12px;
      display: inline-block;
      text-align: center;
    }
    .proposal-actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px dashed var(--border-color);
    }
    .btn-apply-fix {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      border-radius: 3px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-apply-fix:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    .proposal-apply-disclaimer {
      font-size: 11px;
      font-style: italic;
      color: var(--vscode-descriptionForeground, #777777);
      flex: 1;
      min-width: 200px;
    }
    .manual-resolution-note {
      font-size: 12px;
      color: var(--vscode-descriptionForeground, #888888);
      font-style: italic;
      padding: 8px 12px;
      background: rgba(127, 127, 127, 0.04);
      border: 1px dashed var(--border-color);
      border-radius: 4px;
      margin-top: 10px;
    }
    footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid var(--border-color);
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #777777);
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header-bar">
    <div class="header-titles">
      <h1>UNDRIFT Integration Report</h1>
      <div class="header-meta">
        <span>Workspace: <strong>${escapeHtml(model.workspaceLabel)}</strong></span>
        <span>•</span>
        ${renderStatusBadge(model.status)}
        ${model.timestamp ? `<span>•</span><span>Analyzed: <strong>${escapeHtml(formatTimestamp(model.timestamp))}</strong></span>` : ""}
      </div>
    </div>
    <div class="header-actions">
      <button type="button" data-action="scan">Scan Workspace</button>
      <button type="button" class="btn-secondary" data-action="refresh">Refresh</button>
    </div>
  </div>

  ${renderStatusBanner(model)}

  <div class="metrics-grid">
    <div class="metric-card">
      <span class="metric-value">${activeFindings.length}</span>
      <span class="metric-label">Active Drift Findings</span>
    </div>
    <div class="metric-card">
      <span class="metric-value" style="color: var(--color-error)">${errorCount}</span>
      <span class="metric-label">Errors</span>
    </div>
    <div class="metric-card">
      <span class="metric-value" style="color: var(--color-warning)">${warningCount}</span>
      <span class="metric-label">Warnings</span>
    </div>
    <div class="metric-card">
      <span class="metric-value" style="color: var(--color-info)">${infoCount}</span>
      <span class="metric-label">Information</span>
    </div>
    <div class="metric-card">
      <span class="metric-value" style="color: var(--color-warning)">${model.warnings ? model.warnings.length : 0}</span>
      <span class="metric-label">Coverage Limitations</span>
    </div>
  </div>

  <div class="category-pills">
    ${Object.entries(categoryCounts)
      .filter(([_, count]) => count > 0)
      .map(
        ([cat, count]) => `
      <div class="category-pill">
        <span>${escapeHtml(categoryLabels[cat as FindingCategory])}:</span>
        <span class="category-pill-count">${count}</span>
      </div>`
      )
      .join("")}
  </div>

  ${
    model.warnings && model.warnings.length > 0
      ? `
  <div class="section-title">
    <span>Analysis Limitations & Coverage Warnings (${model.warnings.length})</span>
  </div>
  <table class="warnings-table">
    <thead>
      <tr>
        <th>Code</th>
        <th>Message</th>
        <th>Source Location</th>
        <th>Scope</th>
        <th>Affects Completeness</th>
      </tr>
    </thead>
    <tbody>
      ${model.warnings
        .slice(0, 50)
        .map(
          (w) => `
        <tr>
          <td><code>${escapeHtml(w.code)}</code></td>
          <td>${escapeHtml(w.message)}</td>
          <td>${w.source ? `<code>${escapeHtml(w.source.uri)}:${w.source.start ? w.source.start.line + 1 : 1}:${w.source.start ? w.source.start.character + 1 : 1}</code>` : "—"}</td>
          <td><code>${escapeHtml(w.scope ?? "workspace")}</code></td>
          <td>${w.affectsCompleteness ? "Yes (Limits conclusions)" : "No (Advisory)"}</td>
        </tr>`
        )
        .join("")}
    </tbody>
  </table>
  ${model.warnings.length > 50 ? `<div style="margin-top: 8px; font-size: 12px; color: var(--vscode-descriptionForeground);">Showing first 50 of ${model.warnings.length} coverage limitations.</div>` : ""}`
      : ""
  }

  ${
    activeFindings.length > 0
      ? `
  <div class="section-title">
    <span>Detected Drift Findings (${activeFindings.length})</span>
  </div>
  <div class="findings-list">
    ${activeFindings
      .map((finding) =>
        renderFindingCard(
          finding,
          historyByFinding.get(finding.id) ?? [],
          model.targetFindingId === finding.id,
          model.proposalsByFinding?.get(finding.id) ?? [],
          model.targetProposalId
        )
      )
      .join("")}
  </div>`
      : ""
  }

  ${
    model.provisionalFindings && model.provisionalFindings.length > 0
      ? `
  <div class="section-title">
    <span>Provisional Drift Findings from Latest Incomplete Analysis (${model.provisionalFindings.length})</span>
  </div>
  <div class="banner banner-incomplete" style="margin-bottom: 16px;">
    <div>
      <strong>⚠️ Provisional Findings:</strong> These positive contract discrepancies were discovered during the latest incomplete analysis. Because coverage limitations exist, they are unverified, do NOT overwrite the accepted snapshot, and do NOT trigger lifecycle resolution events.
    </div>
  </div>
  <div class="findings-list">
    ${model.provisionalFindings
      .map((finding) =>
        renderFindingCard(
          finding,
          [],
          model.targetFindingId === finding.id,
          model.proposalsByFinding?.get(finding.id) ?? [],
          model.targetProposalId,
          true
        )
      )
      .join("")}
  </div>`
      : ""
  }

  ${
    standaloneProposals.length > 0
      ? `
  <div class="section-title">
    <span>Recent Repairs &amp; Post-Edit Verifications (${standaloneProposals.length})</span>
  </div>
  <div class="proposals-list" style="margin-bottom: 24px;">
    ${standaloneProposals.map((p) => renderProposalCard(p, p.id === model.targetProposalId)).join("")}
  </div>`
      : ""
  }

  <footer>
    UNDRIFT Local-First API Contract Drift Intelligence • Verified static analysis
  </footer>

  <script nonce="${nonce}">
    (function() {
      // In webview environments, acquireVsCodeApi is provided by host
      const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

      document.addEventListener('click', function(e) {
        const target = e.target;
        if (!target) return;

        const btn = target.closest('button[data-action]');
        if (!btn) return;

        const action = btn.getAttribute('data-action');
        if (action === 'open-location') {
          const spanJson = btn.getAttribute('data-span');
          if (spanJson && vscode) {
            try {
              const span = JSON.parse(spanJson);
              vscode.postMessage({ command: 'openLocation', span: span });
            } catch (err) {
              console.error('Failed to parse location span', err);
            }
          }
        } else if (action === 'scan') {
          if (vscode) {
            vscode.postMessage({ command: 'scanWorkspace' });
          }
        } else if (action === 'refresh') {
          if (vscode) {
            vscode.postMessage({ command: 'refresh' });
          }
        } else if (action === 'apply-fix') {
          const proposalId = btn.getAttribute('data-proposal-id');
          if (proposalId && vscode) {
            vscode.postMessage({ command: 'applyFix', proposalId: proposalId });
          }
        }
      });

      // Target scrolling
      const targetProposal = document.querySelector('.proposal-card.proposal-target-highlight');
      if (targetProposal) {
        targetProposal.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        const targetCard = document.querySelector('.finding-card.target-highlight');
        if (targetCard) {
          targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    })();
  </script>
</body>
</html>`;
}

function renderStatusBadge(status: VerificationState): string {
  switch (status) {
    case "freshly-verified":
      return '<span class="badge-status badge-fresh">Freshly Verified Current Source</span>';
    case "last-known":
      return '<span class="badge-status badge-last-known">Last Known Analyzed State</span>';
    case "analysis-incomplete":
      return '<span class="badge-status badge-incomplete">Analysis Incomplete</span>';
    case "analysis-failed":
      return '<span class="badge-status badge-failed">Analysis Failed</span>';
    case "analysis-cancelled":
      return '<span class="badge-status badge-cancelled">Analysis Cancelled</span>';
    case "no-analysis":
      return '<span class="badge-status badge-neutral">No Prior Analysis</span>';
    case "no-workspace":
      return '<span class="badge-status badge-neutral">No Workspace Open</span>';
  }
}

function renderStatusBanner(model: ReportViewModel): string {
  if (model.status === "no-workspace") {
    return `
    <div class="banner banner-info">
      <div>
        <strong>No workspace folder open:</strong> Open a workspace folder in VS Code to detect API contract drift between frontend and backend contracts.
      </div>
    </div>`;
  }

  if (model.status === "no-analysis") {
    return `
    <div class="banner banner-info">
      <div>
        <strong>No prior analysis available:</strong> UNDRIFT has not run contract verification for this workspace yet. Click <strong>Scan Workspace</strong> above to analyze contracts.
      </div>
    </div>`;
  }

  if (model.status === "analysis-incomplete") {
    const timeText = model.timestamp ? ` from ${formatTimestamp(model.timestamp)}` : "";
    const completenessWarnings = model.warnings.filter((w) => w.affectsCompleteness);
    let detailsText = "";
    if (completenessWarnings.length > 0) {
      const affectedFiles = Array.from(
        new Set(
          completenessWarnings
            .map((w) => w.source?.uri)
            .filter((uri): uri is string => Boolean(uri))
        )
      );
      if (affectedFiles.length > 0) {
        const fileList = affectedFiles.slice(0, 3).join(", ");
        const extra = affectedFiles.length > 3 ? ` and ${affectedFiles.length - 3} more` : "";
        detailsText = ` Unresolved patterns or parse issues in ${fileList}${extra} prevent full contract verification.`;
      }
    }
    return `
    <div class="banner banner-incomplete">
      <div>
        <strong>Coverage Incomplete:</strong> The latest analysis attempt encountered limitations or unacquired files.${escapeHtml(detailsText)} Retaining last known complete analysis${escapeHtml(timeText)} without falsely resolving previous findings. Current source code may differ.
      </div>
    </div>`;
  }

  if (model.status === "analysis-failed") {
    const msg = model.statusMessage ? `: ${model.statusMessage}` : "";
    return `
    <div class="banner banner-failed">
      <div>
        <strong>Analysis Failed${escapeHtml(msg)}:</strong> Retaining last known complete findings. Old source references reflect past analysis.
      </div>
    </div>`;
  }

  if (model.status === "analysis-cancelled") {
    return `
    <div class="banner banner-info">
      <div>
        <strong>Analysis Cancelled:</strong> The latest scan was cancelled before completion. Retaining last known complete findings.
      </div>
    </div>`;
  }

  if (model.status === "last-known") {
    return `
    <div class="banner banner-info">
      <div>
        <strong>Showing Last Known Analyzed State:</strong> Restored from past complete analysis on ${escapeHtml(formatTimestamp(model.timestamp))}. Source code may have changed since.
      </div>
    </div>`;
  }

  if (model.findings.length === 0) {
    return `
    <div class="banner banner-clean">
      <div>
        <strong>No Contract Drift Detected:</strong> All analyzed frontend consumer API calls match backend provider routes and schemas.
      </div>
    </div>`;
  }

  return "";
}

function renderFindingCard(
  finding: DiagnosticFindingSource,
  history: readonly FindingLifecycleEvent[],
  isTarget: boolean,
  proposals: readonly FixProposal[] = [],
  targetProposalId?: string,
  isProvisional = false
): string {
  const severityClass =
    finding.severity === "error"
      ? "badge-error"
      : finding.severity === "warning"
        ? "badge-warning"
        : "badge-info";

  const locations = finding.sourceLocations ?? [];
  const hasExpected = finding.expected !== undefined && finding.expected !== null;
  const hasObserved = finding.observed !== undefined && finding.observed !== null;

  return `
  <div class="finding-card ${isTarget ? "target-highlight" : ""}" id="finding-${escapeHtml(finding.id)}">
    <div class="finding-header">
      <div class="finding-title-group">
        <h3>${escapeHtml(finding.title)}</h3>
        <div class="finding-tags">
          <span class="badge ${severityClass}">${escapeHtml(finding.severity)}</span>
          <span class="badge badge-category">${escapeHtml(finding.ruleId)}</span>
          <span class="badge badge-category">${escapeHtml(finding.category ?? "drift")}</span>
          ${
            isProvisional
              ? '<span class="badge" style="background: rgba(204, 167, 0, 0.2); color: var(--color-warning); border: 1px solid rgba(204, 167, 0, 0.4);">Provisional — Incomplete Scan</span>'
              : ""
          }
          ${
            finding.evidenceStrength
              ? `<span class="badge badge-evidence">Evidence: ${escapeHtml(finding.evidenceStrength)}</span>`
              : ""
          }
          <span class="badge badge-evidence">State: ${escapeHtml(finding.state)}</span>
        </div>
      </div>
    </div>

    ${finding.summary ? `<div class="finding-summary">${escapeHtml(finding.summary)}</div>` : ""}

    ${
      "explanation" in finding && typeof finding.explanation === "string" && finding.explanation
        ? `<div class="finding-explanation">${escapeHtml(finding.explanation)}</div>`
        : ""
    }
    ${
      "impactStatement" in finding &&
      typeof finding.impactStatement === "string" &&
      finding.impactStatement
        ? `<div class="finding-impact" style="margin-top: 6px; font-size: 12px; color: var(--color-foreground-muted);"><strong>Impact:</strong> ${escapeHtml(finding.impactStatement)}</div>`
        : ""
    }

    ${
      hasExpected || hasObserved
        ? `
    <div class="comparison-grid">
      ${
        hasExpected
          ? `
      <div class="comparison-box">
        <div class="comparison-box-title">Expected Contract</div>
        <pre><code>${formatContractValue(finding.expected)}</code></pre>
      </div>`
          : ""
      }
      ${
        hasObserved
          ? `
      <div class="comparison-box">
        <div class="comparison-box-title">Observed Contract</div>
        <pre><code>${formatContractValue(finding.observed)}</code></pre>
      </div>`
          : ""
      }
    </div>`
        : ""
    }

    ${
      locations.length > 0
        ? `
    <div class="locations-list">
      ${locations.map((loc, idx) => renderLocationRow(loc, idx, locations.length)).join("")}
    </div>`
        : ""
    }

    ${
      finding.limitations && finding.limitations.length > 0
        ? `
    <div class="finding-explanation" style="border-left-color: var(--color-warning);">
      <strong>Known Limitations:</strong>
      <ul style="margin: 4px 0 0 0; padding-left: 20px;">
        ${finding.limitations.map((lim) => `<li>[${escapeHtml(lim.code)}] ${escapeHtml(lim.message)}</li>`).join("")}
      </ul>
    </div>`
        : ""
    }

    ${renderProposalsSection(proposals, finding, targetProposalId)}

    ${
      history.length > 0
        ? `
    <div class="lifecycle-timeline">
      <div class="timeline-title">Lifecycle History</div>
      <div class="timeline-events">
        ${history.map((evt) => renderTimelineEvent(evt)).join("")}
      </div>
      <div class="historical-disclaimer">
        Historical references reflect code at analysis time; source locations and contents may have changed.
      </div>
    </div>`
        : ""
    }
  </div>`;
}

function renderProposalsSection(
  proposals: readonly FixProposal[],
  finding: DiagnosticFindingSource,
  targetProposalId?: string
): string {
  if (proposals.length === 0) {
    if (finding.ruleId === "UND120") {
      return `
    <div class="proposals-section">
      <div class="proposals-title">Candidate Repair Proposals</div>
      <div class="manual-resolution-note">
        No automated safe repair proposals are available for this finding. Method evidence could not be determined conservatively without ambiguity. Manual inspection and repair is required.
      </div>
    </div>`;
    }
    return `
    <div class="proposals-section">
      <div class="proposals-title">Candidate Repair Proposals</div>
      <div class="manual-resolution-note">
        Automated repair proposals are not supported for rule <code>${escapeHtml(finding.ruleId)}</code>. Manual resolution is required.
      </div>
    </div>`;
  }

  return `
  <div class="proposals-section">
    <div class="proposals-title">Candidate Repair Proposals (${proposals.length} available)</div>
    <div class="proposals-disclaimer">
      Proposals represent alternative repairs, not authoritative recommendations. Review the assumptions and diff before applying. Neither consumer nor provider is assumed to be inherently correct.
    </div>
    <div class="proposals-list">
      ${proposals.map((p) => renderProposalCard(p, p.id === targetProposalId)).join("")}
    </div>
  </div>`;
}

function renderProposalCard(proposal: FixProposal, isTarget: boolean): string {
  const roleBadgeClass =
    proposal.targetRole === "consumer"
      ? "badge-consumer"
      : proposal.targetRole === "provider"
        ? "badge-provider"
        : "badge-category";
  const roleLabel =
    proposal.targetRole === "consumer"
      ? "Consumer Repair (Frontend)"
      : proposal.targetRole === "provider"
        ? "Provider Repair (Backend)"
        : "Neutral Repair";

  const proposalRecord = proposal as unknown as Record<string, unknown>;
  const rawRisk: string =
    (proposal.risk as string) ||
    (typeof proposalRecord.riskLevel === "string" ? proposalRecord.riskLevel : "") ||
    "mechanical";
  const riskBadgeClass =
    rawRisk === "mechanical" || rawRisk === "low"
      ? "badge-risk-low"
      : rawRisk === "review-required" || rawRisk === "medium"
        ? "badge-risk-medium"
        : "badge-risk-high";
  const riskDisplay =
    rawRisk === "mechanical"
      ? "mechanical"
      : rawRisk === "review-required"
        ? "review-required"
        : String(rawRisk);

  let authoritativeSideLabel = "Neutral / Unspecified";
  const rawAssumptions = proposalRecord.assumptions;
  if (rawAssumptions && typeof rawAssumptions === "object" && !Array.isArray(rawAssumptions)) {
    const assumptionsObj = rawAssumptions as Record<string, unknown>;
    authoritativeSideLabel =
      assumptionsObj.authoritativeSide === "provider"
        ? "Provider (Backend)"
        : assumptionsObj.authoritativeSide === "consumer"
          ? "Consumer (Frontend)"
          : "Neutral / Unspecified";
  } else if (Array.isArray(rawAssumptions)) {
    const joined = rawAssumptions.join(" ");
    if (joined.includes("backend provider") || joined.includes("provider's HTTP method")) {
      authoritativeSideLabel = "Provider (Backend)";
    } else if (joined.includes("frontend consumer") || joined.includes("frontend request")) {
      authoritativeSideLabel = "Consumer (Frontend)";
    } else {
      authoritativeSideLabel =
        proposal.targetRole === "consumer" ? "Provider (Backend)" : "Consumer (Frontend)";
    }
  }

  const isBreaking =
    (typeof rawAssumptions === "object" &&
      rawAssumptions !== null &&
      Boolean((rawAssumptions as Record<string, unknown>).breakingChange)) ||
    (Array.isArray(rawAssumptions) &&
      rawAssumptions.some((a) => typeof a === "string" && /break/i.test(a)));

  const verificationText =
    proposal.verificationDescription ||
    (typeof proposalRecord.verificationExpectation === "string"
      ? proposalRecord.verificationExpectation
      : "") ||
    "Re-analysis required";

  const status = proposal.status ?? "proposed";
  const verifiedGen =
    typeof proposalRecord.verifiedGeneration === "number"
      ? proposalRecord.verifiedGeneration
      : undefined;
  const verificationExplanation =
    typeof proposalRecord.verificationExplanation === "string"
      ? proposalRecord.verificationExplanation
      : undefined;

  let verificationBadgeHtml = "";
  let verificationBannerHtml = "";

  if (status === "applied") {
    verificationBadgeHtml = `<span class="badge badge-verification badge-pending">&#9203; Applied — verification pending</span>`;
    verificationBannerHtml = `
    <div class="verification-status-banner verification-status-pending">
      <strong>Applied — verification pending</strong>
      <span>Edit was applied to source code. Re-analyzing workspace to verify whether contract drift was resolved...</span>
    </div>`;
  } else if (status === "verified") {
    const genText = verifiedGen !== undefined ? ` (generation ${verifiedGen})` : "";
    verificationBadgeHtml = `<span class="badge badge-verification badge-verified">&#10004; Verified — original finding resolved</span>`;
    verificationBannerHtml = `
    <div class="verification-status-banner verification-status-verified">
      <strong>Verified — original finding resolved${escapeHtml(genText)}</strong>
      <span>${escapeHtml(verificationExplanation ?? "Fresh post-edit analysis confirmed that the original contract drift incompatibility was resolved.")}</span>
    </div>`;
  } else if (status === "still_active") {
    const genText = verifiedGen !== undefined ? ` (generation ${verifiedGen})` : "";
    verificationBadgeHtml = `<span class="badge badge-verification badge-active">&#9888; Applied — finding still active</span>`;
    verificationBannerHtml = `
    <div class="verification-status-banner verification-status-active">
      <strong>Applied — finding still active${escapeHtml(genText)}</strong>
      <span>${escapeHtml(verificationExplanation ?? "The edit was applied, but fresh post-edit analysis confirmed that the contract drift incompatibility remains active.")}</span>
    </div>`;
  } else if (status === "unresolved") {
    const genText = verifiedGen !== undefined ? ` (generation ${verifiedGen})` : "";
    verificationBadgeHtml = `<span class="badge badge-verification badge-unresolved">&#9888; Applied — resolution could not be verified</span>`;
    verificationBannerHtml = `
    <div class="verification-status-banner verification-status-unresolved">
      <strong>Applied — resolution could not be verified${escapeHtml(genText)}</strong>
      <span>${escapeHtml(verificationExplanation ?? "Post-edit analysis could not confirm contract drift resolution.")}</span>
    </div>`;
  } else if (status === "stale") {
    verificationBadgeHtml = `<span class="badge badge-verification badge-stale">Stale — source modified</span>`;
  }

  return `
  <div class="proposal-card ${isTarget ? "proposal-target-highlight" : ""}" id="proposal-${escapeHtml(proposal.id)}">
    <div class="proposal-header">
      <h4>${escapeHtml(proposal.title)}</h4>
      <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
        ${verificationBadgeHtml}
        <span class="badge ${roleBadgeClass}">${escapeHtml(roleLabel)}</span>
        <span class="badge ${riskBadgeClass}">Risk: ${escapeHtml(riskDisplay)}</span>
      </div>
    </div>

    <div class="proposal-meta-grid">
      <div class="proposal-meta-item">
        <span>Target Role:</span> <strong>${escapeHtml(proposal.targetRole)}</strong>
      </div>
      <div class="proposal-meta-item">
        <span>Authoritative Assumption:</span> <strong>${escapeHtml(authoritativeSideLabel)}</strong>
      </div>
      <div class="proposal-meta-item">
        <span>Breaking Change:</span> <strong>${isBreaking ? "Yes" : "No"}</strong>
      </div>
      <div class="proposal-meta-item">
        <span>Post-Edit Verification:</span> <strong>${escapeHtml(verificationText)}</strong>
      </div>
    </div>

    <div class="proposal-rationale">
      <strong>Rationale:</strong> ${escapeHtml(proposal.rationale)}
    </div>

    ${verificationBannerHtml}

    ${proposal.edits
      .map((edit) => {
        const editRecord = edit as unknown as Record<string, unknown>;
        const docUri =
          (typeof editRecord.targetUri === "string" ? editRecord.targetUri : undefined) ||
          edit.documentUri;
        const base = extractBaseName(docUri);
        const spanStart = (
          editRecord.span as { start?: { line?: number; character?: number } } | undefined
        )?.start;
        const startPos = spanStart || edit.start;
        const line = (startPos?.line ?? 0) + 1;
        const char = (startPos?.character ?? 0) + 1;
        const oldText =
          typeof editRecord.currentText === "string" ? editRecord.currentText : undefined;
        const replacementText =
          (typeof editRecord.replacementText === "string"
            ? editRecord.replacementText
            : undefined) || edit.newText;

        return `
    <div class="proposal-diff">
      <div class="diff-header">Target: <code>${escapeHtml(base)}:${line}:${char}</code></div>
      <div class="diff-body">
        ${
          oldText !== undefined
            ? `<div class="diff-row diff-old">
          <span class="diff-sign">-</span>
          <code>${escapeHtml(oldText)}</code>
        </div>`
            : ""
        }
        <div class="diff-row diff-new">
          <span class="diff-sign">+</span>
          <code>${escapeHtml(replacementText)}</code>
        </div>
      </div>
    </div>`;
      })
      .join("")}

    <div class="proposal-actions">
      ${
        status === "proposed"
          ? `<button type="button" class="btn-apply-fix" data-action="apply-fix" data-proposal-id="${escapeHtml(proposal.id)}">Apply Repair</button>
      <span class="proposal-apply-disclaimer">Application requires confirmation and re-validates source freshness immediately before applying. Post-edit re-analysis required to verify resolution.</span>`
          : `<span class="proposal-apply-disclaimer">${status === "verified" ? "Repair edit verified against post-edit source." : status === "applied" ? "Repair edit applied. Verification in progress..." : "Repair edit applied. Manual inspection required."}</span>`
      }
    </div>
  </div>`;
}

function renderLocationRow(span: SourceSpan, index: number, total: number): string {
  const role =
    total >= 2 ? (index === 0 ? "Consumer" : index === 1 ? "Provider" : "Location") : "Location";

  const baseName = extractBaseName(span.uri);
  const line = span.start ? span.start.line + 1 : 1;
  const col = span.start ? span.start.character + 1 : 1;
  const spanJson = escapeHtml(JSON.stringify(span));

  return `
  <div class="location-row">
    <div class="location-info">
      <span class="location-role">${escapeHtml(role)}:</span>
      <span>${escapeHtml(baseName)}:${line}:${col}</span>
    </div>
    <button type="button" class="btn-secondary btn-sm" data-action="open-location" data-span="${spanJson}">
      Open in Editor
    </button>
  </div>`;
}

function renderTimelineEvent(evt: FindingLifecycleEvent): string {
  const transitionColors: Record<FindingLifecycleTransition, string> = {
    detected: "var(--color-info)",
    changed: "var(--color-warning)",
    resolved: "var(--color-success)",
    reintroduced: "var(--color-error)"
  };

  const color = transitionColors[evt.transitionKind] ?? "var(--color-info)";
  const timeStr = formatTimestamp(evt.observedAt);
  const deltaParts: string[] = [];

  if (evt.context?.previousSeverity && evt.context?.newSeverity) {
    deltaParts.push(
      `severity: ${escapeHtml(evt.context.previousSeverity)} &rarr; ${escapeHtml(evt.context.newSeverity)}`
    );
  }
  if (evt.context?.reason) {
    deltaParts.push(`reason: ${escapeHtml(evt.context.reason)}`);
  }

  const deltaText = deltaParts.length > 0 ? ` (${deltaParts.join(", ")})` : "";

  return `
  <div class="timeline-event">
    <strong style="color: ${color}; text-transform: uppercase;">${escapeHtml(evt.transitionKind)}</strong>
    <span>•</span>
    <span>${escapeHtml(timeStr)}</span>
    <span>•</span>
    <span>Gen ${evt.triggerGeneration}</span>
    ${deltaText ? `<span>•</span><span>${deltaText}</span>` : ""}
  </div>`;
}

/**
 * Manages the VS Code Integration Report WebviewPanel singleton and coordinator event lifecycle.
 */
export class ReportPanelManager implements vscode.Disposable {
  private currentPanel?: vscode.WebviewPanel;
  private coordinator?: AnalysisCoordinator;
  private fixService?: FixProposalService;
  private coordinatorSubscription?: { dispose(): void };
  private activeWorkspaceId?: WorkspaceId;
  private readonly workspaceStates = new Map<WorkspaceId, WorkspaceReportState>();
  private readonly vscodeModule?: typeof vscode;
  private readonly logger?: ExtensionLogger;
  private disposed = false;

  constructor(optionsOrCoordinator?: ReportPanelManagerOptions | AnalysisCoordinator) {
    if (
      optionsOrCoordinator &&
      typeof (optionsOrCoordinator as AnalysisCoordinator).onAnalysisCompleted === "function"
    ) {
      this.setCoordinator(optionsOrCoordinator as AnalysisCoordinator);
    } else if (optionsOrCoordinator) {
      const options = optionsOrCoordinator as ReportPanelManagerOptions;
      this.vscodeModule = options.vscodeModule;
      this.logger = options.logger;
      this.fixService = options.fixService;

      if (options.coordinator) {
        this.setCoordinator(options.coordinator);
      }
    }
  }

  /**
   * Sets or updates the FixProposalService.
   */
  public setFixService(fixService: FixProposalService): void {
    this.fixService = fixService;
  }

  /**
   * Retrieves the current report presentation state for a workspace.
   */
  public getState(workspaceId?: WorkspaceId): WorkspaceReportState | undefined {
    const id = workspaceId ?? this.activeWorkspaceId;
    return id ? this.workspaceStates.get(id) : undefined;
  }

  private getVsCode(): typeof vscode | undefined {
    if (this.vscodeModule) return this.vscodeModule;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require("vscode");
    } catch {
      return undefined;
    }
  }

  /**
   * Sets or updates the AnalysisCoordinator connection.
   */
  public setCoordinator(coordinator: AnalysisCoordinator): void {
    if (this.coordinatorSubscription) {
      this.coordinatorSubscription.dispose();
      this.coordinatorSubscription = undefined;
    }

    this.coordinator = coordinator;

    this.coordinatorSubscription = coordinator.onAnalysisCompleted((outcome) => {
      this.handleAnalysisOutcome(outcome);
    });

    const wsId = coordinator.getActiveWorkspaceId();
    if (wsId) {
      this.activeWorkspaceId = wsId;
      const snap = coordinator.getLastKnownSnapshot(wsId);
      const hist = coordinator.getLastKnownHistory(wsId) ?? [];
      if (snap) {
        this.setWorkspaceState({
          workspaceId: wsId,
          status: "last-known",
          timestamp: snap.analyzedAt ? new Date(snap.analyzedAt).toISOString() : undefined,
          findings: snap.findings,
          history: hist,
          warnings: snap.coverage?.warnings ?? [],
          coverage: snap.coverage
        });
      } else {
        this.setWorkspaceState({
          workspaceId: wsId,
          status: "no-analysis",
          findings: [],
          history: hist,
          warnings: []
        });
      }
    }
  }

  /**
   * Opens or reveals the Integration Report webview panel.
   */
  public async show(targetFindingId?: string, targetProposalId?: string): Promise<void> {
    if (this.disposed) return;

    const vs = this.getVsCode();
    if (!vs?.window?.createWebviewPanel) {
      this.logger?.warn("vscode.window.createWebviewPanel is not available.");
      return;
    }

    if (this.currentPanel) {
      this.currentPanel.reveal(vs.ViewColumn?.One ?? 1);
      this.updateWebviewContent(targetFindingId, targetProposalId);
      return;
    }

    const panel = vs.window.createWebviewPanel(
      "undrift.report",
      "UNDRIFT Integration Report",
      vs.ViewColumn?.One ?? 1,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.currentPanel = panel;

    panel.onDidDispose(
      () => {
        this.currentPanel = undefined;
      },
      null,
      []
    );

    panel.webview.onDidReceiveMessage(
      (message: unknown) => {
        void this.handleWebviewMessage(message);
      },
      null,
      []
    );

    this.updateWebviewContent(targetFindingId, targetProposalId);
  }

  /**
   * Handles messages dispatched from the webview.
   */
  public async handleWebviewMessage(message: unknown): Promise<void> {
    if (!message || typeof message !== "object") return;
    const msg = message as { command?: string; span?: SourceSpan; proposalId?: unknown };

    switch (msg.command) {
      case "openLocation": {
        if (msg.span && typeof msg.span === "object" && typeof msg.span.uri === "string") {
          await openFindingLocation(msg.span, this.getVsCode());
        }
        break;
      }
      case "scanWorkspace":
      case "refresh": {
        if (this.coordinator) {
          try {
            await this.coordinator.getScheduler().runImmediateScan();
          } catch (err) {
            this.logger?.error("Failed to execute scan from report webview", err);
          }
        }
        break;
      }
      case "applyFix": {
        if (
          typeof msg.proposalId === "string" &&
          msg.proposalId.trim().length > 0 &&
          msg.proposalId.length < 256
        ) {
          const vs = this.getVsCode();
          if (vs?.commands?.executeCommand) {
            try {
              await vs.commands.executeCommand("undrift.applyFix", msg.proposalId.trim());
            } catch (err) {
              this.logger?.error(
                "Failed to execute undrift.applyFix command from report webview",
                err
              );
            }
          }
        } else {
          this.logger?.warn("Invalid applyFix message received from webview; malformed proposalId");
        }
        break;
      }
    }
  }

  /**
   * Handles session restoration outcomes on workspace open.
   */
  public handleSessionRestored(restored: RestoredSessionState): void {
    if (this.disposed) return;

    const wsId = restored.workspaceId;
    if (!wsId || restored.status === "no-workspace") {
      this.setWorkspaceState({
        workspaceId: "no-workspace" as WorkspaceId,
        status: "no-workspace",
        findings: [],
        history: [],
        warnings: []
      });
      this.updateWebviewContent();
      return;
    }

    this.activeWorkspaceId = wsId;

    if (restored.snapshot) {
      this.setWorkspaceState({
        workspaceId: wsId,
        status: "last-known",
        timestamp: restored.snapshot.analyzedAt
          ? new Date(restored.snapshot.analyzedAt).toISOString()
          : undefined,
        findings: restored.snapshot.findings,
        history: restored.history ?? [],
        warnings: restored.snapshot.coverage?.warnings ?? [],
        coverage: restored.snapshot.coverage
      });
    } else {
      this.setWorkspaceState({
        workspaceId: wsId,
        status: "no-analysis",
        findings: [],
        history: restored.history ?? [],
        warnings: []
      });
    }

    this.updateWebviewContent();
  }

  /**
   * Handles coordinator analysis outcomes.
   * Enforces stale-result and incomplete-analysis protections:
   * - Incomplete analyses preserve last known complete findings.
   * - Failed, cancelled, and superseded results do NOT overwrite report state.
   */
  public handleAnalysisOutcome(outcome: CoordinatorAnalysisResult): void {
    if (this.disposed) return;

    switch (outcome.status) {
      case "superseded": {
        this.logger?.info("ReportPanelManager: ignored superseded scan outcome.");
        return;
      }

      case "no-workspace": {
        this.setWorkspaceState({
          workspaceId: "no-workspace" as WorkspaceId,
          status: "no-workspace",
          findings: [],
          history: [],
          warnings: []
        });
        this.updateWebviewContent();
        return;
      }

      case "success": {
        const wsId = outcome.workspaceId;
        if (!wsId) return;
        this.activeWorkspaceId = wsId;

        const findings = outcome.result?.findings ?? [];
        const timestamp = outcome.result?.generatedAt
          ? new Date(outcome.result.generatedAt).toISOString()
          : outcome.reconciliation?.currentSnapshot?.analyzedAt
            ? new Date(outcome.reconciliation.currentSnapshot.analyzedAt).toISOString()
            : new Date().toISOString();
        const history = this.coordinator?.getLastKnownHistory(wsId) ?? [];
        const warnings = outcome.result?.warnings ?? [];
        const coverage = outcome.reconciliation?.currentSnapshot?.coverage;

        this.setWorkspaceState({
          workspaceId: wsId,
          status: "freshly-verified",
          timestamp,
          findings,
          history,
          warnings,
          coverage
        });
        this.updateWebviewContent();
        return;
      }

      case "incomplete": {
        const wsId = outcome.workspaceId;
        if (!wsId) return;
        this.activeWorkspaceId = wsId;

        // INCOMPLETE ANALYSIS SAFETY:
        // Do NOT replace the last known complete findings with partial results!
        const prior = this.workspaceStates.get(wsId);
        const priorFindings =
          prior?.findings ?? this.coordinator?.getLastKnownSnapshot(wsId)?.findings ?? [];
        const priorTimestamp =
          prior?.timestamp ??
          (this.coordinator?.getLastKnownSnapshot(wsId)?.analyzedAt
            ? new Date(this.coordinator.getLastKnownSnapshot(wsId)!.analyzedAt).toISOString()
            : undefined);
        const history = prior?.history ?? this.coordinator?.getLastKnownHistory(wsId) ?? [];
        const warnings = outcome.result?.warnings ?? prior?.warnings ?? [];

        const currentFindings = outcome.result?.findings ?? [];
        const provisionalFindings = currentFindings.filter(
          (f) =>
            f.category !== "analysis-limit" &&
            !f.ruleId.startsWith("UND9") &&
            !priorFindings.some((pf) => pf.id === f.id)
        );

        this.setWorkspaceState({
          workspaceId: wsId,
          status: "analysis-incomplete",
          timestamp: priorTimestamp,
          message: "Coverage incomplete; preserving last known complete analysis",
          findings: priorFindings,
          provisionalFindings,
          history,
          warnings,
          coverage: prior?.coverage
        });
        this.updateWebviewContent();
        return;
      }

      case "failed": {
        const wsId = outcome.workspaceId;
        if (!wsId) return;
        const prior = this.workspaceStates.get(wsId);
        if (prior) {
          this.setWorkspaceState({
            ...prior,
            status: "analysis-failed",
            message: outcome.errorMessage
          });
          this.updateWebviewContent();
        }
        return;
      }

      case "cancelled": {
        const wsId = outcome.workspaceId;
        if (!wsId) return;
        const prior = this.workspaceStates.get(wsId);
        if (prior) {
          this.setWorkspaceState({
            ...prior,
            status: "analysis-cancelled",
            message: "Scan was cancelled"
          });
          this.updateWebviewContent();
        }
        return;
      }
    }
  }

  /**
   * Sets active workspace ID for multi-workspace isolation.
   */
  public setActiveWorkspaceId(workspaceId?: WorkspaceId): void {
    this.activeWorkspaceId = workspaceId;
    this.updateWebviewContent();
  }

  /**
   * Handles history reset notification for a workspace.
   */
  public handleHistoryReset(workspaceId: WorkspaceId): void {
    if (this.disposed) return;
    const prior = this.workspaceStates.get(workspaceId);
    if (prior) {
      this.setWorkspaceState({
        ...prior,
        history: []
      });
      this.updateWebviewContent();
    }
  }

  /**
   * Retrieves report state for workspace.
   */
  public getWorkspaceState(workspaceId?: WorkspaceId): WorkspaceReportState | undefined {
    const wsId = workspaceId ?? this.activeWorkspaceId;
    return wsId ? this.workspaceStates.get(wsId) : undefined;
  }

  /**
   * Updates webview panel HTML if currently visible.
   */
  public updateWebviewContent(targetFindingId?: string, targetProposalId?: string): void {
    if (!this.currentPanel) return;

    const state = this.getCurrentState();

    const proposalsByFinding = new Map<string, readonly FixProposal[]>();
    if (this.fixService) {
      if (state?.findings) {
        for (const f of state.findings) {
          const proposals = this.fixService.getProposalsForFinding(f.id, state.workspaceId);
          if (proposals.length > 0) {
            proposalsByFinding.set(f.id, proposals);
          }
        }
      }
      const allTracked = this.fixService.getAllProposals(state?.workspaceId);
      for (const [findingId, proposals] of allTracked.entries()) {
        if (!proposalsByFinding.has(findingId)) {
          proposalsByFinding.set(findingId, proposals);
        }
      }
    }

    const model: ReportViewModel = {
      workspaceId: state?.workspaceId,
      workspaceLabel: state?.workspaceId ? String(state.workspaceId) : "UNDRIFT Workspace",
      status: state?.status ?? "no-analysis",
      timestamp: state?.timestamp,
      statusMessage: state?.message,
      findings: state?.findings ?? [],
      provisionalFindings: state?.provisionalFindings,
      history: state?.history ?? [],
      warnings: state?.warnings ?? [],
      coverage: state?.coverage,
      targetFindingId,
      targetProposalId,
      proposalsByFinding
    };

    this.currentPanel.webview.html = renderReportHtml(model);
  }

  private getCurrentState(): WorkspaceReportState | undefined {
    if (this.activeWorkspaceId) {
      return this.workspaceStates.get(this.activeWorkspaceId);
    }
    if (this.workspaceStates.size > 0) {
      return this.workspaceStates.values().next().value;
    }
    return undefined;
  }

  private setWorkspaceState(state: WorkspaceReportState): void {
    this.workspaceStates.set(state.workspaceId, state);
  }

  /**
   * Returns whether the panel manager is disposed.
   */
  public get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Returns current active WebviewPanel if open.
   */
  public get panel(): vscode.WebviewPanel | undefined {
    return this.currentPanel;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.coordinatorSubscription) {
      this.coordinatorSubscription.dispose();
      this.coordinatorSubscription = undefined;
    }

    if (this.currentPanel) {
      this.currentPanel.dispose();
      this.currentPanel = undefined;
    }

    this.workspaceStates.clear();
    this.coordinator = undefined;
  }
}
