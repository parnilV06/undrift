// Structured finding explainer as specified in LLD.md Section 12.
// Generates deterministic, developer-oriented finding explanations without external dependencies or LLMs.

import type { EvidenceStrength, SourceSpan } from "../domain/evidence";
import type { AnalysisWarning, FindingExplanation, WarningCode } from "../domain/finding";
import type { RuleId } from "../domain/types";

/**
 * Structured inputs to the finding explanation generator.
 */
export interface ExplainFindingInput {
  ruleId: RuleId;
  title?: string;
  summary?: string;
  method?: string;
  route?: string;
  targetKey?: string;
  expectedDescription?: string;
  observedDescription?: string;
  reason?: string;
  possibleImpact?: string;
  evidenceStrength?: EvidenceStrength;
  sourceLocations?: SourceSpan[];
  limitations?: AnalysisWarning[];
  suggestedNextSteps?: string[];
  warningCode?: WarningCode;
  warningMessage?: string;
}

/**
 * Constructs a structured, factual FindingExplanation following LLD.md Section 12.2 and 12.3.
 */
export function explainFinding(input: ExplainFindingInput): FindingExplanation {
  const sourceLocations = input.sourceLocations ?? [];
  const limitations = input.limitations ?? [];

  switch (input.ruleId) {
    case "UND100": {
      const headline = "No compatible provider found in the analyzed scope";
      const summary =
        input.summary ??
        (input.method && input.route
          ? `No compatible provider found in the analyzed scope for ${input.method} '${input.route}'.`
          : "No compatible provider found in the analyzed scope.");
      const reason =
        input.reason ??
        "No provider endpoint matches the route pattern and HTTP method within the scanned workspace.";
      const possibleImpact =
        input.possibleImpact ??
        "Client requests to this endpoint will fail at runtime with a 404 Not Found error.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        "Verify that the backend provider implements this endpoint.",
        "Ensure the backend route is exported and included within the analyzed workspace.",
        "Check for typos in the consumer's request URL or HTTP method."
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND110": {
      const headline = "No known consumer found in the analyzed scope";
      const summary =
        input.summary ??
        (input.method && input.route
          ? `No known consumer found in the analyzed scope for ${input.method} '${input.route}'.`
          : "No known consumer found in the analyzed scope.");
      const reason =
        input.reason ??
        "No consumer call matches this endpoint within the analyzed workspace scope. External consumers, dynamic callers, generated clients, or other repositories may exist.";
      const possibleImpact =
        input.possibleImpact ??
        "If this endpoint is obsolete, it may be dead code; if it is intended for external clients, this notice can be safely ignored or suppressed.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        "Confirm whether this endpoint is used by external consumers, mobile apps, or third parties.",
        "If the endpoint is unused, consider deprecating or removing it."
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND120": {
      const headline = "HTTP method conflict on endpoint";
      const summary =
        input.summary ??
        (input.expectedDescription && input.observedDescription && input.route
          ? `Consumer calls ${input.expectedDescription} on '${input.route}', but provider accepts ${input.observedDescription}.`
          : "HTTP method conflict between consumer call and provider endpoint.");
      const reason =
        input.reason ?? "The endpoint route shape matches, but the HTTP methods conflict.";
      const possibleImpact =
        input.possibleImpact ??
        "Requests from this consumer will fail at runtime with a 404 or 405 Method Not Allowed error.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        "Update the consumer call to use the HTTP method accepted by the provider.",
        "Or add a route handler for the requested HTTP method on the provider."
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND130": {
      const headline = "Suspected route mismatch";
      const summary =
        input.summary ??
        (input.expectedDescription && input.observedDescription
          ? `Consumer calls '${input.expectedDescription}' with ${input.method ?? "HTTP method"}, but the closest unique provider route is '${input.observedDescription}'.`
          : "Suspected route mismatch between consumer call and provider endpoint.");
      const reason =
        input.reason ??
        "Exactly one static path segment differs between the unique consumer and provider candidates with matching HTTP method.";
      const possibleImpact =
        input.possibleImpact ??
        "Requests from this consumer may receive a 404 Not Found error at runtime.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        "Verify whether the consumer route has a typo or should be updated to match the provider.",
        "Or add the missing route to the backend provider."
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "inferred",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND200": {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "a required field";
      const headline = "Required request field not supplied";
      const summary =
        input.summary ??
        (input.route
          ? `Consumer request to '${input.route}' does not supply required field ${fieldDesc}.`
          : `Consumer request does not supply required field ${fieldDesc}.`);
      const reason =
        input.reason ??
        `The provider endpoint requires field ${fieldDesc}, but the consumer request payload omits it.`;
      const possibleImpact =
        input.possibleImpact ??
        "The backend provider may reject the request with a 400 Bad Request or schema validation error.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        `Include the required field ${fieldDesc} in the consumer request payload.`,
        `Or make ${fieldDesc} optional in the backend provider schema if it is not strictly required.`
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND210": {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "request field";
      const headline = "Request field type mismatch";
      const summary =
        input.summary ??
        (input.expectedDescription && input.observedDescription
          ? `Consumer sends type ${input.observedDescription} for ${fieldDesc}, but provider expects ${input.expectedDescription}.`
          : `Type mismatch on ${fieldDesc} between consumer payload and provider expectation.`);
      const reason =
        input.reason ??
        `The type of request field ${fieldDesc} is incompatible with the provider's accepted contract.`;
      const possibleImpact =
        input.possibleImpact ??
        "The backend provider may fail to deserialize the field or reject the request with a validation error.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        `Update the consumer payload to send a value of type ${input.expectedDescription ?? "expected type"}.`,
        `Or update the backend provider to accept ${input.observedDescription ?? "consumer type"}.`
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND220": {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "request field";
      const headline = "Request nullability or optionality conflict";
      const summary =
        input.summary ??
        (input.expectedDescription && input.observedDescription
          ? `Request field ${fieldDesc} conflict: consumer is ${input.observedDescription}, but provider requires ${input.expectedDescription}.`
          : `Request optionality or nullability conflict on ${fieldDesc}.`);
      const reason =
        input.reason ??
        `The consumer contract allows omitting or passing null for ${fieldDesc}, which the provider contract disallows.`;
      const possibleImpact =
        input.possibleImpact ??
        "Sending an omitted or null value at runtime may trigger a server validation or unhandled null exception.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        `Ensure the consumer always provides a valid non-null value for ${fieldDesc}.`,
        `Or relax the provider schema to accept optional or nullable values.`
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND300": {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "expected field";
      const headline = "Expected response field missing";
      const summary =
        input.summary ??
        (input.route
          ? `Consumer expects response field ${fieldDesc} from '${input.route}', but provider response omits it.`
          : `Provider response does not produce expected field ${fieldDesc}.`);
      const reason =
        input.reason ??
        `The consumer expects field ${fieldDesc} in the response body, but the provider's complete response shape omits it.`;
      const possibleImpact =
        input.possibleImpact ??
        `Consumer code accessing response field ${fieldDesc} may receive undefined or throw a runtime TypeError.`;
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        `Add field ${fieldDesc} to the backend provider response.`,
        `Or update the consumer type expectation to make ${fieldDesc} optional or remove it.`
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND310": {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "response field";
      const headline = "Response field type mismatch";
      const summary =
        input.summary ??
        (input.expectedDescription && input.observedDescription
          ? `Provider produces type ${input.observedDescription} for ${fieldDesc}, but consumer expects ${input.expectedDescription}.`
          : `Type mismatch on response field ${fieldDesc} between provider output and consumer expectation.`);
      const reason =
        input.reason ??
        `The provider's produced type for ${fieldDesc} is incompatible with the consumer's expected contract.`;
      const possibleImpact =
        input.possibleImpact ??
        "Client code may fail to process the response, leading to unexpected behavior or runtime errors.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        `Update the backend provider response to return ${input.expectedDescription ?? "expected type"}.`,
        `Or update the consumer expectation to accept ${input.observedDescription ?? "provider type"}.`
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND320": {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "response field";
      const headline = "Response optionality conflict";
      const summary =
        input.summary ??
        `Provider may omit response field ${fieldDesc}, but consumer expects it to be reliably present.`;
      const reason =
        input.reason ??
        `The provider marks response field ${fieldDesc} as optional, but the consumer contract requires it.`;
      const possibleImpact =
        input.possibleImpact ??
        `When the provider omits ${fieldDesc}, consumer code reading it may encounter undefined values.`;
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        `Update the consumer to handle ${fieldDesc} being optional or absent.`,
        `Or ensure the backend provider always includes ${fieldDesc} in its response.`
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND330": {
      const fieldDesc = input.targetKey ? `'${input.targetKey}'` : "response field";
      const headline = "Response nullability conflict";
      const summary =
        input.summary ??
        `Provider may return null for response field ${fieldDesc}, but consumer disallows null.`;
      const reason =
        input.reason ??
        `The provider marks response field ${fieldDesc} as nullable, but the consumer contract expects a non-null value.`;
      const possibleImpact =
        input.possibleImpact ??
        `Client code reading ${fieldDesc} may throw a TypeError or unhandled null exception when null is returned.`;
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        `Update the consumer to handle null values for ${fieldDesc}.`,
        `Or ensure the backend provider never returns null for this field.`
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND900": {
      const headline = "Unsupported pattern limits analysis";
      const summary =
        input.summary ??
        input.warningMessage ??
        "An unsupported syntax or framework pattern limits contract extraction.";
      const reason =
        input.reason ??
        "The source code contains a pattern or framework construct that UNDRIFT does not yet support.";
      const possibleImpact =
        input.possibleImpact ??
        "Endpoints or contracts affected by this construct may not be detected or verified for drift.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        "Inspect the source location and consider using a supported endpoint declaration style.",
        "Refer to UNDRIFT supported framework conventions."
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription ?? input.warningMessage,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "inferred",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND910": {
      const headline = "Unresolved reference or type limits analysis";
      const summary =
        input.summary ??
        input.warningMessage ??
        "A type declaration, import, or symbol reference could not be statically resolved.";
      const reason =
        input.reason ??
        "UNDRIFT could not trace the symbol reference to a supported local or imported declaration.";
      const possibleImpact =
        input.possibleImpact ??
        "Field shapes or contract types depending on this reference cannot be verified for drift.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        "Verify that the type or symbol is declared within the analyzed workspace scope.",
        "Ensure the referenced module or type definition is accessible."
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription ?? input.warningMessage,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "inferred",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    case "UND920": {
      const headline = "Incomplete parse or analysis scope limits coverage";
      const summary =
        input.summary ??
        input.warningMessage ??
        "A syntax parse error or scope limitation prevented complete analysis of the file.";
      const reason =
        input.reason ?? "The parser encountered a syntax error or the file scope was incomplete.";
      const possibleImpact =
        input.possibleImpact ??
        "Absence of findings in this file cannot be considered proof of contract compatibility.";
      const suggestedNextSteps = input.suggestedNextSteps ?? [
        "Fix any syntax errors in the affected file.",
        "Re-run workspace analysis to restore full coverage."
      ];

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription ?? input.warningMessage,
        reason,
        possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "direct",
        sourceLocations,
        limitations,
        suggestedNextSteps
      };
    }

    default: {
      const headline = input.title ?? `Finding ${input.ruleId}`;
      const summary = input.summary ?? "A contract drift or analysis finding was identified.";
      const reason =
        input.reason ?? "Contract verification rule identified an inconsistency or limitation.";

      return {
        headline,
        summary,
        expectedDescription: input.expectedDescription,
        observedDescription: input.observedDescription,
        reason,
        possibleImpact: input.possibleImpact,
        evidenceStrength: input.evidenceStrength ?? "unknown",
        sourceLocations,
        limitations,
        suggestedNextSteps: input.suggestedNextSteps ?? [
          "Review the affected endpoint or contract declaration."
        ]
      };
    }
  }
}

/**
 * Formats a FindingExplanation into clear, structured markdown prose for presentation.
 */
export function formatExplanationText(explanation: FindingExplanation): string {
  const parts: string[] = [];
  parts.push(`**${explanation.headline}**: ${explanation.summary}`);

  if (explanation.expectedDescription || explanation.observedDescription) {
    if (explanation.expectedDescription) {
      parts.push(`- Expected: ${explanation.expectedDescription}`);
    }
    if (explanation.observedDescription) {
      parts.push(`- Observed: ${explanation.observedDescription}`);
    }
  }

  parts.push(`Reason: ${explanation.reason}`);

  if (explanation.possibleImpact) {
    parts.push(`Impact: ${explanation.possibleImpact}`);
  }

  if (explanation.suggestedNextSteps && explanation.suggestedNextSteps.length > 0) {
    parts.push(
      `Suggested next steps:\n${explanation.suggestedNextSteps.map((s) => `  * ${s}`).join("\n")}`
    );
  }

  return parts.join("\n\n");
}
