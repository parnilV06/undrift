// Native VS Code Persistent Sidebar Overview Webview View for UNDRIFT
// adheres to Chunk 6.5 specification for theme-aware compact dashboard and Activity Bar integration.

import * as crypto from "crypto";
import type * as vscode from "vscode";
import {
  getDiagnosticGuidance,
  getWarningGuidance,
  type AnalysisCoverageSummary,
  type AnalysisWarning,
  type SourceSpan,
  type WorkspaceId
} from "@undrift/core";
import type {
  AnalysisCoordinator,
  CoordinatorAnalysisResult,
  RestoredSessionState
} from "../activation/coordinator";
import type { DiagnosticFindingSource } from "../diagnostics";
import type { ExtensionLogger } from "../logging/output-channel";
import { openFindingLocation, type VerificationState } from "./findings-tree";
import { escapeHtml, formatTimestamp } from "./report-panel";

/**
 * Presentation view model consumed by the Sidebar Overview Webview.
 */
export interface OverviewViewModel {
  readonly workspaceId?: WorkspaceId;
  readonly workspaceLabel: string;
  readonly status: VerificationState;
  readonly timestamp?: string;
  readonly statusMessage?: string;
  readonly findings: readonly DiagnosticFindingSource[];
  readonly warnings: readonly AnalysisWarning[];
  readonly coverage?: AnalysisCoverageSummary;
}

/**
 * Inbound messages sent from sidebar webview to extension host.
 */
export type OverviewWebviewMessage =
  | { readonly command: "openLocation"; readonly span: SourceSpan }
  | { readonly command: "openReport" }
  | { readonly command: "scanWorkspace" }
  | { readonly command: "refresh" };

/**
 * Theme-aware URIs for official brand logo assets rendered in Webviews.
 */
export interface BrandLogoUris {
  readonly light: string;
  readonly dark: string;
}

export const DEFAULT_BRAND_LOGO_URIS: BrandLogoUris = {
  light: "resources/undrift-light.png",
  dark: "resources/undrift-dark.png"
};

/**
 * Options for configuring OverviewViewProvider.
 */
