// Shape extractor extracting structural property shapes from object literals
// as specified in LLD.md Section 7.4.

import type { DocumentUri, EvidenceRef, FieldShape, SyntaxNode, TypeShape } from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";

/**
 * Extracts properties from an object literal syntax node into a FieldShape array.
 */
export function extractObjectFields(
  objectNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper
): FieldShape[] {
  const fields: FieldShape[] = [];

  for (const child of objectNode.namedChildren()) {
    if (child.kind === "shorthand_property_identifier") {
      const fieldName = child.text();
      const fieldSpan = mapper.toSourceSpanFromUtf16(
        child.range.start,
        child.range.end,
        documentUri
      );
      const fieldEvidence: EvidenceRef = {
        id: `ev-field-${child.range.start}`,
        kind: "literal-syntax",
        strength: "direct",
        source: fieldSpan,
        description: `Field '${fieldName}' in request/response body payload`
      };
      fields.push({
        name: fieldName,
        type: { kind: "unknown", reason: "unresolved-reference" },
        presence: "required",
        nullable: "unknown",
        evidence: [fieldEvidence]
      });
      continue;
    }

    if (child.kind !== "pair") {
      continue;
    }

    const keyNode = child.childForField("key") ?? child.namedChildren()[0];
    const valNode = child.childForField("value") ?? child.namedChildren()[1];

    if (!keyNode || !valNode) {
      continue;
    }

    let fieldName = keyNode.text();
    if (keyNode.kind === "string") {
      fieldName = fieldName.slice(1, -1);
    }

    const fieldSpan = mapper.toSourceSpanFromUtf16(child.range.start, child.range.end, documentUri);

    const fieldEvidence: EvidenceRef = {
      id: `ev-field-${child.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: fieldSpan,
      description: `Field '${fieldName}' in request/response body payload`
    };

    let fieldType: TypeShape;
    let nullable: "yes" | "no" | "unknown" = "no";

    if (valNode.kind === "string") {
      fieldType = { kind: "literal", value: valNode.text().slice(1, -1) };
    } else if (valNode.kind === "number") {
      fieldType = { kind: "literal", value: Number(valNode.text()) };
    } else if (valNode.kind === "true") {
      fieldType = { kind: "literal", value: true };
    } else if (valNode.kind === "false") {
      fieldType = { kind: "literal", value: false };
    } else if (valNode.kind === "null") {
      fieldType = { kind: "literal", value: null };
      nullable = "yes";
    } else if (valNode.kind === "array") {
      fieldType = { kind: "array", element: { kind: "unknown", reason: "not-observed" } };
    } else if (valNode.kind === "object") {
      fieldType = {
        kind: "object",
        properties: extractObjectFields(valNode, documentUri, mapper),
        additionalProperties: "unknown"
      };
    } else {
      fieldType = { kind: "unknown", reason: "dynamic-expression" };
    }

    fields.push({
      name: fieldName,
      type: fieldType,
      presence: "required",
      nullable,
      evidence: [fieldEvidence]
    });
  }

  return fields;
}
