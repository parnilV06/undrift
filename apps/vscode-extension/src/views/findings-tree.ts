// Native VS Code TreeDataProvider for UNDRIFT Contract Drift sidebar view
// strictly adhering to LLD.md Sections 14.3, 14.5, 14.9, and Chunk 4.6.

import type * as vscode from "vscode";
import type {
  AnalysisSnapshot,
  DocumentUri,
  FindingCategory,
  FindingLifecycleEvent,
  FindingSeverity,
  SourceSpan,
  WorkspaceId
} from "@undrift/core";
import type {
  AnalysisCoordinator,
  CoordinatorAnalysisResult,
  RestoredSessionState
} from "../activation/coordinator";
import {
  type DiagnosticFindingSource,
  parseDocumentUri,
  sourceSpanToVsCodeRange
} from "../diagnostics";
import type { ExtensionLogger } from "../logging/output-channel";

/**
 * High-level verification presentation state distinguishing freshly verified current code
 * from last-known restored/persisted snapshots and incomplete scans.
 */
export type VerificationState =
  | "freshly-verified"
  | "last-known"
  | "analysis-incomplete"
  | "analysis-failed"
  | "analysis-cancelled"
  | "no-analysis"
  | "no-workspace";

/**
 * Structured presentation status exposed by the findings tree provider.
 */
export interface TreeViewStatus {
  readonly state: VerificationState;
  readonly timestamp?: string;
  readonly message?: string;
}

/**
 * Discriminator kinds for items in the UNDRIFT findings tree.
 */
export type TreeItemKind = "status" | "group" | "finding" | "location" | "metadata" | "empty";

/**
 * Fallback TreeItem implementation for headless/testing environments where vscode.TreeItem is absent.
 */
export class FallbackTreeItem {
  public id?: string;
  public iconPath?: unknown;
  public description?: string | boolean;
  public resourceUri?: unknown;
  public tooltip?: string | unknown;
  public command?: unknown;
  public contextValue?: string;
  public accessibilityInformation?: unknown;

  constructor(
    public label: string | vscode.TreeItemLabel,
    public collapsibleState: vscode.TreeItemCollapsibleState = 0 as vscode.TreeItemCollapsibleState
  ) {}
}

export enum FallbackTreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2
}

export class FallbackThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: unknown
  ) {}
}

export class FallbackThemeColor {
  constructor(public readonly id: string) {}
}

export class FallbackEventEmitter<T> {
  private listeners: ((e: T) => unknown)[] = [];
  public readonly event = (listener: (e: T) => unknown) => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      }
    };
  };
  public fire(data?: T): void {
    for (const l of [...this.listeners]) {
      try {
        l(data as T);
      } catch {
        // ignore
      }
    }
  }
  public dispose(): void {
    this.listeners = [];
  }
}

function getVsCodeNamespace(): typeof vscode | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("vscode");
  } catch {
    return undefined;
  }
}

const vsNs = getVsCodeNamespace();

export const BaseTreeItem: typeof vscode.TreeItem =
  vsNs?.TreeItem ?? (FallbackTreeItem as unknown as typeof vscode.TreeItem);

export const TreeCollapsibleState: typeof vscode.TreeItemCollapsibleState =
  (vsNs?.TreeItemCollapsibleState ??
    FallbackTreeItemCollapsibleState) as typeof vscode.TreeItemCollapsibleState;

export const ThemeIconClass: typeof vscode.ThemeIcon =
  vsNs?.ThemeIcon ?? (FallbackThemeIcon as unknown as typeof vscode.ThemeIcon);

export const ThemeColorClass: typeof vscode.ThemeColor =
  vsNs?.ThemeColor ?? (FallbackThemeColor as unknown as typeof vscode.ThemeColor);

export const EventEmitterClass = vsNs?.EventEmitter ?? FallbackEventEmitter;

/**
 * Base tree item in the UNDRIFT findings tree view.
 */
export abstract class FindingsTreeItem extends BaseTreeItem {
  public abstract readonly kind: TreeItemKind;

  constructor(
    label: string | vscode.TreeItemLabel,
    collapsibleState: vscode.TreeItemCollapsibleState = TreeCollapsibleState.None
  ) {
    super(label, collapsibleState);
  }
}

