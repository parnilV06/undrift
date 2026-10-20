// Candidate contract matcher as specified in LLD.md Section 10.1–10.5, TRD Section 9.3, and ERD Section 3.7.
// Implements deterministic, conservative consumer/provider candidate matching
// based on normalized HTTP methods and route patterns.

import type { EvidenceRef } from "../domain/evidence";
import type { AnalysisWarning } from "../domain/finding";
import type { ApiObservation, RoutePattern } from "../domain/observation";
import { type ContractRelationship, createRelationshipId } from "../domain/relationship";
import type { HttpMethod } from "../domain/types";
import { isSupportedHttpMethod } from "../normalization/method-normalizer";
import { isRoutePattern } from "../normalization/route-normalizer";

/**
 * Evaluates structural route-shape equality between two normalized RoutePattern instances
 * according to LLD.md Section 10.3:
 *
 * "Two paths have the same route shape if all static segments match and corresponding
 * parameter/wildcard positions are structurally compatible under the supported route model.
 * Parameter variable names alone should not create a route mismatch because names in the
 * client and server source do not necessarily need to be identical."
 *
 * Paths containing unresolved segments cannot be confidently equated.
 */
export function areRouteShapesEqual(
  routeA: RoutePattern | undefined,
  routeB: RoutePattern | undefined
): boolean {
  if (!routeA || !routeB || !Array.isArray(routeA.segments) || !Array.isArray(routeB.segments)) {
    return false;
  }

  if (routeA.segments.length !== routeB.segments.length) {
    return false;
  }

  // Paths containing any unresolved segment cannot be established as structurally matching
  for (let i = 0; i < routeA.segments.length; i++) {
    const segA = routeA.segments[i];
    const segB = routeB.segments[i];

    if (segA.kind === "unresolved" || segB.kind === "unresolved") {
      return false;
    }

    if (segA.kind === "static") {
      if (segB.kind !== "static" || segA.value !== segB.value) {
        return false;
      }
    } else if (segA.kind === "parameter") {
      if (segB.kind !== "parameter") {
        return false;
      }
      // Note: Parameter variable names (segA.name vs segB.name) do not need to match per LLD 10.3
    } else if (segA.kind === "wildcard") {
      if (segB.kind !== "wildcard") {
        return false;
      }
    }
  }

  return true;
}

/**
 * Outcome of evaluating trailing-slash metadata between two route patterns.
 */
export interface TrailingSlashAssessment {
  reasons: string[];
  limitations: AnalysisWarning[];
}

/**
 * Assesses trailing-slash compatibility between a consumer and provider route pattern
 * according to LLD.md Section 9.1 Rule 8:
 * "Keep trailing slash policy explicit; do not silently conflate variants until behavior is decided and tested."
 *
 * Symmetrically distinguishes:
 * - known identical trailing slashes (present vs present, absent vs absent) -> no difference recorded
 * - known different trailing slashes (present vs absent, absent vs present) -> records explicit difference
 * - unresolved trailing slashes (present/absent vs unknown, unknown vs unknown) -> preserves uncertainty
 */
export function assessTrailingSlashCompatibility(
  consumerRoute: RoutePattern,
  providerRoute: RoutePattern
): TrailingSlashAssessment {
  const cSlash = consumerRoute.trailingSlash;
  const pSlash = providerRoute.trailingSlash;

  // 1. Both identical and known
  if (
    (cSlash === "present" && pSlash === "present") ||
    (cSlash === "absent" && pSlash === "absent")
  ) {
    return { reasons: [], limitations: [] };
  }

  // 2. Both known but different
  if (
    (cSlash === "present" && pSlash === "absent") ||
    (cSlash === "absent" && pSlash === "present")
  ) {
    return {
      reasons: [
        `Known trailing-slash difference: consumer path trailing slash is '${cSlash}', but provider path trailing slash is '${pSlash}'`
      ],
      limitations: []
    };
  }

  // 3. Both unknown
  if (cSlash === "unknown" && pSlash === "unknown") {
    return {
      reasons: [
        "Trailing-slash compatibility is unresolved: both consumer and provider have unknown trailing-slash metadata"
      ],
      limitations: [
        {
          code: "UNSUPPORTED_PATTERN",
          message:
            "Trailing-slash compatibility is unresolved: both consumer and provider have unknown trailing-slash metadata",
          affectsCompleteness: false
        }
      ]
    };
  }

  // 4. One known, one unknown
  return {
    reasons: [
      `Trailing-slash compatibility is unresolved: consumer path trailing slash is '${cSlash}', provider path trailing slash is '${pSlash}'`
    ],
    limitations: [
      {
        code: "UNSUPPORTED_PATTERN",
        message: `Trailing-slash compatibility is unresolved: consumer has '${cSlash}', provider has '${pSlash}'`,
        affectsCompleteness: false
      }
    ]
  };
}

