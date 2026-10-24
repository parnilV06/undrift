// Registry and dispatcher for rule-specific FixGeneratorPort implementations
// as specified in LLD.md Section 13.1.

import type { Finding } from "../domain/finding";
import type { FixProposal } from "../domain/fix";
import type { RuleId } from "../domain/types";
import type { FixGenerationContext, FixGeneratorPort } from "../ports/fix-generator";
import { MethodMismatchFixGenerator } from "./method-mismatch-generator";

/**
 * Registry holding rule-specific fix generators and dispatching proposal generation.
 */
export class FixGeneratorRegistry {
  private readonly generatorsByRule = new Map<RuleId, FixGeneratorPort[]>();
  private readonly allGenerators = new Map<string, FixGeneratorPort>();

  /**
   * Registers a fix generator for its declared supported rule IDs.
   */
  register(generator: FixGeneratorPort): void {
    this.allGenerators.set(generator.id, generator);
    for (const ruleId of generator.supportedRuleIds) {
      const list = this.generatorsByRule.get(ruleId) ?? [];
      if (!list.some((g) => g.id === generator.id)) {
        list.push(generator);
        this.generatorsByRule.set(ruleId, list);
      }
    }
  }

  /**
   * Returns all generators registered for the given rule ID.
   */
  getGenerators(ruleId: RuleId): readonly FixGeneratorPort[] {
    return this.generatorsByRule.get(ruleId) ?? [];
  }

  /**
   * Dispatches proposal generation to all generators registered for the finding's rule ID.
   * Returns an aggregated list of candidate proposals.
   */
  generateProposals(finding: Finding, context: FixGenerationContext): FixProposal[] {
    const generators = this.getGenerators(finding.ruleId);
    if (generators.length === 0) {
      return [];
    }

    const proposals: FixProposal[] = [];
    for (const generator of generators) {
      const generated = generator.generateProposals(finding, context);
      proposals.push(...generated);
    }

    return proposals;
  }
}

/**
 * Creates a default fix generator registry populated with core generators.
 */
export function createDefaultFixGeneratorRegistry(): FixGeneratorRegistry {
  const registry = new FixGeneratorRegistry();
  registry.register(new MethodMismatchFixGenerator());
  return registry;
}