/**
 * Status header item at the root of the tree view communicating analysis freshness.
 */
export class StatusTreeItem extends FindingsTreeItem {
  public readonly kind: TreeItemKind = "status";

  constructor(public readonly status: TreeViewStatus) {
    const label = formatStatusLabel(status.state);
    super(label, TreeCollapsibleState.None);

    this.contextValue = "undrift.statusItem";
    this.description = formatStatusDescription(status);
    this.tooltip = formatStatusTooltip(status);
    this.iconPath = getStatusThemeIcon(status.state);
  }
}

/**
 * Group node aggregating findings by severity or category.
 */
export class GroupTreeItem extends FindingsTreeItem {
  public readonly kind: TreeItemKind = "group";

  constructor(
    public readonly groupKey: string,
    public readonly groupTitle: string,
    public readonly findings: readonly DiagnosticFindingSource[],
    collapsibleState: vscode.TreeItemCollapsibleState = TreeCollapsibleState.Expanded
  ) {
    super(`${groupTitle} (${findings.length})`, collapsibleState);

    this.contextValue = `undrift.group.${groupKey}`;
    this.description = `${findings.length} finding${findings.length === 1 ? "" : "s"}`;
    this.tooltip = `${groupTitle}: ${findings.length} finding${findings.length === 1 ? "" : "s"}`;
    this.iconPath = getGroupThemeIcon(groupKey);
  }
}

/**
 * Leaf node representing a specific contract drift finding.
 */
export class FindingTreeItem extends FindingsTreeItem {
  public readonly kind: TreeItemKind = "finding";

  constructor(
    public readonly finding: DiagnosticFindingSource,
    public readonly latestLifecycleEvent?: FindingLifecycleEvent,
    collapsibleState: vscode.TreeItemCollapsibleState = TreeCollapsibleState.Collapsed
  ) {
    super(finding.title, collapsibleState);

    this.contextValue = `undrift.finding.${finding.severity}`;
    this.description = formatFindingDescription(finding, latestLifecycleEvent);
    this.tooltip = formatFindingTooltip(finding, latestLifecycleEvent);
    this.iconPath = getSeverityThemeIcon(finding.severity);

    // Primary navigation command when item itself is selected
    const primarySpan = finding.sourceLocations?.[0];
    if (primarySpan && sourceSpanToVsCodeRange(primarySpan)) {
      this.command = {
        command: "undrift.openFindingLocation",
        title: "Open Location",
        arguments: [primarySpan]
      };
    }
  }
}

/**
 * Child item representing a source location (consumer or provider side).
 */
export class LocationTreeItem extends FindingsTreeItem {
  public readonly kind: TreeItemKind = "location";

  constructor(
    public readonly role: "consumer" | "provider" | "location",
    public readonly span: SourceSpan,
    findingTitle: string
  ) {
    const baseName = extractBaseName(span.uri);
    const line1 = span.start ? span.start.line + 1 : 1;
    const col1 = span.start ? span.start.character + 1 : 1;
    const rolePrefix =
      role === "consumer" ? "Consumer" : role === "provider" ? "Provider" : "Location";

    super(`${rolePrefix}: ${baseName}:${line1}`, TreeCollapsibleState.None);

    this.contextValue = `undrift.location.${role}`;
    this.description = `line ${line1}, col ${col1}`;
    this.tooltip = `${rolePrefix} side for "${findingTitle}"\n${span.uri} [${line1}:${col1}]`;
    this.iconPath = new ThemeIconClass(role === "provider" ? "server" : "file-code");

    if (sourceSpanToVsCodeRange(span)) {
      this.command = {
        command: "undrift.openFindingLocation",
        title: "Open Location",
        arguments: [span]
      };
    }
  }
}

/**
 * Child item representing confidence, evidence, or lifecycle metadata.
 */
export class MetadataTreeItem extends FindingsTreeItem {
  public readonly kind: TreeItemKind = "metadata";

  constructor(
    public readonly metaKey: "evidence" | "history" | "category" | "rule",
    label: string,
    description?: string,
    iconName?: string
  ) {
    super(label, TreeCollapsibleState.None);

    this.contextValue = `undrift.metadata.${metaKey}`;
    this.description = description;
    if (iconName) {
      this.iconPath = new ThemeIconClass(iconName);
    }
  }
}