/**
 * Extracts a known, supported HTTP method from an API observation.
 * Returns undefined if the method observation is missing, dynamic, unknown, or unsupported.
 */
export function getKnownMethod(obs: ApiObservation): HttpMethod | undefined {
  const methodObs = obs.endpoint?.method;
  if (methodObs && methodObs.state === "known") {
    const val = methodObs.value;
    return typeof val === "string" && isSupportedHttpMethod(val) ? val : undefined;
  }
  return undefined;
}

/**
 * Extracts a valid RoutePattern from an API observation.
 * Returns undefined if the path observation is missing, dynamic, unknown, or malformed.
 */
export function getKnownRoute(obs: ApiObservation): RoutePattern | undefined {
  const pathObs = obs.endpoint?.path;
  if (pathObs && pathObs.state === "known") {
    const val = pathObs.value;
    return val && isRoutePattern(val) ? val : undefined;
  }
  return undefined;
}

/**
 * Collects evidence references from an API observation's endpoint method and path observations.
 */
function extractObservationEvidence(obs?: ApiObservation): EvidenceRef[] {
  if (!obs) {
    return [];
  }

  const evidence: EvidenceRef[] = [];

  if (obs.endpoint?.method?.evidence) {
    evidence.push(...obs.endpoint.method.evidence);
  }

  if (obs.endpoint?.path?.evidence) {
    evidence.push(...obs.endpoint.path.evidence);
  }

  return evidence;
}

/**
 * Verifies conditions 1 to 5 of the suspected route mismatch policy defined in LLD.md Section 10.4:
 *
 * 1. Consumer and provider have the same known HTTP method.
 * 2. Both paths are known and contain no unresolved/wildcard segments.
 * 3. Segment counts are equal.
 * 4. Parameter positions are compatible.
 * 5. Exactly one static segment differs.
 */
function checkSuspectedRouteMismatchConditions(
  consumer: ApiObservation,
  provider: ApiObservation
): boolean {
  const cMethod = getKnownMethod(consumer);
  const pMethod = getKnownMethod(provider);

  // Condition 1: Same known HTTP method
  if (!cMethod || !pMethod || cMethod !== pMethod) {
    return false;
  }

  const cRoute = getKnownRoute(consumer);
  const pRoute = getKnownRoute(provider);

  // Condition 2: Both paths known
  if (!cRoute || !pRoute) {
    return false;
  }

  // Condition 2 & 3: Equal segment count and no unresolved/wildcard segments
  if (cRoute.segments.length !== pRoute.segments.length) {
    return false;
  }

  for (const seg of cRoute.segments) {
    if (seg.kind !== "static" && seg.kind !== "parameter") {
      return false;
    }
  }
  for (const seg of pRoute.segments) {
    if (seg.kind !== "static" && seg.kind !== "parameter") {
      return false;
    }
  }

  // Condition 4 & 5: Compatible parameters and exactly one static segment difference
  let differingStaticCount = 0;

  for (let i = 0; i < cRoute.segments.length; i++) {
    const cSeg = cRoute.segments[i];
    const pSeg = pRoute.segments[i];

    if (cSeg.kind === "parameter") {
      if (pSeg.kind !== "parameter") {
        return false;
      }
    } else if (cSeg.kind === "static") {
      if (pSeg.kind !== "static") {
        return false;
      }
      if (cSeg.value !== pSeg.value) {
        differingStaticCount++;
      }
    }
  }

  return differingStaticCount === 1;
}

/**
 * Core contract matcher implementation as specified in LLD.md Section 10.
 * Operates on normalized consumer and provider API observations and classifies
 * candidate relationships into exact, method conflict, suspected route conflict,
 * ambiguous, and unmatched categories following explicit precedence rules.
 */