export interface OverviewViewProviderOptions {
  coordinator?: AnalysisCoordinator;
  vscodeModule?: typeof vscode;
  logger?: ExtensionLogger;
  extensionUri?: vscode.Uri;
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
 * Extracts a compact file:line display string from a SourceSpan.
 */
export function formatLocationShort(span?: SourceSpan): string {
  if (!span?.uri) return "";
  const uri = span.uri.replace(/\\/g, "/");
  const filename = uri.split("/").pop() ?? uri;
  const line = span.start ? span.start.line + 1 : 1;
  return `${filename}:${line}`;
}

/**
 * Renders status badge for sidebar header.
 */
function renderSidebarStatusBadge(status: VerificationState): string {
  switch (status) {
    case "freshly-verified":
      return '<span class="status-badge status-fresh">Verified</span>';
    case "last-known":
      return '<span class="status-badge status-last-known">Last Known</span>';
    case "analysis-incomplete":
      return '<span class="status-badge status-incomplete">Incomplete</span>';
    case "analysis-failed":
      return '<span class="status-badge status-failed">Failed</span>';
    case "analysis-cancelled":
      return '<span class="status-badge status-neutral">Cancelled</span>';
    case "no-workspace":
      return '<span class="status-badge status-neutral">No Workspace</span>';
    case "no-analysis":
    default:
      return '<span class="status-badge status-neutral">Not Scanned</span>';
  }
}

/**
 * Pure function rendering the complete, self-contained HTML for the UNDRIFT Sidebar Overview.
 * Fully decoupled from VS Code APIs for fast, deterministic unit testing.
 */
export function renderOverviewHtml(
  model: OverviewViewModel,
  nonce = generateNonce(),
  logoUris: BrandLogoUris = DEFAULT_BRAND_LOGO_URIS,
  cspSource = "'self' vscode-resource: https:"
): string {
  const activeFindings = model.findings.filter((f) => f.state !== "resolved");
  const errorCount = activeFindings.filter((f) => f.severity === "error").length;
  const warningCount = activeFindings.filter((f) => f.severity === "warning").length;
  const infoCount = activeFindings.filter((f) => f.severity === "info").length;
  const limitationCount = model.warnings ? model.warnings.length : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UNDRIFT Overview</title>
  <style>
    :root {
      --color-error: var(--vscode-errorForeground, #f14c4c);
      --color-warning: var(--vscode-editorWarning-foreground, #cca700);
      --color-info: var(--vscode-editorInfo-foreground, #3794ff);
      --color-success: var(--vscode-testing-iconPassed, var(--vscode-gitDecoration-addedResourceForeground, #89d185));

      /* Neutral sidebar-aware surfaces */
      --card-bg: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background, rgba(127, 127, 127, 0.05)));
      --card-bg-subtle: var(--vscode-sideBar-background, rgba(127, 127, 127, 0.08));
      --border-color: var(--vscode-sideBar-border, var(--vscode-panel-border, rgba(127, 127, 127, 0.2)));
      --border-color-subtle: rgba(127, 127, 127, 0.12));
      --hover-bg: var(--vscode-list-hoverBackground, rgba(127, 127, 127, 0.08));
      --code-bg: var(--vscode-textCodeBlock-background, rgba(127, 127, 127, 0.08));
      --badge-bg: var(--vscode-badge-background, rgba(127, 127, 127, 0.2));
      --badge-fg: var(--vscode-badge-foreground, var(--vscode-editor-foreground, #cccccc));
    }
    body.vscode-light {
      --card-bg: var(--vscode-sideBarSectionHeader-background, var(--vscode-editorWidget-background, rgba(0, 0, 0, 0.03)));
      --card-bg-subtle: var(--vscode-sideBar-background, rgba(0, 0, 0, 0.04));
      --border-color: var(--vscode-sideBar-border, var(--vscode-panel-border, rgba(0, 0, 0, 0.12)));
      --border-color-subtle: rgba(0, 0, 0, 0.07);
      --hover-bg: var(--vscode-list-hoverBackground, rgba(0, 0, 0, 0.04));
      --code-bg: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.05));
    }
    body.vscode-high-contrast {
      --border-color: var(--vscode-contrastBorder, #ffffff);
      --border-color-subtle: var(--vscode-contrastBorder, #ffffff);
      --card-bg: transparent;
      --card-bg-subtle: transparent;
      --hover-bg: var(--vscode-list-hoverBackground, transparent);
      --code-bg: transparent;
    }
    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: var(--vscode-font-size, 12px);
      color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #cccccc));
      background-color: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
      margin: 0;
      padding: 12px 14px;
      line-height: 1.45;
      box-sizing: border-box;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    .overview-header {
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 14px;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .app-title {
      font-size: 13.5px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: var(--vscode-sideBarTitle-foreground, var(--vscode-editor-foreground, #ffffff));
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .brand-logo-container {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      line-height: 1;
    }
    .brand-logo {
      height: 18px;
      width: auto;
      max-width: 22px;
      object-fit: contain;
      vertical-align: middle;
    }
    .brand-logo-light {
      display: inline-block;
    }
    .brand-logo-dark {
      display: none;
    }
    body.vscode-light .brand-logo-light {
      display: none !important;
    }
    body.vscode-light .brand-logo-dark {
      display: inline-block !important;
    }
    body.vscode-dark .brand-logo-light {
      display: inline-block !important;
    }
    body.vscode-dark .brand-logo-dark {
      display: none !important;
    }
    body.vscode-high-contrast .brand-logo-light {
      display: inline-block !important;
    }
    body.vscode-high-contrast .brand-logo-dark {
      display: none !important;
    }
    body.vscode-high-contrast-light .brand-logo-light {
      display: none !important;
    }
    body.vscode-high-contrast-light .brand-logo-dark {
      display: inline-block !important;
    }
    .empty-state-brand {
      margin-bottom: 4px;
      display: flex;
      justify-content: center;
    }
    .empty-state-logo {
      height: 28px;
      width: auto;
      max-width: 34px;
      opacity: 0.85;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 3px;
      font-size: 10.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .status-fresh {
      background: var(--card-bg-subtle);
      color: var(--color-success);
      border: 1px solid var(--color-success);
    }
    .status-last-known {
      background: var(--card-bg-subtle);
      color: var(--color-info);
      border: 1px solid var(--color-info);
    }
    .status-incomplete {
      background: var(--card-bg-subtle);
      color: var(--color-warning);
      border: 1px solid var(--color-warning);
    }
    .status-failed {
      background: var(--card-bg-subtle);
      color: var(--color-error);
      border: 1px solid var(--color-error);
    }
    .status-neutral {
      background: var(--badge-bg);
      color: var(--badge-fg);
      border: 1px solid var(--border-color);
    }
    .workspace-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #888888);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .workspace-meta strong {
      color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #cccccc));
    }
    .actions-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }
    button {
      border: 1px solid transparent;
      padding: 6px 12px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: background 0.1s ease, border-color 0.1s ease;
      width: 100%;
    }
    .btn-primary {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
    }
    .btn-primary:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    .secondary-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      color: var(--vscode-button-secondaryForeground, #ffffff);
      padding: 5px 8px;
      font-size: 11px;
    }
    .btn-secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground, #45494e);
    }
    .metrics-summary {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 16px;
    }
    .metric-box {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .metric-box-hero {
      grid-column: span 2;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
    }
    .metric-val {
      font-size: 20px;
      font-weight: 700;
      line-height: 1;
      color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #ffffff));
    }
    .metric-val-hero {
      font-size: 24px;
    }
    .metric-lbl {
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: var(--vscode-descriptionForeground, #888888);
    }
    .section-heading {
      font-size: 11.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground, #888888);
      margin: 16px 0 8px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .findings-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .finding-item {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 8px 10px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: background 0.1s ease, border-color 0.1s ease;
      text-decoration: none;
      color: inherit;
    }
    .finding-item:hover {
      background: var(--hover-bg);
      border-color: var(--vscode-focusBorder, #007acc);
    }
    .finding-item-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .finding-title-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .severity-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot-error { background: var(--color-error); }
    .dot-warning { background: var(--color-warning); }
    .dot-info { background: var(--color-info); }
    .finding-rule {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #ffffff));
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .finding-route {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 11px;
      color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #dddddd));
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .finding-meta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10.5px;
      color: var(--vscode-descriptionForeground, #888888);
    }
    .finding-location {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 10.5px;
      color: var(--vscode-textLink-foreground, #3794ff);
    }
    .empty-state {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 16px 14px;
      text-align: center;
      color: var(--vscode-descriptionForeground, #888888);
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: center;
    }
    .empty-state-icon {
      font-size: 20px;
    }
    .empty-state-title {
      font-weight: 600;
      color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #ffffff));
    }
    .limitations-box {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 10px 12px;
      margin-top: 8px;
      font-size: 11.5px;
    }
    .limitations-title {
      font-weight: 600;
      color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground, #ffffff));
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
    }
    .limitations-note {
      color: var(--vscode-descriptionForeground, #888888);
      font-size: 11px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="overview-header">
    <div class="header-top">
      <div class="app-title">
        <span class="brand-logo-container" title="UNDRIFT">
          <img class="brand-logo brand-logo-light" src="${escapeHtml(logoUris.light)}" alt="UNDRIFT" />
          <img class="brand-logo brand-logo-dark" src="${escapeHtml(logoUris.dark)}" alt="UNDRIFT" />
        </span>
        <span class="app-title-text">UNDRIFT</span>
      </div>
      ${renderSidebarStatusBadge(model.status)}
    </div>
    <div class="workspace-meta">
      <div>Workspace: <strong>${escapeHtml(model.workspaceLabel)}</strong></div>
      ${
        model.timestamp
          ? `<div>Analyzed: <strong>${escapeHtml(formatTimestamp(model.timestamp))}</strong></div>`
          : ""
      }
    </div>
  </div>

  <div class="actions-section">
    <button type="button" class="btn-primary" data-action="open-report">Open Full Integration Report</button>
    <div class="secondary-actions">
      <button type="button" class="btn-secondary" data-action="scan">Scan Workspace</button>
      <button type="button" class="btn-secondary" data-action="refresh">Refresh</button>
    </div>
  </div>

  <div class="metrics-summary">
    <div class="metric-box metric-box-hero">
      <span class="metric-lbl">Active Drift Findings</span>
      <span class="metric-val metric-val-hero">${activeFindings.length}</span>
    </div>
    <div class="metric-box">
      <span class="metric-lbl">Errors</span>
      <span class="metric-val" style="color: var(--color-error)">${errorCount}</span>
    </div>
    <div class="metric-box">
      <span class="metric-lbl">Warnings</span>
      <span class="metric-val" style="color: var(--color-warning)">${warningCount}</span>
    </div>
    <div class="metric-box">
      <span class="metric-lbl">Information</span>
      <span class="metric-val" style="color: var(--color-info)">${infoCount}</span>
    </div>
    <div class="metric-box">
      <span class="metric-lbl">Coverage Limitations</span>
      <span class="metric-val" style="color: var(--vscode-descriptionForeground)">${limitationCount}</span>
    </div>
  </div>

  <div class="section-heading">
    <span>Findings Overview</span>
    <span>(${activeFindings.length})</span>
  </div>

  ${
    activeFindings.length > 0
      ? `
  <div class="findings-list">
    ${activeFindings
      .slice(0, 25)
      .map((finding) => {
        const dotClass =
          finding.severity === "error"
            ? "dot-error"
            : finding.severity === "warning"
              ? "dot-warning"
              : "dot-info";
        const primaryLoc = finding.sourceLocations && finding.sourceLocations[0];
        const spanJson = primaryLoc ? escapeHtml(JSON.stringify(primaryLoc)) : "";
        const obs =
          finding.observed && typeof finding.observed === "object"
            ? (finding.observed as Record<string, unknown>)
            : undefined;
        const routeMethod =
          obs && typeof obs.method === "string"
            ? `${obs.method} ${typeof obs.route === "string" ? obs.route : ""}`.trim()
            : (finding.summary ?? "");

        return `
    <div class="finding-item" data-action="open-location" data-span="${spanJson}" title="Click to navigate to source">
      <div class="finding-item-header">
        <div class="finding-title-row">
          <span class="severity-dot ${dotClass}"></span>
          <span class="finding-rule">${escapeHtml(finding.ruleId)} · ${escapeHtml(finding.title)}</span>
        </div>
      </div>
      ${routeMethod ? `<div class="finding-route">${escapeHtml(routeMethod)}</div>` : ""}
      <div class="finding-meta-row">
        <span>${escapeHtml(finding.category ?? "drift")}</span>
        ${primaryLoc ? `<span class="finding-location">${escapeHtml(formatLocationShort(primaryLoc))}</span>` : ""}
      </div>
    </div>`;
      })
      .join("")}
    ${
      activeFindings.length > 25
        ? `<div style="text-align: center; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 4px;">Showing first 25 of ${activeFindings.length} findings. Open Full Report to view all.</div>`
        : ""
    }
  </div>`
      : model.status === "no-workspace"
        ? `
  <div class="empty-state">
    <div class="empty-state-brand">
      <img class="brand-logo empty-state-logo brand-logo-light" src="${escapeHtml(logoUris.light)}" alt="UNDRIFT" />
      <img class="brand-logo empty-state-logo brand-logo-dark" src="${escapeHtml(logoUris.dark)}" alt="UNDRIFT" />
    </div>
    <div class="empty-state-title">No Workspace Open</div>
    <div>Open a workspace folder in VS Code to analyze API contracts.</div>
  </div>`
        : model.status === "no-analysis"
          ? `
  <div class="empty-state">
    <div class="empty-state-brand">
      <img class="brand-logo empty-state-logo brand-logo-light" src="${escapeHtml(logoUris.light)}" alt="UNDRIFT" />
      <img class="brand-logo empty-state-logo brand-logo-dark" src="${escapeHtml(logoUris.dark)}" alt="UNDRIFT" />
    </div>
    <div class="empty-state-title">Not Scanned Yet</div>
    <div>Click <strong>Scan Workspace</strong> above to analyze frontend and backend API contracts.</div>
  </div>`
          : model.status === "analysis-failed"
            ? `
  <div class="empty-state" style="border-left: 3px solid var(--color-error);">
    <div class="empty-state-brand">
      <img class="brand-logo empty-state-logo brand-logo-light" src="${escapeHtml(logoUris.light)}" alt="UNDRIFT" />
      <img class="brand-logo empty-state-logo brand-logo-dark" src="${escapeHtml(logoUris.dark)}" alt="UNDRIFT" />
    </div>
    <div class="empty-state-title" style="color: var(--color-error)">Analysis Failed</div>
    <div>${escapeHtml(model.statusMessage ?? "Scan encountered an error. Click Scan Workspace to retry.")}</div>
  </div>`
            : `
  <div class="empty-state" style="border-left: 3px solid var(--color-success);">
    <div class="empty-state-brand">
      <img class="brand-logo empty-state-logo brand-logo-light" src="${escapeHtml(logoUris.light)}" alt="UNDRIFT" />
      <img class="brand-logo empty-state-logo brand-logo-dark" src="${escapeHtml(logoUris.dark)}" alt="UNDRIFT" />
    </div>
    <div class="empty-state-title" style="color: var(--color-success)">No Contract Drift Detected</div>
    <div>All analyzed frontend consumers and backend providers are in sync.</div>
  </div>`
  }

  ${
    limitationCount > 0
      ? `
  <div class="section-heading">
    <span>Coverage Limitations</span>
    <span>(${limitationCount})</span>
  </div>
  <div class="limitations-box">
    <div class="limitations-title">
      <span>Static Scope Boundaries</span>
      <span>${limitationCount} advisory</span>
    </div>
    <div class="limitations-note">
      Advisory limitations (e.g. PARTIAL_SHAPE, dynamic routes) are kept separate from drift findings. Open the Full Integration Report for detailed resolution guidance.
    </div>
  </div>`
      : ""
  }

  <script nonce="${nonce}">
    (function() {
      const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;

      document.addEventListener('click', function(e) {
        const target = e.target;
        if (!target) return;

        const el = target.closest('[data-action]');
        if (!el) return;

        const action = el.getAttribute('data-action');
        if (action === 'open-report') {
          if (vscode) vscode.postMessage({ command: 'openReport' });
        } else if (action === 'scan') {
          if (vscode) vscode.postMessage({ command: 'scanWorkspace' });
        } else if (action === 'refresh') {
          if (vscode) vscode.postMessage({ command: 'refresh' });
        } else if (action === 'open-location') {
          const spanJson = el.getAttribute('data-span');
          if (spanJson && vscode) {
            try {
              const span = JSON.parse(spanJson);
              vscode.postMessage({ command: 'openLocation', span: span });
            } catch (err) {
              console.error('Failed to parse location span', err);
            }
          }
        }
      });
    })();
  </script>
</body>
</html>`;
}

/**
 * VS Code WebviewViewProvider for the persistent UNDRIFT sidebar overview.
 */
export class OverviewViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "undrift.overview";

  private view?: vscode.WebviewView;
  private readonly coordinator?: AnalysisCoordinator;
  private coordinatorSubscription?: { dispose(): void };
  private readonly vscodeModule?: typeof vscode;
  private readonly logger?: ExtensionLogger;
  private readonly extensionUri?: vscode.Uri;
  private currentModel?: OverviewViewModel;
  private disposed = false;

  constructor(options: OverviewViewProviderOptions = {}) {
    this.coordinator = options.coordinator;
    this.vscodeModule = options.vscodeModule;
    this.logger = options.logger;
    this.extensionUri = options.extensionUri;

    if (this.coordinator) {
      this.coordinatorSubscription = this.coordinator.onAnalysisCompleted((outcome) => {
        this.handleAnalysisOutcome(outcome);
      });

      const wsId = this.coordinator.getActiveWorkspaceId();
      if (wsId) {
        const snap = this.coordinator.getLastKnownSnapshot(wsId);
        if (snap) {
          this.setLastKnownModel(wsId, snap);
        } else {
          this.setInitialModel(wsId, "no-analysis");
        }
      } else {
        this.setInitialModel(undefined, "no-workspace");
      }
    }
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

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void | Promise<void> {
    if (this.disposed) return;
    this.view = webviewView;

    const vs = this.getVsCode();
    const localResourceRoots: vscode.Uri[] = [];
    if (this.extensionUri && vs?.Uri?.joinPath) {
      localResourceRoots.push(
        vs.Uri.joinPath(this.extensionUri, "resources"),
        vs.Uri.joinPath(this.extensionUri, "dist")
      );
    }

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: localResourceRoots.length > 0 ? localResourceRoots : undefined
    };

    webviewView.webview.onDidReceiveMessage((message: OverviewWebviewMessage) => {
      this.handleMessage(message);
    }, undefined);

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    this.render();
  }

  public getWebviewView(): vscode.WebviewView | undefined {
    return this.view;
  }

  public getCurrentModel(): OverviewViewModel | undefined {
    return this.currentModel;
  }

  private handleMessage(message: OverviewWebviewMessage): void {
    const vs = this.getVsCode();
    switch (message.command) {
      case "openLocation":
        if (message.span) {
          openFindingLocation(message.span, vs);
        }
        break;

      case "openReport":
        if (vs?.commands?.executeCommand) {
          void vs.commands.executeCommand("undrift.showReport");
        }
        break;

      case "scanWorkspace":
        if (vs?.commands?.executeCommand) {
          void vs.commands.executeCommand("undrift.scanWorkspace");
        }
        break;

      case "refresh":
        if (vs?.commands?.executeCommand) {
          void vs.commands.executeCommand("undrift.refresh");
        }
        break;
    }
  }

  public handleAnalysisOutcome(outcome: CoordinatorAnalysisResult): void {
    if (this.disposed) return;

    const wsId = outcome.workspaceId ?? this.coordinator?.getActiveWorkspaceId();
    const wsLabel = wsId ? (wsId.replace(/\\/g, "/").split("/").pop() ?? wsId) : "Workspace";

    let status: VerificationState = "freshly-verified";
    let findings: readonly DiagnosticFindingSource[] = [];
    let warnings: readonly AnalysisWarning[] = [];
    let coverage: AnalysisCoverageSummary | undefined;
    let timestamp = new Date().toISOString();

    switch (outcome.status) {
      case "success":
        status = "freshly-verified";
        findings = outcome.result?.findings ?? [];
        warnings = outcome.result?.warnings ?? [];
        coverage = outcome.reconciliation?.currentSnapshot?.coverage;
        timestamp = outcome.result?.generatedAt
          ? new Date(outcome.result.generatedAt).toISOString()
          : new Date().toISOString();
        break;

      case "incomplete":
        status = "analysis-incomplete";
        if (wsId) {
          const lastSnap = this.coordinator?.getLastKnownSnapshot(wsId);
          if (lastSnap) {
            findings = lastSnap.findings;
            warnings = outcome.result?.warnings ?? lastSnap.coverage?.warnings ?? [];
            coverage = outcome.reconciliation?.currentSnapshot?.coverage ?? lastSnap.coverage;
            timestamp = lastSnap.analyzedAt
              ? new Date(lastSnap.analyzedAt).toISOString()
              : new Date().toISOString();
          } else {
            findings = outcome.result?.findings ?? [];
            warnings = outcome.result?.warnings ?? [];
            coverage = outcome.reconciliation?.currentSnapshot?.coverage;
          }
        }
        break;

      case "failed":
        status = "analysis-failed";
        if (wsId) {
          const lastSnap = this.coordinator?.getLastKnownSnapshot(wsId);
          if (lastSnap) {
            status = "last-known";
            findings = lastSnap.findings;
            warnings = lastSnap.coverage?.warnings ?? [];
            coverage = lastSnap.coverage;
            timestamp = lastSnap.analyzedAt
              ? new Date(lastSnap.analyzedAt).toISOString()
              : new Date().toISOString();
          }
        }
        break;

      case "no-workspace":
        status = "no-workspace";
        break;

      case "cancelled":
        status = "analysis-cancelled";
        break;

      case "superseded":
        return;
    }

    this.currentModel = {
      workspaceId: wsId,
      workspaceLabel: wsLabel,
      status,
      timestamp,
      statusMessage: outcome.errorMessage,
      findings,
      warnings,
      coverage
    };

    this.render();
  }

  public handleSessionRestored(restored: RestoredSessionState): void {
    if (this.disposed) return;
    const wsId = restored.workspaceId ?? this.coordinator?.getActiveWorkspaceId();
    if (!wsId || restored.status === "no-workspace") {
      this.setInitialModel(undefined, "no-workspace");
      return;
    }

    if (restored.snapshot) {
      this.setLastKnownModel(wsId, restored.snapshot);
    } else {
      this.setInitialModel(wsId, "no-analysis");
    }
  }

  private setLastKnownModel(
    wsId: WorkspaceId,
    snap: {
      findings: readonly DiagnosticFindingSource[];
      analyzedAt?: number;
      coverage?: AnalysisCoverageSummary;
    }
  ): void {
    const wsLabel = wsId.replace(/\\/g, "/").split("/").pop() ?? wsId;
    this.currentModel = {
      workspaceId: wsId,
      workspaceLabel: wsLabel,
      status: "last-known",
      timestamp: snap.analyzedAt ? new Date(snap.analyzedAt).toISOString() : undefined,
      findings: snap.findings,
      warnings: snap.coverage?.warnings ?? [],
      coverage: snap.coverage
    };
    this.render();
  }

  private setInitialModel(wsId: WorkspaceId | undefined, status: VerificationState): void {
    const wsLabel = wsId ? (wsId.replace(/\\/g, "/").split("/").pop() ?? wsId) : "Workspace";
    this.currentModel = {
      workspaceId: wsId,
      workspaceLabel: wsLabel,
      status,
      findings: [],
      warnings: []
    };
    this.render();
  }

  private render(): void {
    if (!this.currentModel) return;

    // Update Activity Bar badge on the view if available
    this.updateBadge();

    if (this.view) {
      const vs = this.getVsCode();
      let logoUris: BrandLogoUris = DEFAULT_BRAND_LOGO_URIS;
      if (
        this.extensionUri &&
        vs?.Uri?.joinPath &&
        typeof this.view.webview.asWebviewUri === "function"
      ) {
        logoUris = {
          light: this.view.webview
            .asWebviewUri(vs.Uri.joinPath(this.extensionUri, "resources", "undrift-light.png"))
            .toString(),
          dark: this.view.webview
            .asWebviewUri(vs.Uri.joinPath(this.extensionUri, "resources", "undrift-dark.png"))
            .toString()
        };
      }
      this.view.webview.html = renderOverviewHtml(
        this.currentModel,
        generateNonce(),
        logoUris,
        this.view.webview.cspSource
      );
    }
  }

  public updateBadge(): void {
    if (!this.currentModel) return;
    const activeFindingsCount = this.currentModel.findings.filter(
      (f) => f.state !== "resolved"
    ).length;

    if (this.view) {
      if (
        activeFindingsCount > 0 &&
        this.currentModel.status !== "no-workspace" &&
        this.currentModel.status !== "no-analysis"
      ) {
        this.view.badge = {
          value: activeFindingsCount,
          tooltip: `${activeFindingsCount} active drift finding${activeFindingsCount === 1 ? "" : "s"} in the current workspace`
        };
      } else {
        this.view.badge = undefined;
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.coordinatorSubscription) {
      this.coordinatorSubscription.dispose();
      this.coordinatorSubscription = undefined;
    }
    this.view = undefined;
  }
}