/**
 * Informational empty-state tree item.
 */
export class EmptyTreeItem extends FindingsTreeItem {
  public readonly kind: TreeItemKind = "empty";

  constructor(title: string, message: string, iconName = "info") {
    super(title, TreeCollapsibleState.None);

    this.contextValue = "undrift.emptyItem";
    this.description = message;
    this.tooltip = `${title}: ${message}`;
    this.iconPath = new ThemeIconClass(iconName);
  }
}

/**
 * Options for configuring FindingsTreeDataProvider.
 */
export interface FindingsTreeDataProviderOptions {
  /** The analysis coordinator to subscribe to for verified analysis outcomes. */
  coordinator?: AnalysisCoordinator;
  /** Primary grouping strategy for findings: by severity (default) or category. */
  groupBy?: "severity" | "category";
  /** Injected vscode module for testing environments. */
  vscodeModule?: typeof vscode;
  /** Optional diagnostic logger. */
  logger?: ExtensionLogger;
}

interface WorkspaceViewState {
  workspaceId: WorkspaceId;
  status: VerificationState;
  timestamp?: string;
  message?: string;
  findings: readonly DiagnosticFindingSource[];
  history: readonly FindingLifecycleEvent[];
}

/**
 * Native VS Code TreeDataProvider implementation for the UNDRIFT Contract Drift sidebar view.
 */
