// Shape extractor extracting structural property shapes from object literals
// as specified in LLD.md Section 7.4.

import type {
  DocumentUri,
  EvidenceRef,
  FieldShape,
  PrimitiveTypeName,
  SyntaxNode,
  TypeShape
} from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";

export interface ShapeFieldResolver {
  resolveObjectLiteral?(
    referenceName: string,
    documentUri: DocumentUri,
    fromRange?: { start: number; end: number }
  ): {
    state: string;
    value?: readonly FieldShape[];
    evidence?: EvidenceRef[];
  };
  resolveConstant?<T = string | number | boolean | null>(
    referenceName: string,
    documentUri: DocumentUri,
    fromRange?: { start: number; end: number }
  ): {
    state: string;
    value?: T;
    evidence?: EvidenceRef[];
  };
}

/**
 * Extracts properties from an object literal syntax node into a FieldShape array.
 */
export function extractObjectFields(
  objectNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  resolver?: ShapeFieldResolver
): FieldShape[] {
  const fields: FieldShape[] = [];

  for (const child of objectNode.namedChildren()) {
    // 1. Spread element e.g. { ...base, extra: 1 }
    if (child.kind === "spread_element") {
      const spreadArg = child.namedChildren()[0];
      if (spreadArg && spreadArg.kind === "identifier" && resolver?.resolveObjectLiteral) {
        const res = resolver.resolveObjectLiteral(spreadArg.text(), documentUri, spreadArg.range);
        if (res.state === "resolved" && res.value) {
          for (const f of res.value) {
            fields.push(f);
          }
        }
      }
      continue;
    }

    // 2. Shorthand property e.g. { name, count }
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

      let fieldType: TypeShape = { kind: "unknown", reason: "unresolved-reference" };
      let nullable: "yes" | "no" | "unknown" = "unknown";

      if (resolver?.resolveConstant) {
        const res = resolver.resolveConstant(fieldName, documentUri, child.range);
        if (res.state === "resolved" && res.value !== undefined) {
          fieldType = { kind: "literal", value: res.value };
          nullable = res.value === null ? "yes" : "no";
        }
      }

      fields.push({
        name: fieldName,
        type: fieldType,
        presence: "required",
        nullable,
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
        properties: extractObjectFields(valNode, documentUri, mapper, resolver),
        additionalProperties: "unknown"
      };
    } else if (valNode.kind === "call_expression") {
      const callee = valNode.childForField("function");
      const calleeText = callee?.text() ?? "";
      if (calleeText === "Number" || calleeText === "parseInt" || calleeText === "parseFloat") {
        fieldType = { kind: "primitive", name: "number" };
      } else if (
        calleeText === "String" ||
        calleeText.endsWith(".trim") ||
        calleeText.endsWith(".toISOString") ||
        calleeText.endsWith(".toString")
      ) {
        fieldType = { kind: "primitive", name: "string" };
      } else if (calleeText === "Boolean") {
        fieldType = { kind: "primitive", name: "boolean" };
      } else {
        fieldType = { kind: "unknown", reason: "dynamic-expression" };
      }
    } else if (valNode.kind === "identifier" && resolver?.resolveConstant) {
      const res = resolver.resolveConstant(valNode.text(), documentUri, valNode.range);
      if (res.state === "resolved" && res.value !== undefined) {
        fieldType = { kind: "literal", value: res.value };
        nullable = res.value === null ? "yes" : "no";
      } else {
        fieldType = { kind: "unknown", reason: "dynamic-expression" };
      }
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

const PRIMITIVE_TYPE_NAMES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "null",
  "undefined",
  "void",
  "unknown",
  "never"
]);

/**
 * Parses a TypeScript type syntax node into a normalized TypeShape.
 */
export function parseTypeNode(
  node: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper
): TypeShape {
  // 1. Predefined primitive type: string, number, boolean, void, etc.
  if (node.kind === "predefined_type") {
    const text = node.text();
    if (PRIMITIVE_TYPE_NAMES.has(text)) {
      return { kind: "primitive", name: text as PrimitiveTypeName };
    }
    return { kind: "unknown", reason: "complex-type" };
  }

  // 2. Type identifier: User, Post, string
  if (node.kind === "type_identifier") {
    const text = node.text();
    if (PRIMITIVE_TYPE_NAMES.has(text)) {
      return { kind: "primitive", name: text as PrimitiveTypeName };
    }
    return {
      kind: "reference",
      displayName: text,
      resolution: "unresolved"
    };
  }

  // 3. Literal type: "admin" | 42 | true
  if (node.kind === "literal_type") {
    const child = node.namedChildren()[0];
    if (child) {
      if (child.kind === "string") {
        return { kind: "literal", value: child.text().slice(1, -1) };
      }
      if (child.kind === "number") {
        return { kind: "literal", value: Number(child.text()) };
      }
      if (child.kind === "true") {
        return { kind: "literal", value: true };
      }
      if (child.kind === "false") {
        return { kind: "literal", value: false };
      }
      if (child.kind === "null") {
        return { kind: "literal", value: null };
      }
    }
    return { kind: "unknown", reason: "complex-type" };
  }

  // 4. Array type: User[], string[]
  if (node.kind === "array_type") {
    const elemNode = node.namedChildren()[0];
    const elementShape = elemNode
      ? parseTypeNode(elemNode, documentUri, mapper)
      : { kind: "unknown" as const, reason: "not-observed" as const };
    return {
      kind: "array",
      element: elementShape
    };
  }

  // 5. Generic type: Array<User>, Promise<User>
  if (node.kind === "generic_type") {
    const typeNameNode = node.childForField("name") ?? node.namedChildren()[0];
    const typeArgs = node.childForField("type_arguments") ?? node.namedChildren()[1];

    if (typeNameNode?.text() === "Array" && typeArgs) {
      const firstArg = typeArgs.namedChildren()[0];
      const elementShape = firstArg
        ? parseTypeNode(firstArg, documentUri, mapper)
        : { kind: "unknown" as const, reason: "not-observed" as const };
      return {
        kind: "array",
        element: elementShape
      };
    }

    return {
      kind: "reference",
      displayName: node.text(),
      resolution: "unresolved"
    };
  }

  // 6. Union type: string | number | null
  if (node.kind === "union_type") {
    const members = node.namedChildren().map((child) => parseTypeNode(child, documentUri, mapper));
    return {
      kind: "union",
      members
    };
  }

  // 7. Object type: { name: string; age?: number }
  if (node.kind === "object_type") {
    return {
      kind: "object",
      properties: extractTypeFields(node, documentUri, mapper),
      additionalProperties: "unknown"
    };
  }

  return {
    kind: "unknown",
    reason: "complex-type"
  };
}

/**
 * Extracts FieldShapes from an object_type or interface_body syntax node.
 */
export function extractTypeFields(
  typeContainerNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper
): FieldShape[] {
  const fields: FieldShape[] = [];

  for (const child of typeContainerNode.namedChildren()) {
    if (child.kind !== "property_signature") {
      continue;
    }

    const nameNode = child.childForField("name") ?? child.namedChildren()[0];
    if (!nameNode) {
      continue;
    }

    let fieldName = nameNode.text();
    if (nameNode.kind === "string") {
      fieldName = fieldName.slice(1, -1);
    }

    // Determine optionality: check if '?' appears before ':' or in child text before type annotation
    const childText = child.text();
    const colonIdx = childText.indexOf(":");
    const preColon = colonIdx >= 0 ? childText.slice(0, colonIdx) : childText;
    const isOptional = preColon.includes("?") || fieldName.endsWith("?");
    if (fieldName.endsWith("?")) {
      fieldName = fieldName.slice(0, -1);
    }

    const typeAnnotationNode =
      child.childForField("type") ??
      child.namedChildren().find((c) => c.kind === "type_annotation");
    const innerTypeNode = typeAnnotationNode?.namedChildren()[0];

    const fieldType = innerTypeNode
      ? parseTypeNode(innerTypeNode, documentUri, mapper)
      : { kind: "unknown" as const, reason: "complex-type" as const };

    let nullable: "yes" | "no" | "unknown" = "no";
    if (fieldType.kind === "literal" && fieldType.value === null) {
      nullable = "yes";
    } else if (
      fieldType.kind === "union" &&
      fieldType.members.some(
        (m) =>
          (m.kind === "primitive" && m.name === "null") ||
          (m.kind === "literal" && m.value === null)
      )
    ) {
      nullable = "yes";
    }

    const fieldSpan = mapper.toSourceSpanFromUtf16(child.range.start, child.range.end, documentUri);
    const fieldEvidence: EvidenceRef = {
      id: `ev-field-${child.range.start}`,
      kind: "literal-syntax",
      strength: "direct",
      source: fieldSpan,
      description: `Type field '${fieldName}' in request/response body specification`
    };

    fields.push({
      name: fieldName,
      type: fieldType,
      presence: isOptional ? "optional" : "required",
      nullable,
      evidence: [fieldEvidence]
    });
  }

  return fields;
}

export interface FormDataAnalysisResult {
  fields: FieldShape[];
  hasConstruction: boolean;
  hasAppends: boolean;
  hasDynamicAppends: boolean;
  dynamicAppendCount: number;
}

function isInsideConditionalOrLoop(node: SyntaxNode, limitNode: SyntaxNode): boolean {
  let curr: SyntaxNode | undefined = node.parent();
  while (curr) {
    if (
      curr.range.start === limitNode.range.start &&
      curr.range.end === limitNode.range.end &&
      curr.kind === limitNode.kind
    ) {
      break;
    }
    const k = curr.kind;
    if (
      k === "if_statement" ||
      k === "ternary_expression" ||
      k === "switch_statement" ||
      k === "switch_case" ||
      k === "switch_default" ||
      k === "while_statement" ||
      k === "do_statement" ||
      k === "for_statement" ||
      k === "for_in_statement" ||
      k === "for_of_statement"
    ) {
      return true;
    }
    if (k === "binary_expression" || k === "logical_expression") {
      const op = curr.childForField("operator")?.text();
      if (op === "&&" || op === "||" || op === "??") {
        return true;
      }
    }
    curr = curr.parent();
  }
  return false;
}

/**
 * Statically analyzes FormData usage within an enclosing AST scope, tracking
 * literal field appends, dynamic operations, and FormData constructor calls.
 */
export function analyzeFormData(
  scopeNode: SyntaxNode,
  varName: string,
  documentUri: DocumentUri,
  mapper: PositionMapper
): FormDataAnalysisResult {
  const fields: FieldShape[] = [];
  const seenNames = new Set<string>();
  const targetNames = new Set<string>();
  if (varName && varName !== "new FormData()") {
    targetNames.add(varName);
  }

  // Identify simple variable aliases within scopeNode: e.g. const uploadData = formData;
  function discoverAliases(node: SyntaxNode) {
    if (node.kind === "variable_declarator") {
      const nameNode = node.childForField("name");
      const valNode = node.childForField("value");
      if (
        nameNode &&
        nameNode.kind === "identifier" &&
        valNode &&
        valNode.kind === "identifier" &&
        targetNames.has(valNode.text())
      ) {
        targetNames.add(nameNode.text());
      }
    } else if (node.kind === "assignment_expression") {
      const leftNode = node.childForField("left");
      const rightNode = node.childForField("right");
      if (
        leftNode &&
        leftNode.kind === "identifier" &&
        rightNode &&
        rightNode.kind === "identifier" &&
        targetNames.has(rightNode.text())
      ) {
        targetNames.add(leftNode.text());
      }
    }

    for (const child of node.namedChildren()) {
      discoverAliases(child);
    }
  }

  if (targetNames.size > 0) {
    discoverAliases(scopeNode);
  }

  let hasConstruction = false;
  let hasAppends = false;
  let hasDynamicAppends = false;
  let dynamicAppendCount = 0;

  function walk(node: SyntaxNode) {
    if (node.kind === "new_expression") {
      const constructorNode = node.childForField("constructor") ?? node.namedChildren()[0];
      if (constructorNode && constructorNode.text() === "FormData") {
        const parent = node.parent();
        if (parent?.kind === "variable_declarator") {
          const varNameNode = parent.childForField("name");
          if (varNameNode && targetNames.has(varNameNode.text())) {
            hasConstruction = true;
          }
        } else if (parent?.kind === "assignment_expression") {
          const leftNode = parent.childForField("left");
          if (leftNode && targetNames.has(leftNode.text())) {
            hasConstruction = true;
          }
        } else if (
          node.range.start === scopeNode.range.start ||
          varName === "new FormData()" ||
          varName === ""
        ) {
          hasConstruction = true;
        }
      }
    }

    if (node.kind === "call_expression") {
      const fnNode = node.childForField("function") ?? node.namedChildren()[0];
      if (fnNode && fnNode.kind === "member_expression") {
        const objNode = fnNode.childForField("object") ?? fnNode.namedChildren()[0];
        const propNode = fnNode.childForField("property") ?? fnNode.namedChildren()[1];

        if (
          objNode &&
          propNode &&
          targetNames.has(objNode.text()) &&
          (propNode.text() === "append" || propNode.text() === "set")
        ) {
          hasAppends = true;
          const args = node.childForField("arguments")?.namedChildren() ?? [];
          if (args.length >= 1) {
            let fieldName: string | undefined;
            if (args[0].kind === "string") {
              fieldName = args[0].text().slice(1, -1);
            }

            if (fieldName) {
              const isConditional = isInsideConditionalOrLoop(node, scopeNode);

              let fieldType: TypeShape = { kind: "unknown", reason: "dynamic-expression" };
              if (args.length >= 2) {
                const valArg = args[1];
                if (valArg.kind === "string") {
                  fieldType = { kind: "literal", value: valArg.text().slice(1, -1) };
                } else if (valArg.kind === "number") {
                  fieldType = { kind: "literal", value: Number(valArg.text()) };
                } else if (valArg.kind === "true") {
                  fieldType = { kind: "literal", value: true };
                } else if (valArg.kind === "false") {
                  fieldType = { kind: "literal", value: false };
                }
              }

              const span = mapper.toSourceSpanFromUtf16(
                node.range.start,
                node.range.end,
                documentUri
              );
              const evidence: EvidenceRef = {
                id: `ev-formdata-${node.range.start}`,
                kind: "literal-syntax",
                strength: "direct",
                source: span,
                description: `FormData field '${fieldName}' appended via ${propNode.text()}()`
              };

              const existing = fields.find((f) => f.name === fieldName);
              if (existing) {
                if (!isConditional) {
                  existing.presence = "required";
                }
                existing.evidence.push(evidence);
              } else {
                fields.push({
                  name: fieldName,
                  type: fieldType,
                  presence: isConditional ? "optional" : "required",
                  nullable: "no",
                  evidence: [evidence]
                });
              }
            } else {
              hasDynamicAppends = true;
              dynamicAppendCount++;
            }
          }
        }
      }
    }

    for (const child of node.namedChildren()) {
      walk(child);
    }
  }

  walk(scopeNode);

  return {
    fields,
    hasConstruction,
    hasAppends,
    hasDynamicAppends,
    dynamicAppendCount
  };
}

/**
 * Statically discovers .append(...) or .set(...) calls on a FormData variable
 * within an enclosing AST scope and extracts them into FieldShapes.
 */
export function extractFormDataFields(
  scopeNode: SyntaxNode,
  varName: string,
  documentUri: DocumentUri,
  mapper: PositionMapper
): FieldShape[] {
  return analyzeFormData(scopeNode, varName, documentUri, mapper).fields;
}

export interface EnclosingParameterInfo {
  fnNode: SyntaxNode;
  fnName?: string;
  paramIndex: number;
  paramNode: SyntaxNode;
  typeAnnotationNode?: SyntaxNode;
  innerTypeNode?: SyntaxNode;
}

/**
 * Finds the formal parameter declaration for a variable name within enclosing functions.
 */
export function findEnclosingParameter(
  node: SyntaxNode,
  paramName: string
): EnclosingParameterInfo | undefined {
  let curr: SyntaxNode | undefined = node.parent();
  while (curr) {
    if (
      curr.kind === "function_declaration" ||
      curr.kind === "function_expression" ||
      curr.kind === "arrow_function" ||
      curr.kind === "method_definition"
    ) {
      let fnName: string | undefined;
      const nameNode = curr.childForField("name");
      if (nameNode && nameNode.kind === "identifier") {
        fnName = nameNode.text();
      } else if (curr.parent()?.kind === "variable_declarator") {
        const varNameNode = curr.parent()?.childForField("name");
        if (varNameNode && varNameNode.kind === "identifier") {
          fnName = varNameNode.text();
        }
      }

      const paramsNode =
        curr.childForField("parameters") ??
        curr.namedChildren().find((c) => c.kind === "formal_parameters");
      if (paramsNode) {
        const namedParams = paramsNode.namedChildren();
        for (let i = 0; i < namedParams.length; i++) {
          const p = namedParams[i];
          let idName: string | undefined;
          let typeAnnotationNode: SyntaxNode | undefined;

          if (p.kind === "identifier") {
            idName = p.text();
          } else if (p.kind === "required_parameter" || p.kind === "optional_parameter") {
            const patternNode = p.childForField("pattern") ?? p.namedChildren()[0];
            if (patternNode && patternNode.kind === "identifier") {
              idName = patternNode.text();
            }
            typeAnnotationNode =
              p.childForField("type") ??
              p.namedChildren().find((c) => c.kind === "type_annotation");
          }

          if (idName === paramName) {
            const innerTypeNode = typeAnnotationNode?.namedChildren()[0];
            return {
              fnNode: curr,
              fnName,
              paramIndex: i,
              paramNode: p,
              typeAnnotationNode,
              innerTypeNode
            };
          }
        }
      }
      break;
    }
    curr = curr.parent();
  }
  return undefined;
}

/**
 * Checks if a headers object literal specifies multipart/form-data.
 */
export function isMultipartHeaders(headersNode?: SyntaxNode): boolean {
  if (!headersNode || headersNode.kind !== "object") {
    return false;
  }
  for (const child of headersNode.namedChildren()) {
    if (child.kind !== "pair") {
      continue;
    }
    const keyNode = child.childForField("key") ?? child.namedChildren()[0];
    const valNode = child.childForField("value") ?? child.namedChildren()[1];
    if (!keyNode || !valNode) {
      continue;
    }
    let keyText = keyNode.text().toLowerCase();
    if (keyNode.kind === "string") {
      keyText = keyText.slice(1, -1).toLowerCase();
    }
    if (keyText === "content-type") {
      let valText = valNode.text().toLowerCase();
      if (valNode.kind === "string") {
        valText = valText.slice(1, -1).toLowerCase();
      }
      if (valText.includes("multipart/form-data")) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks if a syntax node represents or refers to a FormData instance.
 */
export function isFormDataNode(
  node: SyntaxNode,
  resolver?: ShapeFieldResolver,
  documentUri?: DocumentUri
): boolean {
  if (node.kind === "new_expression") {
    const callee = node.childForField("constructor") ?? node.namedChildren()[0];
    if (callee?.text() === "FormData") {
      return true;
    }
  }

  if (node.kind === "identifier") {
    const name = node.text();
    // If the identifier statically resolves to a known object literal / useState state, it is not a FormData instance
    if (resolver?.resolveObjectLiteral && documentUri) {
      const res = resolver.resolveObjectLiteral(name, documentUri, node.range);
      if (res.state === "resolved") {
        return false;
      }
    }

    if (resolver && documentUri && "index" in resolver) {
      const resolverWithIdx = resolver as unknown as {
        index?: {
          lookupSymbols?(
            name: string,
            uri: DocumentUri
          ): readonly {
            documentUri: DocumentUri;
            kind: string;
            initializerText?: string;
          }[];
        };
      };
      const idx = resolverWithIdx.index;
      if (typeof idx?.lookupSymbols === "function") {
        const decls = idx.lookupSymbols(name, documentUri);
        const match = decls.find(
          (d) =>
            d.documentUri === documentUri &&
            d.kind === "variable" &&
            Boolean(d.initializerText?.includes("FormData"))
        );
        if (match) {
          return true;
        }
      }
    }

    const lower = name.toLowerCase();
    if (lower === "formdata" || lower === "fd" || lower.includes("formdata")) {
      return true;
    }
  }

  return false;
}

export interface WrapperCallsitesResult {
  status: "resolved" | "conflicting" | "dynamic" | "none";
  properties?: FieldShape[];
  evidence?: EvidenceRef[];
  foundCallsites?: boolean;
}

/**
 * Statically discovers callsites of a wrapper function within the parsed AST
 * and synthesizes the forwarded parameter shape when callers agree.
 */
export function analyzeWrapperCallsites(
  rootNode: SyntaxNode,
  fnName: string,
  paramIndex: number,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  resolver?: ShapeFieldResolver
): WrapperCallsitesResult {
  const callsitesProperties: FieldShape[][] = [];
  const callsitesEvidence: EvidenceRef[] = [];
  let foundCallsite = false;
  let hasDynamic = false;

  function walk(node: SyntaxNode) {
    if (node.kind === "call_expression") {
      const fnNode = node.childForField("function") ?? node.namedChildren()[0];
      let matches = false;
      if (fnNode) {
        if (fnNode.kind === "identifier" && fnNode.text() === fnName) {
          matches = true;
        } else if (fnNode.kind === "member_expression") {
          const prop = fnNode.childForField("property") ?? fnNode.namedChildren()[1];
          if (prop?.text() === fnName) {
            matches = true;
          }
        }
      }

      if (matches) {
        foundCallsite = true;
        const argsNode = node.childForField("arguments");
        const args = argsNode ? argsNode.namedChildren() : [];
        if (paramIndex < args.length) {
          const arg = args[paramIndex];
          if (arg.kind === "object") {
            const fields = extractObjectFields(arg, documentUri, mapper, resolver);
            callsitesProperties.push(fields);
            callsitesEvidence.push({
              id: `ev-wrapper-call-${node.range.start}`,
              kind: "local-declaration",
              strength: "inferred",
              source: mapper.toSourceSpanFromUtf16(node.range.start, node.range.end, documentUri),
              description: `Wrapper call to '${fnName}' passing object literal`
            });
          } else if (arg.kind === "identifier" && resolver?.resolveObjectLiteral) {
            const res = resolver.resolveObjectLiteral(arg.text(), documentUri, arg.range);
            if (res.state === "resolved" && res.value) {
              callsitesProperties.push([...res.value]);
              callsitesEvidence.push({
                id: `ev-wrapper-call-${node.range.start}`,
                kind: "local-declaration",
                strength: "inferred",
                source: mapper.toSourceSpanFromUtf16(node.range.start, node.range.end, documentUri),
                description: `Wrapper call to '${fnName}' passing resolved object '${arg.text()}'`
              });
            } else {
              hasDynamic = true;
            }
          } else {
            hasDynamic = true;
          }
        } else {
          hasDynamic = true;
        }
      }
    }

    for (const child of node.namedChildren()) {
      walk(child);
    }
  }

  walk(rootNode);

  if (!foundCallsite) {
    return { status: "none", foundCallsites: false };
  }

  if (hasDynamic || callsitesProperties.length === 0) {
    return { status: "dynamic", foundCallsites: true };
  }

  const firstSet = callsitesProperties[0];
  const firstKeyNames = new Set(firstSet.map((f) => f.name));

  for (let i = 1; i < callsitesProperties.length; i++) {
    const current = callsitesProperties[i];
    if (current.length !== firstKeyNames.size || !current.every((f) => firstKeyNames.has(f.name))) {
      return { status: "conflicting" };
    }
  }

  const synthesized: FieldShape[] = firstSet.map((f) => ({
    ...f,
    evidence: [...f.evidence, ...callsitesEvidence]
  }));

  return {
    status: "resolved",
    properties: synthesized,
    evidence: callsitesEvidence
  };
}
