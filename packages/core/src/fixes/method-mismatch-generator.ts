// Conservative HTTP Method Conflict (UND120) fix generator adhering to LLD.md Section 13.1
// and PRD.md Section 13.1-13.3.
// Generates mutually exclusive consumer-side and provider-side mechanical repair proposals
// without assuming either side is universally authoritative.

import {
  createFixProposalId,
  createProposedEditId,
  type FixProposal,
  type ProposedEdit
} from "../domain/fix";
import type { Finding } from "../domain/finding";
import type { ApiObservation } from "../domain/observation";
import type { HttpMethod } from "../domain/types";
import { formatRoutePattern } from "../normalization/route-normalizer";
import type { FixGenerationContext, FixGeneratorPort } from "../ports/fix-generator";

/**
 * Deterministic generator producing reviewable Level 1 repair proposals for rule UND120.
 */
export class MethodMismatchFixGenerator implements FixGeneratorPort {
  readonly id = "und120-method-conflict-generator";
  readonly supportedRuleIds = ["UND120"] as const;

  generateProposals(finding: Finding, context: FixGenerationContext): FixProposal[] {
    // 1. Rule applicability check
    if (finding.ruleId !== "UND120") {
      return [];
    }

    // 2. Finding state check: only active findings are eligible for repair
    if (finding.state !== "active") {
      return [];
    }

    // 3. Observations lookup
    if (!finding.observationIds || finding.observationIds.length < 2) {
      return [];
    }

    let consumer: ApiObservation | undefined;
    let provider: ApiObservation | undefined;

    for (const obsId of finding.observationIds) {
      const obs = context.observations.get(obsId);
      if (!obs) continue;
      if (obs.role === "consumer") consumer = obs;
      else if (obs.role === "provider") provider = obs;
    }

    if (!consumer || !provider) {
      return [];
    }

    // 4. Evidence certainty: both method values must be known with direct evidence
    if (consumer.endpoint.method.state !== "known" || provider.endpoint.method.state !== "known") {
      return [];
    }

    if (
      consumer.endpoint.method.strength !== "direct" ||
      provider.endpoint.method.strength !== "direct"
    ) {
      return [];
    }

    const cMethod = consumer.endpoint.method.value;
    const pMethod = provider.endpoint.method.value;

    // Both methods must be different
    if (!cMethod || !pMethod || cMethod === pMethod) {
      return [];
    }

    // 5. Relationship check: if relationships are supplied, relationship must be method-conflict
    if (context.relationships && finding.relationshipId) {
      const rel = context.relationships.get(finding.relationshipId);
      if (rel && rel.matchKind !== "method-conflict") {
        return [];
      }
    }

    // 6. Path check: both paths must be known
    if (consumer.endpoint.path.state !== "known" || provider.endpoint.path.state !== "known") {
      return [];
    }

    // 7. Completeness checks: decline if completeness-affecting limitations are present
    const hasCompletenessLimitation = (obs: ApiObservation): boolean =>
      obs.limitations.some((lim) => lim.affectsCompleteness);
    if (hasCompletenessLimitation(consumer) || hasCompletenessLimitation(provider)) {
      return [];
    }

    const proposals: FixProposal[] = [];
    const formattedRoute = formatRoutePattern(consumer.endpoint.path.value);

    // 7. Candidate A: Consumer-side repair (update consumer request method to pMethod)
    if (!context.targetRole || context.targetRole === "consumer") {
      const consumerProposal = this.generateConsumerProposal(
        finding,
        consumer,
        cMethod,
        pMethod,
        formattedRoute,
        context
      );
      if (consumerProposal) {
        proposals.push(consumerProposal);
      }
    }

    // 8. Candidate B: Provider-side repair (update provider route method to cMethod)
    if (!context.targetRole || context.targetRole === "provider") {
      const providerProposal = this.generateProviderProposal(
        finding,
        provider,
        cMethod,
        pMethod,
        formattedRoute,
        context
      );
      if (providerProposal) {
        proposals.push(providerProposal);
      }
    }

    return proposals;
  }

