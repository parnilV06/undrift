// Route helper callsite resolver as specified in Phase 6.3 Task 3.
// Resolves static route path parameters forwarded through unexported local helper functions.

import type {
  AnalysisWarning,
  DocumentUri,
  EvidenceRef,
  ObservedValue,
  RoutePattern,
  SourceSpan,
  SyntaxNode
} from "@undrift/core";
import { PositionMapper } from "@undrift/parser-tree-sitter";
import type { LocalReferenceResolver } from "../project-index/local-reference-resolver";

export interface EnclosingParameterInfo {
  readonly name: string;
  readonly index: number;
  readonly node: SyntaxNode;
}

export interface EnclosingFunctionInfo {
  readonly fnNode: SyntaxNode;
  readonly fnName?: string;
  readonly isExported: boolean;
  readonly params: readonly EnclosingParameterInfo[];
}

export interface ResolvedHelperCallsite {
  readonly callNode: SyntaxNode;
  readonly callSpan: SourceSpan;
  readonly staticValue: string;
  readonly evidence: readonly EvidenceRef[];
}

export interface DynamicHelperCallsite {
  readonly callNode: SyntaxNode;
  readonly callSpan: SourceSpan;
  readonly expressionText: string;
}

export interface RouteHelperCallsitesResult {
  readonly status: "resolved" | "mixed" | "unresolved" | "escaping" | "no-callsites";
  readonly fnName?: string;
  readonly paramIndex?: number;
  readonly paramName?: string;
  readonly resolvedCallsites: readonly ResolvedHelperCallsite[];
  readonly dynamicCallsites: readonly DynamicHelperCallsite[];
}

export interface ResolvedHelperRoute {
  readonly routeValue: ObservedValue<RoutePattern>;
  readonly callNode: SyntaxNode;
  readonly callSpan: SourceSpan;
  readonly staticValue: string;
}

export interface DynamicHelperRoute {
  readonly routeValue: ObservedValue<RoutePattern>;
  readonly warning: AnalysisWarning;
  readonly callNode?: SyntaxNode;
  readonly callSpan?: SourceSpan;
}

export interface RouteHelperResolution {
  readonly status: "resolved" | "mixed" | "no-callsites" | "unresolved" | "escaping";
  readonly resolvedRoutes: readonly ResolvedHelperRoute[];
  readonly dynamicRoutes: readonly DynamicHelperRoute[];
}

/**
 * Checks if a symbol identifier is exported anywhere in the document AST.
 */