export class FindingsTreeDataProvider
  implements vscode.TreeDataProvider<FindingsTreeItem>, vscode.Disposable
{
  private readonly _onDidChangeTreeData: vscode.EventEmitter<FindingsTreeItem | undefined | void>;
  public readonly onDidChangeTreeData: vscode.Event<FindingsTreeItem | undefined | void>;

  private readonly vscodeModule?: typeof vscode;
  private readonly logger?: ExtensionLogger;
  private groupBy: "severity" | "category";

  /** View state partitioned by WorkspaceId to enforce strict workspace isolation. */
  private readonly workspaceStates = new Map<WorkspaceId, WorkspaceViewState>();
  private activeWorkspaceId?: WorkspaceId;

  private coordinatorSubscription?: { dispose(): void };
  private coordinator?: AnalysisCoordinator;
  private disposed = false;

  constructor(options: FindingsTreeDataProviderOptions = {}) {
    this.vscodeModule = options.vscodeModule;
    this.logger = options.logger;
    this.groupBy = options.groupBy ?? "severity";

    const vs = this.getVsCode();
    const EE = vs?.EventEmitter ?? EventEmitterClass;
    this._onDidChangeTreeData = new EE<FindingsTreeItem | undefined | void>();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    if (options.coordinator) {
      this.setCoordinator(options.coordinator);
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

  /**
   * Sets or updates the AnalysisCoordinator connection.
   */
  public setCoordinator(coordinator: AnalysisCoordinator): void {
    if (this.coordinatorSubscription) {
      this.coordinatorSubscription.dispose();
      this.coordinatorSubscription = undefined;
    }

    this.coordinator = coordinator;

    // Subscribe to coordinator analysis completion outcomes
    this.coordinatorSubscription = coordinator.onAnalysisCompleted((outcome) => {
      this.handleAnalysisOutcome(outcome);
    });

    // Populate initial state from coordinator if a restored snapshot or active workspace is present
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
          history: hist
        });
      }
    }
  }

  /**
   * Refreshes the tree view display.
   */
  public refresh(): void {
    if (this.disposed) return;
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: FindingsTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: FindingsTreeItem): FindingsTreeItem[] {
    if (this.disposed) return [];

    const state = this.getCurrentViewState();

    // 1. Root level items
    if (!element) {
      return this.getRootItems(state);
    }

    // 2. Group level children: return finding items for that group
    if (element instanceof GroupTreeItem) {
      return this.getFindingItemsForGroup(element, state);
    }

    // 3. Finding level children: return locations and metadata
    if (element instanceof FindingTreeItem) {
      return this.getDetailItemsForFinding(element);
    }

    // 4. Leaf items: no children
    return [];
  }

  /**
   * Constructs root-level items including status header, empty states, or group nodes.
   */
  private getRootItems(state?: WorkspaceViewState): FindingsTreeItem[] {
    if (!state || state.status === "no-workspace") {
      return [
        new EmptyTreeItem(
          "No workspace open",
          "Open a workspace folder to detect API contract drift"
        )
      ];
    }

    const statusItem = new StatusTreeItem({
      state: state.status,
      timestamp: state.timestamp,
      message: state.message
    });

    if (state.status === "no-analysis") {
      return [
        statusItem,
        new EmptyTreeItem(
          "No analysis available",
          "Run 'UNDRIFT: Scan Workspace' to detect contract drift"
        )
      ];
    }

    if (state.findings.length === 0) {
      return [
        statusItem,
        new EmptyTreeItem(
          "No contract drift detected",
          "All analyzed consumer and provider contracts match",
          "check"
        )
      ];
    }

    // Findings present: render status item followed by groups
    const groupItems =
      this.groupBy === "category"
        ? this.groupFindingsByCategory(state.findings)
        : this.groupFindingsBySeverity(state.findings);

    return [statusItem, ...groupItems];
  }

  /**
   * Groups findings by severity: Error, Warning, Information.
   */
  private groupFindingsBySeverity(findings: readonly DiagnosticFindingSource[]): GroupTreeItem[] {
    const errorList: DiagnosticFindingSource[] = [];
    const warnList: DiagnosticFindingSource[] = [];
    const infoList: DiagnosticFindingSource[] = [];

    for (const f of findings) {
      if (f.state !== "active") continue;
      if (f.severity === "error") errorList.push(f);
      else if (f.severity === "warning") warnList.push(f);
      else infoList.push(f);
    }

    const groups: GroupTreeItem[] = [];
    if (errorList.length > 0) {
      groups.push(new GroupTreeItem("error", "Errors", errorList));
    }
    if (warnList.length > 0) {
      groups.push(new GroupTreeItem("warning", "Warnings", warnList));
    }
    if (infoList.length > 0) {
      groups.push(new GroupTreeItem("info", "Information", infoList));
    }

    return groups;
  }

  /**
   * Groups findings by category: existence, route, request-shape, response-shape, type, analysis-limit.
   */
  private groupFindingsByCategory(findings: readonly DiagnosticFindingSource[]): GroupTreeItem[] {
    const catMap = new Map<FindingCategory, DiagnosticFindingSource[]>();

    for (const f of findings) {
      if (f.state !== "active") continue;
      const cat = f.category ?? "existence";
      let list = catMap.get(cat);
      if (!list) {
        list = [];
        catMap.set(cat, list);
      }
      list.push(f);
    }

    const categoryOrder: FindingCategory[] = [
      "existence",
      "route",
      "request-shape",
      "response-shape",
      "type",
      "analysis-limit"
    ];

    const categoryLabels: Record<FindingCategory, string> = {
      existence: "Missing Endpoint",
      route: "Route Parameter",
      "request-shape": "Request Shape",
      "response-shape": "Response Shape",
      type: "Type Mismatch",
      "analysis-limit": "Analysis Limitation"
    };

    const groups: GroupTreeItem[] = [];
    for (const cat of categoryOrder) {
      const list = catMap.get(cat);
      if (list && list.length > 0) {
        groups.push(new GroupTreeItem(cat, categoryLabels[cat], list));
      }
    }

    return groups;
  }

  /**
   * Returns finding items under a group node.
   */
  private getFindingItemsForGroup(
    group: GroupTreeItem,
    state?: WorkspaceViewState
  ): FindingTreeItem[] {
    const history = state?.history ?? [];
    const historyMap = this.buildLatestHistoryMap(history);

    return group.findings.map((f) => {
      const latestEvent = historyMap.get(f.id);
      return new FindingTreeItem(f, latestEvent);
    });
  }

  /**
   * Returns child detail items for a specific finding (locations, evidence, lifecycle history).
   */
  private getDetailItemsForFinding(element: FindingTreeItem): FindingsTreeItem[] {
    const finding = element.finding;
    const items: FindingsTreeItem[] = [];

    // 1. Source locations (Consumer and Provider sides)
    const locations = finding.sourceLocations ?? [];
    if (locations.length >= 2) {
      items.push(new LocationTreeItem("consumer", locations[0], finding.title));
      items.push(new LocationTreeItem("provider", locations[1], finding.title));
      for (let i = 2; i < locations.length; i++) {
        items.push(new LocationTreeItem("location", locations[i], finding.title));
      }
    } else if (locations.length === 1) {
      const role = finding.ruleId === "UND110" ? "provider" : "consumer";
      items.push(new LocationTreeItem(role, locations[0], finding.title));
    }

    // 2. Evidence strength metadata
    if (finding.evidenceStrength) {
      items.push(
        new MetadataTreeItem(
          "evidence",
          `Evidence: ${finding.evidenceStrength}`,
          `Category: ${finding.category}`,
          "shield"
        )
      );
    }

    // 3. Rule identifier
    items.push(new MetadataTreeItem("rule", `Rule: ${finding.ruleId}`, finding.title, "tag"));

    // 4. Historical lifecycle event if present
    if (element.latestLifecycleEvent) {
      const evt = element.latestLifecycleEvent;
      const formattedDate = formatTimestamp(new Date(evt.observedAt).toISOString());
      items.push(
        new MetadataTreeItem(
          "history",
          `History: ${evt.transitionKind}`,
          `Observed ${formattedDate} (gen ${evt.triggerGeneration})`,
          "history"
        )
      );
    }

    return items;
  }

  /**
   * Maps lifecycle events by findingId, picking the latest event for each finding.
   */
  private buildLatestHistoryMap(
    history: readonly FindingLifecycleEvent[]
  ): Map<string, FindingLifecycleEvent> {
    const map = new Map<string, FindingLifecycleEvent>();
    for (const evt of history) {
      const existing = map.get(evt.findingId);
      if (!existing || evt.observedAt >= existing.observedAt) {
        map.set(evt.findingId, evt);
      }
    }
    return map;
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
        history: []
      });
      this.refresh();
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
        history: restored.history ?? []
      });
    } else {
      this.setWorkspaceState({
        workspaceId: wsId,
        status: "no-analysis",
        findings: [],
        history: restored.history ?? []
      });
    }

    this.refresh();
  }

  /**
   * Handles coordinator analysis completion outcomes.
   * Enforces stale-result and incomplete-analysis protections:
   * - Incomplete analyses preserve last known complete findings.
   * - Failed, cancelled, and superseded results do NOT overwrite current tree state.
   */
  public handleAnalysisOutcome(outcome: CoordinatorAnalysisResult): void {
    if (this.disposed) return;

    switch (outcome.status) {
      case "superseded": {
        // Obsolete scan must not update tree state
        this.logger?.info("FindingsTreeDataProvider: ignored superseded scan outcome.");
        return;
      }

      case "no-workspace": {
        this.setWorkspaceState({
          workspaceId: "no-workspace" as WorkspaceId,
          status: "no-workspace",
          findings: [],
          history: []
        });
        this.refresh();
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

        this.setWorkspaceState({
          workspaceId: wsId,
          status: "freshly-verified",
          timestamp,
          findings,
          history
        });
        this.refresh();
        return;
      }

      case "incomplete": {
        const wsId = outcome.workspaceId;
        if (!wsId) return;
        this.activeWorkspaceId = wsId;

        // INCOMPLETE ANALYSIS SAFETY:
        // Do NOT replace the last known complete findings with partial results!
        // Preserve prior snapshot findings and prior timestamp, while updating status.
        const prior = this.workspaceStates.get(wsId);
        const priorFindings =
          prior?.findings ?? this.coordinator?.getLastKnownSnapshot(wsId)?.findings ?? [];
        const priorTimestamp =
          prior?.timestamp ??
          (this.coordinator?.getLastKnownSnapshot(wsId)?.analyzedAt
            ? new Date(this.coordinator.getLastKnownSnapshot(wsId)!.analyzedAt).toISOString()
            : undefined);
        const history = prior?.history ?? this.coordinator?.getLastKnownHistory(wsId) ?? [];

        this.setWorkspaceState({
          workspaceId: wsId,
          status: "analysis-incomplete",
          timestamp: priorTimestamp,
          message: "Coverage incomplete; preserving last known state",
          findings: priorFindings,
          history
        });
        this.refresh();
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
          this.refresh();
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
          this.refresh();
        }
        return;
      }
    }
  }

  /**
   * Retrieves current presentation status for the active workspace.
   */
  public getStatus(workspaceId?: WorkspaceId): TreeViewStatus {
    const wsId = workspaceId ?? this.activeWorkspaceId;
    const state = wsId ? this.workspaceStates.get(wsId) : undefined;
    return {
      state: state?.status ?? "no-analysis",
      timestamp: state?.timestamp,
      message: state?.message
    };
  }

  /**
   * Retrieves active findings for a specific workspace.
   */
  public getFindings(workspaceId?: WorkspaceId): readonly DiagnosticFindingSource[] {
    const wsId = workspaceId ?? this.activeWorkspaceId;
    const state = wsId ? this.workspaceStates.get(wsId) : undefined;
    return state?.findings ?? [];
  }

  /**
   * Returns active workspace ID.
   */
  public getActiveWorkspaceId(): WorkspaceId | undefined {
    return this.activeWorkspaceId;
  }

  /**
   * Explicitly sets active workspace ID for multi-workspace navigation.
   */
  public setActiveWorkspaceId(workspaceId?: WorkspaceId): void {
    this.activeWorkspaceId = workspaceId;
    this.refresh();
  }

  /**
   * Changes grouping mode between severity and category.
   */
  public setGrouping(groupBy: "severity" | "category"): void {
    if (this.groupBy !== groupBy) {
      this.groupBy = groupBy;
      this.refresh();
    }
  }

  private getCurrentViewState(): WorkspaceViewState | undefined {
    if (this.activeWorkspaceId) {
      return this.workspaceStates.get(this.activeWorkspaceId);
    }
    if (this.workspaceStates.size > 0) {
      return this.workspaceStates.values().next().value;
    }
    return undefined;
  }

  private setWorkspaceState(state: WorkspaceViewState): void {
    this.workspaceStates.set(state.workspaceId, state);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.coordinatorSubscription) {
      this.coordinatorSubscription.dispose();
      this.coordinatorSubscription = undefined;
    }

    this._onDidChangeTreeData.dispose();
    this.workspaceStates.clear();
    this.coordinator = undefined;
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }
}