  private generateConsumerProposal(
    finding: Finding,
    consumer: ApiObservation,
    cMethod: HttpMethod,
    pMethod: HttpMethod,
    formattedRoute: string,
    context: FixGenerationContext
  ): FixProposal | undefined {
    const methodEvidence = consumer.endpoint.method.evidence[0];
    // Explicit literal syntax required; implicit default fetch methods cannot be cleanly edited
    if (!methodEvidence || methodEvidence.kind !== "literal-syntax") {
      return undefined;
    }

    const span = methodEvidence.source;
    if (!span || !span.uri || span.range.start >= span.range.end) {
      return undefined;
    }

    if (!consumer.snapshot.contentHash) {
      return undefined;
    }

    let newText: string;

    // Preserve quote and casing conventions if source text is available
    if (context.sourceDocuments) {
      const doc = context.sourceDocuments.get(consumer.snapshot.uri);
      if (!doc) {
        return undefined;
      }

      if (span.range.end > doc.text.length) {
        return undefined;
      }

      const currentText = doc.text.slice(span.range.start, span.range.end);
      const stripped = currentText.replace(/['"`]/g, "").toUpperCase();
      if (stripped !== cMethod) {
        return undefined;
      }

      if (currentText.startsWith("'") && currentText.endsWith("'")) {
        newText = `'${pMethod}'`;
      } else if (currentText.startsWith('"') && currentText.endsWith('"')) {
        newText = `"${pMethod}"`;
      } else if (currentText.startsWith("`") && currentText.endsWith("`")) {
        newText = `\`${pMethod}\``;
      } else if (currentText === currentText.toLowerCase()) {
        newText = pMethod.toLowerCase();
      } else {
        newText = pMethod;
      }
    } else {
      if (consumer.framework === "axios") {
        newText = pMethod.toLowerCase();
      } else {
        newText = `"${pMethod}"`;
      }
    }

    const proposalId = createFixProposalId({
      findingId: finding.id,
      targetRole: "consumer",
      targetUri: consumer.snapshot.uri,
      rangeStart: span.range.start,
      rangeEnd: span.range.end,
      newText
    });

    const edit: ProposedEdit = {
      id: createProposedEditId(proposalId, 0),
      proposalId,
      documentUri: consumer.snapshot.uri,
      range: { start: span.range.start, end: span.range.end },
      start: { line: span.start.line, character: span.start.character },
      end: { line: span.end.line, character: span.end.character },
      newText,
      expectedContentHash: consumer.snapshot.contentHash,
      expectedDocumentVersion: consumer.snapshot.documentVersion
    };

    return {
      id: proposalId,
      findingId: finding.id,
      generation: context.generation,
      title: `Change frontend request method to ${pMethod}`,
      rationale: `The backend endpoint at '${formattedRoute}' expects HTTP method ${pMethod}, but the frontend call specifies ${cMethod}.`,
      assumptions: [
        `Assumes the backend provider's HTTP method (${pMethod}) is the authoritative contract.`,
        `Assumes updating the frontend request method to ${pMethod} will not break client-side caller expectations.`
      ],
      risk: "mechanical",
      targetRole: "consumer",
      edits: [edit],
      status: "proposed",
      verificationDescription: `Re-analysis of the workspace will verify that the frontend request matches the backend endpoint's method (${pMethod}), resolving rule UND120.`
    };
  }

  private generateProviderProposal(
    finding: Finding,
    provider: ApiObservation,
    cMethod: HttpMethod,
    pMethod: HttpMethod,
    formattedRoute: string,
    context: FixGenerationContext
  ): FixProposal | undefined {
    const methodEvidence = provider.endpoint.method.evidence[0];
    if (!methodEvidence || methodEvidence.kind !== "literal-syntax") {
      return undefined;
    }

    const span = methodEvidence.source;
    if (!span || !span.uri || span.range.start >= span.range.end) {
      return undefined;
    }

    if (!provider.snapshot.contentHash) {
      return undefined;
    }

    let newText: string;

    if (context.sourceDocuments) {
      const doc = context.sourceDocuments.get(provider.snapshot.uri);
      if (!doc) {
        return undefined;
      }

      if (span.range.end > doc.text.length) {
        return undefined;
      }

      const currentText = doc.text.slice(span.range.start, span.range.end);
      const stripped = currentText.replace(/['"`]/g, "").toUpperCase();
      if (stripped !== pMethod) {
        return undefined;
      }

      // Express route declarations use lowercase method identifier tokens
      newText = cMethod.toLowerCase();
    } else {
      newText = cMethod.toLowerCase();
    }

    const proposalId = createFixProposalId({
      findingId: finding.id,
      targetRole: "provider",
      targetUri: provider.snapshot.uri,
      rangeStart: span.range.start,
      rangeEnd: span.range.end,
      newText
    });

    const edit: ProposedEdit = {
      id: createProposedEditId(proposalId, 0),
      proposalId,
      documentUri: provider.snapshot.uri,
      range: { start: span.range.start, end: span.range.end },
      start: { line: span.start.line, character: span.start.character },
      end: { line: span.end.line, character: span.end.character },
      newText,
      expectedContentHash: provider.snapshot.contentHash,
      expectedDocumentVersion: provider.snapshot.documentVersion
    };

    return {
      id: proposalId,
      findingId: finding.id,
      generation: context.generation,
      title: `Change backend endpoint method to ${cMethod}`,
      rationale: `The frontend consumer at '${formattedRoute}' sends HTTP method ${cMethod}, but the backend route handler expects ${pMethod}.`,
      assumptions: [
        `Assumes the frontend consumer's HTTP method (${cMethod}) is the authoritative contract.`,
        `Assumes the backend route handler implementation supports HTTP method ${cMethod}.`
      ],
      risk: "mechanical",
      targetRole: "provider",
      edits: [edit],
      status: "proposed",
      verificationDescription: `Re-analysis of the workspace will verify that the backend endpoint matches the frontend consumer's method (${cMethod}), resolving rule UND120.`
    };
  }
}