export function isSymbolExported(root: SyntaxNode, symbolName: string): boolean {
  for (const child of root.namedChildren()) {
    // 1. ES Module export statements
    if (child.kind === "export_statement") {
      const text = child.text();
      if (!text.includes(symbolName)) {
        continue;
      }

      // Check export clause specifiers e.g. export { requestUser, foo as bar }
      const exportClause = child.namedChildren().find((c) => c.kind === "export_clause");
      if (exportClause) {
        for (const spec of exportClause.namedChildren()) {
          if (spec.kind === "export_specifier") {
            const nameNode = spec.childForField("name") ?? spec.namedChildren()[0];
            const aliasNode = spec.childForField("alias") ?? spec.namedChildren()[1];
            if (nameNode?.text() === symbolName || aliasNode?.text() === symbolName) {
              return true;
            }
          }
        }
      }

      // Check default export e.g. export default requestUser;
      const valNode = child.childForField("value") ?? child.namedChildren()[0];
      if (valNode?.kind === "identifier" && valNode.text() === symbolName) {
        return true;
      }

      // Check declaration e.g. export function requestUser or export const requestUser
      const decl = child.childForField("declaration") ?? child.namedChildren()[0];
      if (decl) {
        if (
          decl.kind === "function_declaration" ||
          decl.kind === "generator_function_declaration"
        ) {
          const fnName = decl.childForField("name")?.text();
          if (fnName === symbolName) {
            return true;
          }
        } else if (decl.kind === "lexical_declaration" || decl.kind === "variable_declaration") {
          for (const declarator of decl.namedChildren()) {
            if (declarator.kind === "variable_declarator") {
              const varName = declarator.childForField("name")?.text();
              if (varName === symbolName) {
                return true;
              }
            }
          }
        }
      }
    }

    // 2. CommonJS module.exports or exports.xyz
    if (child.kind === "expression_statement") {
      const expr = child.namedChildren()[0];
      if (expr && expr.kind === "assignment_expression") {
        const left = expr.childForField("left") ?? expr.namedChildren()[0];
        const right = expr.childForField("right") ?? expr.namedChildren()[1];
        const leftText = left?.text() ?? "";

        // module.exports = symbolName
        if (leftText === "module.exports" && right?.text() === symbolName) {
          return true;
        }

        // module.exports = { symbolName } or { foo: symbolName }
        if (leftText === "module.exports" && right?.kind === "object") {
          if (right.text().includes(symbolName)) {
            for (const prop of right.namedChildren()) {
              if (prop.kind === "shorthand_property_identifier" && prop.text() === symbolName) {
                return true;
              }
              if (prop.kind === "pair") {
                const val = prop.childForField("value") ?? prop.namedChildren()[1];
                if (val?.text() === symbolName) {
                  return true;
                }
              }
            }
          }
        }

        // exports.symbolName = ... or module.exports.symbolName = ...
        if (leftText === `exports.${symbolName}` || leftText === `module.exports.${symbolName}`) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Finds the immediate enclosing function node, its name, export status, and formal parameters.
 */
export function findEnclosingFunction(
  node: SyntaxNode,
  root?: SyntaxNode
): EnclosingFunctionInfo | undefined {
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
      } else if (curr.parent()?.kind === "pair") {
        const keyNode = curr.parent()?.childForField("key");
        if (keyNode && keyNode.kind === "identifier") {
          fnName = keyNode.text();
        }
      }

      // Check export status directly from parent AST
      let isExported = false;
      let p: SyntaxNode | undefined = curr.parent();
      while (p) {
        if (p.kind === "export_statement") {
          isExported = true;
          break;
        }
        p = p.parent();
      }

      if (!isExported && fnName && root) {
        isExported = isSymbolExported(root, fnName);
      }

      // Extract formal parameters
      const paramsNode =
        curr.childForField("parameters") ??
        curr.namedChildren().find((c) => c.kind === "formal_parameters");
      const params: EnclosingParameterInfo[] = [];

      if (paramsNode) {
        const namedChildren = paramsNode.namedChildren();
        for (let i = 0; i < namedChildren.length; i++) {
          const param = namedChildren[i];
          let paramName: string | undefined;
          if (param.kind === "identifier") {
            paramName = param.text();
          } else if (param.kind === "required_parameter" || param.kind === "optional_parameter") {
            const pattern = param.childForField("pattern") ?? param.namedChildren()[0];
            if (pattern && pattern.kind === "identifier") {
              paramName = pattern.text();
            }
          }
          if (paramName) {
            params.push({ name: paramName, index: i, node: param });
          }
        }
      }

      return {
        fnNode: curr,
        fnName,
        isExported,
        params
      };
    }
    curr = curr.parent();
  }
  return undefined;
}

/**
 * Discovers and resolves callsites of an unexported local helper function.
 */
export function resolveRouteHelperCallsites(
  root: SyntaxNode,
  fnName: string,
  paramIndex: number,
  paramName: string,
  declNode: SyntaxNode,
  documentUri: DocumentUri,
  mapper: PositionMapper,
  resolver?: LocalReferenceResolver
): RouteHelperCallsitesResult {
  const directCallsites: Array<{
    callNode: SyntaxNode;
    callSpan: SourceSpan;
    argNode?: SyntaxNode;
  }> = [];
  let hasEscapingReference = false;

  function walk(n: SyntaxNode) {
    if (n.kind === "identifier" && n.text() === fnName) {
      // 1. Inside declaration itself?
      if (n.range.start >= declNode.range.start && n.range.end <= declNode.range.end) {
        return;
      }

      // 2. Direct callee of a call expression?
      const parent = n.parent();
      if (parent && parent.kind === "call_expression") {
        const callee = parent.childForField("function") ?? parent.namedChildren()[0];
        if (callee) {
          let isDirectCallee = false;
          if (callee.range.start === n.range.start && callee.range.end === n.range.end) {
            isDirectCallee = true;
          } else if (callee.kind === "member_expression") {
            const prop = callee.childForField("property") ?? callee.namedChildren()[1];
            if (prop && prop.range.start === n.range.start && prop.range.end === n.range.end) {
              isDirectCallee = true;
            }
          }

          if (isDirectCallee) {
            const argsNode = parent.childForField("arguments");
            const args = argsNode ? argsNode.namedChildren() : [];
            const argNode = paramIndex < args.length ? args[paramIndex] : undefined;
            const callSpan = mapper.toSourceSpanFromUtf16(
              parent.range.start,
              parent.range.end,
              documentUri
            );
            directCallsites.push({
              callNode: parent,
              callSpan,
              argNode
            });
            return;
          }
        }
      }

      // 3. Any other occurrence of fnName means it escapes as a value (e.g. passed as argument, assigned, returned, exported)
      hasEscapingReference = true;
      return;
    }

    for (const child of n.namedChildren()) {
      walk(child);
    }
  }

  walk(root);

  if (hasEscapingReference) {
    return {
      status: "escaping",
      fnName,
      paramIndex,
      paramName,
      resolvedCallsites: [],
      dynamicCallsites: []
    };
  }

  if (directCallsites.length === 0) {
    return {
      status: "no-callsites",
      fnName,
      paramIndex,
      paramName,
      resolvedCallsites: [],
      dynamicCallsites: []
    };
  }

  const resolvedCallsites: ResolvedHelperCallsite[] = [];
  const dynamicCallsites: DynamicHelperCallsite[] = [];

  for (const cs of directCallsites) {
    if (!cs.argNode) {
      dynamicCallsites.push({
        callNode: cs.callNode,
        callSpan: cs.callSpan,
        expressionText: "<missing>"
      });
      continue;
    }

    const arg = cs.argNode;
    let staticVal: string | undefined;

    // String literal e.g. 'register'
    if (arg.kind === "string") {
      staticVal = arg.text().slice(1, -1);
    } else if (arg.kind === "template_string" && !arg.text().includes("${")) {
      staticVal = arg.text().slice(1, -1);
    } else if (arg.kind === "identifier" && resolver) {
      const res = resolver.resolveConstant<string>(arg.text(), documentUri, arg.range);
      if (res.state === "resolved" && typeof res.value === "string") {
        staticVal = res.value;
      }
    }

    if (staticVal !== undefined) {
      resolvedCallsites.push({
        callNode: cs.callNode,
        callSpan: cs.callSpan,
        staticValue: staticVal,
        evidence: [
          {
            id: `ev-helper-call-${cs.callNode.range.start}`,
            kind: "local-declaration",
            strength: "resolved",
            source: cs.callSpan,
            description: `Helper call to '${fnName}' passing static route argument '${staticVal}'`
          }
        ]
      });
    } else {
      dynamicCallsites.push({
        callNode: cs.callNode,
        callSpan: cs.callSpan,
        expressionText: arg.text()
      });
    }
  }

  let status: RouteHelperCallsitesResult["status"];
  if (dynamicCallsites.length === 0 && resolvedCallsites.length > 0) {
    status = "resolved";
  } else if (resolvedCallsites.length > 0 && dynamicCallsites.length > 0) {
    status = "mixed";
  } else {
    status = "unresolved";
  }

  return {
    status,
    fnName,
    paramIndex,
    paramName,
    resolvedCallsites,
    dynamicCallsites
  };
}