/**
 * Formats user-facing status label.
 */
function formatStatusLabel(state: VerificationState): string {
  switch (state) {
    case "freshly-verified":
      return "Freshly Verified Current Source";
    case "last-known":
      return "Last Known Analyzed State";
    case "analysis-incomplete":
      return "Analysis Incomplete";
    case "analysis-failed":
      return "Analysis Failed";
    case "analysis-cancelled":
      return "Analysis Cancelled";
    case "no-workspace":
      return "No Workspace Open";
    case "no-analysis":
      return "No Prior Analysis";
  }
}

/**
 * Formats user-facing status description.
 */
function formatStatusDescription(status: TreeViewStatus): string | undefined {
  if (status.state === "freshly-verified" && status.timestamp) {
    return formatTimestamp(status.timestamp);
  }
  if (status.state === "last-known" && status.timestamp) {
    return `Analyzed: ${formatTimestamp(status.timestamp)}`;
  }
  if (status.state === "analysis-incomplete") {
    return status.timestamp
      ? `Retaining last state (${formatTimestamp(status.timestamp)})`
      : "Coverage incomplete";
  }
  if (status.state === "analysis-failed") {
    return "Retaining last known state";
  }
  if (status.state === "analysis-cancelled") {
    return "Retaining last known state";
  }
  return status.message;
}