export class ContractMatcher {
  /**
   * Matches consumer and provider API observations into candidate ContractRelationships.
   * Execution is fully deterministic and independent of input array ordering.
   *
   * @param observations Input consumer and provider API observations.
   * @returns Deterministically ordered list of ContractRelationships.
   */
  public match(observations: readonly ApiObservation[]): ContractRelationship[] {
    // 1. Sort observations stably by ID to guarantee complete order independence
    const sorted = [...observations].sort((a, b) => a.id.localeCompare(b.id));

    const consumers = sorted.filter((o) => o.role === "consumer");
    const providers = sorted.filter((o) => o.role === "provider");

    const relationships: ContractRelationship[] = [];
    const matchedConsumerIds = new Set<string>();
    const matchedProviderIds = new Set<string>();

    // ------------------------------------------------------------------------
    // STAGE 1: Exact method + route shape (LLD 10.2 Stage 1)
    // ------------------------------------------------------------------------
    for (const c of consumers) {
      const cMethod = getKnownMethod(c);
      const cRoute = getKnownRoute(c);

      if (!cMethod || !cRoute) {
        continue;
      }

      // Find all providers with exact matching route shape and identical known method
      const exactProviders: ApiObservation[] = [];
      for (const p of providers) {
        const pMethod = getKnownMethod(p);
        const pRoute = getKnownRoute(p);

        if (pMethod && pRoute && cMethod === pMethod && areRouteShapesEqual(cRoute, pRoute)) {
          exactProviders.push(p);
        }
      }

      if (exactProviders.length === 1) {
        const p = exactProviders[0];
        const pRoute = getKnownRoute(p)!;
        const slashAssessment = assessTrailingSlashCompatibility(cRoute, pRoute);

        relationships.push({
          id: createRelationshipId("exact", c.id, p.id),
          consumerId: c.id,
          providerId: p.id,
          state: "matched",
          matchKind: "exact",
          evidence: [...extractObservationEvidence(c), ...extractObservationEvidence(p)],
          reasons: [
            "Exact match on normalized HTTP method and route pattern shape",
            ...slashAssessment.reasons
          ],
          limitations: [
            ...(c.limitations ?? []),
            ...(p.limitations ?? []),
            ...slashAssessment.limitations
          ],
          findingIds: []
        });

        matchedConsumerIds.add(c.id);
        matchedProviderIds.add(p.id);
      } else if (exactProviders.length > 1) {
        // Multiple competing exact providers -> Ambiguous candidates (LLD 10.2 Stage 5)
        for (const p of exactProviders) {
          const pRoute = getKnownRoute(p)!;
          const slashAssessment = assessTrailingSlashCompatibility(cRoute, pRoute);

          relationships.push({
            id: createRelationshipId("ambiguous", c.id, p.id),
            consumerId: c.id,
            providerId: p.id,
            state: "unresolved",
            matchKind: "ambiguous",
            evidence: [...extractObservationEvidence(c), ...extractObservationEvidence(p)],
            reasons: [
              `Ambiguous candidate: multiple exact route and method matches found for consumer '${c.id}'`,
              ...slashAssessment.reasons
            ],
            limitations: [
              ...(c.limitations ?? []),
              ...(p.limitations ?? []),
              ...slashAssessment.limitations
            ],
            findingIds: []
          });
          matchedProviderIds.add(p.id);
        }
        matchedConsumerIds.add(c.id);
      }
    }

    // ------------------------------------------------------------------------
    // STAGE 2: Method conflict (LLD 10.2 Stage 2)
    // ------------------------------------------------------------------------
    for (const c of consumers) {
      if (matchedConsumerIds.has(c.id)) {
        continue;
      }

      const cMethod = getKnownMethod(c);
      const cRoute = getKnownRoute(c);

      if (!cMethod || !cRoute) {
        continue;
      }

      // Find all providers with exact matching route shape but different known methods
      const methodConflictProviders: ApiObservation[] = [];
      for (const p of providers) {
        const pMethod = getKnownMethod(p);
        const pRoute = getKnownRoute(p);

        if (pMethod && pRoute && cMethod !== pMethod && areRouteShapesEqual(cRoute, pRoute)) {
          methodConflictProviders.push(p);
        }
      }

      if (methodConflictProviders.length === 1) {
        const p = methodConflictProviders[0];
        const pRoute = getKnownRoute(p)!;
        const slashAssessment = assessTrailingSlashCompatibility(cRoute, pRoute);

        relationships.push({
          id: createRelationshipId("method-conflict", c.id, p.id),
          consumerId: c.id,
          providerId: p.id,
          state: "matched",
          matchKind: "method-conflict",
          evidence: [...extractObservationEvidence(c), ...extractObservationEvidence(p)],
          reasons: [
            `Method conflict on route shape: consumer calls ${cMethod}, provider accepts ${getKnownMethod(p)}`,
            ...slashAssessment.reasons
          ],
          limitations: [
            ...(c.limitations ?? []),
            ...(p.limitations ?? []),
            ...slashAssessment.limitations
          ],
          findingIds: []
        });

        matchedConsumerIds.add(c.id);
        matchedProviderIds.add(p.id);
      } else if (methodConflictProviders.length > 1) {
        // Multiple providers with the same route shape but conflicting methods -> Ambiguous
        for (const p of methodConflictProviders) {
          const pRoute = getKnownRoute(p)!;
          const slashAssessment = assessTrailingSlashCompatibility(cRoute, pRoute);

          relationships.push({
            id: createRelationshipId("ambiguous", c.id, p.id),
            consumerId: c.id,
            providerId: p.id,
            state: "unresolved",
            matchKind: "ambiguous",
            evidence: [...extractObservationEvidence(c), ...extractObservationEvidence(p)],
            reasons: [
              `Ambiguous candidate: multiple providers with same route shape offer conflicting HTTP methods for consumer '${c.id}'`,
              ...slashAssessment.reasons
            ],
            limitations: [
              ...(c.limitations ?? []),
              ...(p.limitations ?? []),
              ...slashAssessment.limitations
            ],
            findingIds: []
          });
          matchedProviderIds.add(p.id);
        }
        matchedConsumerIds.add(c.id);
      }
    }

    // ------------------------------------------------------------------------
    // STAGE 3: Suspected route mismatch (LLD 10.2 Stage 3 & 10.4)
    // ------------------------------------------------------------------------
    const eligibleConsumers = consumers.filter((c) => !matchedConsumerIds.has(c.id));
    const eligibleProviders = providers.filter((p) => !matchedProviderIds.has(p.id));

    // Map candidate connections satisfying Conditions 1-5
    const consumerCandidates = new Map<string, ApiObservation[]>();
    const providerCandidates = new Map<string, ApiObservation[]>();

    for (const c of eligibleConsumers) {
      consumerCandidates.set(c.id, []);
    }
    for (const p of eligibleProviders) {
      providerCandidates.set(p.id, []);
    }

    for (const c of eligibleConsumers) {
      for (const p of eligibleProviders) {
        if (checkSuspectedRouteMismatchConditions(c, p)) {
          consumerCandidates.get(c.id)!.push(p);
          providerCandidates.get(p.id)!.push(c);
        }
      }
    }

    // Condition 6: Mutual uniqueness (provider unique for consumer AND consumer unique for provider)
    for (const c of eligibleConsumers) {
      const candidatesForC = consumerCandidates.get(c.id) ?? [];
      if (candidatesForC.length === 1) {
        const p = candidatesForC[0];
        const candidatesForP = providerCandidates.get(p.id) ?? [];

        if (candidatesForP.length === 1 && candidatesForP[0].id === c.id) {
          const cRoute = getKnownRoute(c)!;
          const pRoute = getKnownRoute(p)!;
          const slashAssessment = assessTrailingSlashCompatibility(cRoute, pRoute);

          relationships.push({
            id: createRelationshipId("suspected-route-conflict", c.id, p.id),
            consumerId: c.id,
            providerId: p.id,
            state: "matched",
            matchKind: "suspected-route-conflict",
            evidence: [...extractObservationEvidence(c), ...extractObservationEvidence(p)],
            reasons: [
              "Suspected route mismatch: exactly one static segment differs with identical method and compatible parameters",
              ...slashAssessment.reasons
            ],
            limitations: [
              ...(c.limitations ?? []),
              ...(p.limitations ?? []),
              ...slashAssessment.limitations
            ],
            findingIds: []
          });

          matchedConsumerIds.add(c.id);
          matchedProviderIds.add(p.id);
        }
      }
    }

    // ------------------------------------------------------------------------
    // STAGE 4: Unmatched observations (LLD 10.2 Stage 4, 10.6, 10.7)
    // ------------------------------------------------------------------------
    // Unmatched consumers
    for (const c of consumers) {
      if (!matchedConsumerIds.has(c.id)) {
        relationships.push({
          id: createRelationshipId("unmatched", c.id, undefined),
          consumerId: c.id,
          providerId: undefined,
          state: "discovered",
          matchKind: "unmatched",
          evidence: extractObservationEvidence(c),
          reasons: ["No compatible provider found in analyzed scope"],
          limitations: c.limitations ?? [],
          findingIds: []
        });
      }
    }

    // Unmatched / orphaned providers
    for (const p of providers) {
      if (!matchedProviderIds.has(p.id)) {
        relationships.push({
          id: createRelationshipId("unmatched", undefined, p.id),
          consumerId: undefined,
          providerId: p.id,
          state: "orphaned",
          matchKind: "unmatched",
          evidence: extractObservationEvidence(p),
          reasons: ["Provider has no known consumer in analyzed scope"],
          limitations: p.limitations ?? [],
          findingIds: []
        });
      }
    }

    // Sort relationships deterministically by ID
    relationships.sort((a, b) => a.id.localeCompare(b.id));

    return relationships;
  }
}

/**
 * Standalone convenience matching function invoking the ContractMatcher.
 */
export function matchCandidates(observations: readonly ApiObservation[]): ContractRelationship[] {
  const matcher = new ContractMatcher();
  return matcher.match(observations);
}
