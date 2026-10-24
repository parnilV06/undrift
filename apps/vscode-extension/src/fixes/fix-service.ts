// Fix proposal service bridging coordinator accepted analysis state
// to core FixGeneratorRegistry as specified in LLD.md Section 13.1 and Phase 5 Chunk 5.3.

import type {
  ApiObservation,
  ContractRelationship,
  DocumentUri,
  Finding,
  FindingId,
  FixGenerationContext,
  FixProposal,
  FixProposalId,
  ObservationId,
  RelationshipId,
  SourceDocument,
  WorkspaceId
} from "@undrift/core";
import { createDefaultFixGeneratorRegistry, FixGeneratorRegistry } from "@undrift/core";
import type { AnalysisCoordinator } from "../activation/coordinator";

/**
 * Service generating and resolving candidate fix proposals from trusted accepted analysis state.
 */
export class FixProposalService {
  private readonly registry: FixGeneratorRegistry;
  private readonly coordinator: AnalysisCoordinator;

  constructor(coordinator: AnalysisCoordinator, registry?: FixGeneratorRegistry) {
    this.coordinator = coordinator;
    this.registry = registry ?? createDefaultFixGeneratorRegistry();
  }

  /**
   * Generates candidate fix proposals for a specific finding in the accepted workspace state.
   */
  getProposalsForFinding(findingId: FindingId, workspaceId?: WorkspaceId): FixProposal[] {
    const wsId = workspaceId ?? this.coordinator.getActiveWorkspaceId();
    if (!wsId) return [];

    const acceptedResult = this.coordinator.getLastAcceptedAnalysisResult(wsId);
    if (!acceptedResult) return [];

    const sourceDocs = this.coordinator.getLastAcceptedSourceDocuments(wsId);
    if (!sourceDocs || sourceDocs.size === 0) return [];

    const finding = acceptedResult.findings.find((f) => f.id === findingId);
    if (!finding || finding.state !== "active") return [];

    const context = this.createGenerationContext(acceptedResult, wsId);
    const proposals = this.registry.generateProposals(finding, context);

    // Only return proposals strictly associated with this workspace and generation
    return proposals.filter(
      (p) => p.workspaceId === wsId && p.generation === acceptedResult.generation
    );
  }

  /**
   * Resolves a single proposal and its associated finding by proposal ID.
   */
  getProposalById(
    proposalId: FixProposalId,
    workspaceId?: WorkspaceId
  ): { proposal: FixProposal; finding: Finding } | undefined {
    const wsId = workspaceId ?? this.coordinator.getActiveWorkspaceId();
    if (!wsId) return undefined;

    const acceptedResult = this.coordinator.getLastAcceptedAnalysisResult(wsId);
    if (!acceptedResult) return undefined;

    const sourceDocs = this.coordinator.getLastAcceptedSourceDocuments(wsId);
    if (!sourceDocs || sourceDocs.size === 0) return undefined;

    const context = this.createGenerationContext(acceptedResult, wsId);

    for (const finding of acceptedResult.findings) {
      if (finding.state !== "active") continue;
      const proposals = this.registry.generateProposals(finding, context);
      const matched = proposals.find(
        (p) =>
          p.id === proposalId &&
          p.workspaceId === wsId &&
          p.generation === acceptedResult.generation
      );
      if (matched) {
        return { proposal: matched, finding };
      }
    }

    return undefined;
  }

  /**
   * Returns all active proposals grouped by FindingId for the accepted analysis.
   */
  getAllProposals(workspaceId?: WorkspaceId): Map<FindingId, FixProposal[]> {
    const map = new Map<FindingId, FixProposal[]>();
    const wsId = workspaceId ?? this.coordinator.getActiveWorkspaceId();
    if (!wsId) return map;

    const acceptedResult = this.coordinator.getLastAcceptedAnalysisResult(wsId);
    if (!acceptedResult) return map;

    const sourceDocs = this.coordinator.getLastAcceptedSourceDocuments(wsId);
    if (!sourceDocs || sourceDocs.size === 0) return map;

    const context = this.createGenerationContext(acceptedResult, wsId);

    for (const finding of acceptedResult.findings) {
      if (finding.state !== "active") continue;
      const proposals = this.registry.generateProposals(finding, context);
      const validProposals = proposals.filter(
        (p) => p.workspaceId === wsId && p.generation === acceptedResult.generation
      );
      if (validProposals.length > 0) {
        map.set(finding.id, validProposals);
      }
    }

    return map;
  }

  /**
   * Returns proposals relevant to a document URI and optional coordinate range (for CodeActionProvider).
   */
  getProposalsForDocument(
    documentUri: DocumentUri,
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    },
    workspaceId?: WorkspaceId
  ): Array<{ proposal: FixProposal; finding: Finding }> {
    const wsId = workspaceId ?? this.coordinator.getActiveWorkspaceId();
    if (!wsId) return [];

    const acceptedResult = this.coordinator.getLastAcceptedAnalysisResult(wsId);
    if (!acceptedResult) return [];

    const sourceDocs = this.coordinator.getLastAcceptedSourceDocuments(wsId);
    if (!sourceDocs || sourceDocs.size === 0) return [];

    const results: Array<{ proposal: FixProposal; finding: Finding }> = [];
    const context = this.createGenerationContext(acceptedResult, wsId);

    for (const finding of acceptedResult.findings) {
      if (finding.state !== "active") continue;

      const touchesDoc = finding.sourceLocations.some((loc) => loc.uri === documentUri);
      if (!touchesDoc) continue;

      const proposals = this.registry.generateProposals(finding, context);
      for (const proposal of proposals) {
        if (proposal.workspaceId !== wsId || proposal.generation !== acceptedResult.generation) {
          continue;
        }

        // If range specified, check if location or edit coordinates overlap
        if (range) {
          const overlapsLocation = finding.sourceLocations.some(
            (loc) => loc.uri === documentUri && this.rangesOverlap(loc, range)
          );
          const overlapsEdit = proposal.edits.some(
            (e) => e.documentUri === documentUri && this.rangesOverlap(e, range)
          );
          if (!overlapsLocation && !overlapsEdit) {
            continue;
          }
        }

        results.push({ proposal, finding });
      }
    }

    return results;
  }

  private createGenerationContext(
    result: {
      observations: ApiObservation[];
      relationships: ContractRelationship[];
      generation: number;
    },
    workspaceId: WorkspaceId
  ): FixGenerationContext {
    const observations = new Map<ObservationId, ApiObservation>(
      result.observations.map((o) => [o.id, o])
    );
    const relationships = new Map<RelationshipId, ContractRelationship>(
      result.relationships.map((r) => [r.id, r])
    );
    const sourceDocuments = this.coordinator.getLastAcceptedSourceDocuments(workspaceId);

    return {
      observations,
      relationships,
      sourceDocuments,
      generation: result.generation,
      workspaceId
    };
  }

  private rangesOverlap(
    a: { start: { line: number; character: number }; end: { line: number; character: number } },
    b: { start: { line: number; character: number }; end: { line: number; character: number } }
  ): boolean {
    if (
      a.end.line < b.start.line ||
      (a.end.line === b.start.line && a.end.character < b.start.character)
    ) {
      return false;
    }
    if (
      a.start.line > b.end.line ||
      (a.start.line === b.end.line && a.start.character > b.end.character)
    ) {
      return false;
    }
    return true;
  }
}