/**
 * Formats detailed status tooltip.
 */
function formatStatusTooltip(status: TreeViewStatus): string {
  switch (status.state) {
    case "freshly-verified":
      return `Freshly verified from current source code at ${formatTimestamp(status.timestamp)}.`;
    case "last-known":
      return `Showing last known analyzed state from ${formatTimestamp(status.timestamp)}. Source code may have changed since last analysis.`;
    case "analysis-incomplete":
      return `Latest analysis attempt was incomplete. Retaining last known complete analysis from ${formatTimestamp(status.timestamp)} without falsely resolving findings.`;
    case "analysis-failed":
      return "Latest analysis attempt failed. Retaining last known complete state.";
    case "analysis-cancelled":
      return "Latest analysis attempt was cancelled. Retaining last known complete state.";
    case "no-workspace":
      return "No workspace folder is currently open in VS Code.";
    case "no-analysis":
      return "No prior contract analysis has run for this workspace.";
  }
}

function getStatusThemeIcon(state: VerificationState): vscode.ThemeIcon {
  switch (state) {
    case "freshly-verified":
      return new ThemeIconClass("check", new ThemeColorClass("testing.iconPassed"));
    case "last-known":
      return new ThemeIconClass("history");
    case "analysis-incomplete":
      return new ThemeIconClass("warning", new ThemeColorClass("warningForeground"));
    case "analysis-failed":
      return new ThemeIconClass("error", new ThemeColorClass("errorForeground"));
    case "analysis-cancelled":
      return new ThemeIconClass("circle-slash");
    case "no-workspace":
    case "no-analysis":
      return new ThemeIconClass("info");
  }
}

function getSeverityThemeIcon(severity: FindingSeverity): vscode.ThemeIcon {
  switch (severity) {
    case "error":
      return new ThemeIconClass("error", new ThemeColorClass("errorForeground"));
    case "warning":
      return new ThemeIconClass("warning", new ThemeColorClass("warningForeground"));
    case "info":
      return new ThemeIconClass("info", new ThemeColorClass("infoForeground"));
  }
}

function getGroupThemeIcon(key: string): vscode.ThemeIcon {
  switch (key) {
    case "error":
      return new ThemeIconClass("error", new ThemeColorClass("errorForeground"));
    case "warning":
      return new ThemeIconClass("warning", new ThemeColorClass("warningForeground"));
    case "info":
      return new ThemeIconClass("info", new ThemeColorClass("infoForeground"));
    case "existence":
      return new ThemeIconClass("plug");
    case "route":
      return new ThemeIconClass("symbol-route");
    case "request-shape":
    case "response-shape":
      return new ThemeIconClass("symbol-structure");
    case "type":
      return new ThemeIconClass("symbol-type-parameter");
    case "analysis-limit":
      return new ThemeIconClass("report");
    default:
      return new ThemeIconClass("folder");
  }
}

function formatFindingDescription(
  finding: DiagnosticFindingSource,
  latestEvent?: FindingLifecycleEvent
): string {
  const parts: string[] = [finding.ruleId];
  if (finding.category) {
    parts.push(finding.category);
  }
  if (finding.evidenceStrength) {
    parts.push(finding.evidenceStrength);
  }
  if (latestEvent) {
    parts.push(`lifecycle: ${latestEvent.transitionKind}`);
  }
  return parts.join(" • ");
}

function formatFindingTooltip(
  finding: DiagnosticFindingSource,
  latestEvent?: FindingLifecycleEvent
): string {
  const lines: string[] = [
    `${finding.title} [${finding.ruleId}]`,
    `Severity: ${finding.severity}`,
    `Category: ${finding.category}`,
    `State: ${finding.state}`,
    `Evidence: ${finding.evidenceStrength ?? "direct"}`
  ];

  if (finding.summary) {
    lines.push("", finding.summary);
  }

  if (latestEvent) {
    const timeStr = formatTimestamp(new Date(latestEvent.observedAt).toISOString());
    lines.push(
      "",
      `Lifecycle: ${latestEvent.transitionKind} at ${timeStr} (gen ${latestEvent.triggerGeneration})`
    );
  }

  return lines.join("\n");
}

function formatTimestamp(isoString?: string): string {
  if (!isoString) return "unknown time";
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleString();
  } catch {
    return isoString;
  }
}

function extractBaseName(uriStr: string): string {
  try {
    const normalized = uriStr.replace(/\\/g, "/");
    return normalized.split("/").pop() ?? uriStr;
  } catch {
    return uriStr;
  }
}

/**
 * Navigation command helper to open a source file at the specified SourceSpan position.
 */
export async function openFindingLocation(
  span?: SourceSpan,
  vscodeMod?: typeof vscode
): Promise<void> {
  if (!span?.uri) return;
  const uri = parseDocumentUri(span.uri);
  const range = sourceSpanToVsCodeRange(span);
  if (!uri) return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vs = vscodeMod ?? require("vscode");
    const doc = await vs.workspace.openTextDocument(uri);
    await vs.window.showTextDocument(doc, {
      selection: range
    });
  } catch {
    // ignore open failure
  }
}
