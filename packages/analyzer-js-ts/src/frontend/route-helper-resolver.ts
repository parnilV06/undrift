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
import type {
  LocalDeclarationIndex,
  LocalVariableDeclaration
} from "../project-index/local-declaration-index";
import { matchesModuleSpecifier } from "../shapes/cross-module-flow-resolver";

export interface EnclosingParameterInfo {
  readonly name: string;
  readonly index: number;
  readonly node: SyntaxNode;
}

export interface EnclosingFunctionInfo {
  readonly fnNode: SyntaxNode;
  readonly fnName?: string;
  readonly isExported: boolean;
  readonly isModuleScope: boolean;
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
 * Checks whether a function syntax node is declared directly at module/file scope
 * rather than being nested inside another function, method, or class body.
 */
export function isFunctionAtModuleScope(fnNode: SyntaxNode, root?: SyntaxNode): boolean {
  let p: SyntaxNode | undefined = fnNode.parent();
  while (p) {
    if (root && p.range.start === root.range.start && p.range.end === root.range.end) {
      return true;
    }
    if (p.kind === "program") {
      return true;
    }
    // If the function is declared inside another function, method, or class body, it is NOT at module scope
    if (
      p.kind === "function_declaration" ||
      p.kind === "function_expression" ||
      p.kind === "arrow_function" ||
      p.kind === "method_definition" ||
      p.kind === "generator_function" ||
      p.kind === "generator_function_declaration" ||
      p.kind === "class_declaration" ||
      p.kind === "class_expression" ||
      p.kind === "class_body"
    ) {
      return false;
    }
    p = p.parent();
  }
  return true;
}

/**
 * Checks whether an occurrence of an identifier is shadowed by an intervening parameter or local declaration.
 */
export function isIdentifierShadowed(
  node: SyntaxNode,
  symbolName: string,
  declNode: SyntaxNode
): boolean {
  let curr: SyntaxNode | undefined = node.parent();
  while (curr) {
    if (curr.range.start === declNode.range.start && curr.range.end === declNode.range.end) {
      break;
    }
    if (
      curr.kind === "function_declaration" ||
      curr.kind === "function_expression" ||
      curr.kind === "arrow_function" ||
      curr.kind === "method_definition"
    ) {
      const paramsNode =
        curr.childForField("parameters") ??
        curr.namedChildren().find((c) => c.kind === "formal_parameters");
      if (paramsNode) {
        for (const p of paramsNode.namedChildren()) {
          let paramName: string | undefined;
          if (p.kind === "identifier") {
            paramName = p.text();
          } else if (p.kind === "required_parameter" || p.kind === "optional_parameter") {
            const pat = p.childForField("pattern") ?? p.namedChildren()[0];
            if (pat?.kind === "identifier") paramName = pat.text();
          }
          if (paramName === symbolName) {
            return true;
          }
        }
      }
    }

    if (curr.kind === "statement_block") {
      for (const stmt of curr.namedChildren()) {
        if (stmt.range.start === declNode.range.start && stmt.range.end === declNode.range.end) {
          continue;
        }
        if (stmt.kind === "lexical_declaration" || stmt.kind === "variable_declaration") {
          for (const declarator of stmt.namedChildren()) {
            if (declarator.kind === "variable_declarator") {
              const nameNode = declarator.childForField("name") ?? declarator.namedChildren()[0];
              if (nameNode?.kind === "identifier" && nameNode.text() === symbolName) {
                if (declarator.range.start < node.range.start) {
                  return true;
                }
              }
            }
          }
        }
      }
    }

    curr = curr.parent();
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

      // Check module-level declaration context
      const isModuleScope = isFunctionAtModuleScope(curr, root);

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
        isModuleScope,
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

      // Check if this reference is shadowed by an intervening lexical parameter or variable
      if (isIdentifierShadowed(n, fnName, declNode)) {
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

export interface GenericTransportCheckResult {
  readonly isTransportHelper: boolean;
  readonly allResolved: boolean;
  readonly resolvedCount: number;
  readonly dynamicCount: number;
}

/**
 * Checks whether an exported generic transport function (such as `request(url, options)`)
 * forwards a dynamic URL parameter whose callers across the workspace provide concrete endpoints.
 */
export function isGenericTransportHelperResolved(
  fnName: string,
  paramIndex: number,
  declDocUri: DocumentUri,
  index?: LocalDeclarationIndex
): GenericTransportCheckResult {
  if (!index) {
    return { isTransportHelper: false, allResolved: false, resolvedCount: 0, dynamicCount: 0 };
  }

  const allDecls = index.lookupSymbols(fnName);
  const imports = allDecls.filter(
    (d) =>
      d.kind === "import" && matchesModuleSpecifier(d.documentUri, d.moduleSpecifier, declDocUri)
  );

  if (imports.length === 0) {
    return { isTransportHelper: false, allResolved: false, resolvedCount: 0, dynamicCount: 0 };
  }

  let totalCalls = 0;
  let dynamicCalls = 0;
  let resolvedCalls = 0;

  for (const imp of imports) {
    const parsed = index.getParsedDocument(imp.documentUri);
    if (!parsed) continue;

    const localIndex = index;
    function walk(n: SyntaxNode) {
      if (n.kind === "call_expression") {
        const callee = n.childForField("function");
        if (callee?.kind === "identifier" && callee.text() === imp.name) {
          totalCalls++;
          const args = n.childForField("arguments")?.namedChildren() ?? [];
          if (paramIndex < args.length) {
            const arg = args[paramIndex];
            let isStatic = false;
            if (arg.kind === "string") {
              isStatic = true;
            } else if (arg.kind === "binary_expression") {
              const left = arg.childForField("left");
              if (left?.kind === "string") {
                isStatic = true;
              }
            } else if (arg.kind === "template_string") {
              isStatic = true;
            } else if (arg.kind === "identifier") {
              const localDecls = localIndex.getDeclarationsForDocument(imp.documentUri);
              const varDecl = localDecls.find(
                (d): d is LocalVariableDeclaration => d.kind === "variable" && d.name === arg.text()
              );
              if (varDecl?.initializerText && /^['"`]\//.test(varDecl.initializerText.trim())) {
                isStatic = true;
              }
            }
            if (isStatic) {
              resolvedCalls++;
            } else {
              dynamicCalls++;
            }
          } else {
            dynamicCalls++;
          }
        }
      }
      for (const c of n.namedChildren()) walk(c);
    }
    walk(parsed.root);
  }

  if (totalCalls > 0 && dynamicCalls === 0) {
    return {
      isTransportHelper: true,
      allResolved: true,
      resolvedCount: resolvedCalls,
      dynamicCount: 0
    };
  }
  if (totalCalls > 0 && dynamicCalls > 0) {
    return {
      isTransportHelper: true,
      allResolved: false,
      resolvedCount: resolvedCalls,
      dynamicCount: dynamicCalls
    };
  }
  return { isTransportHelper: false, allResolved: false, resolvedCount: 0, dynamicCount: 0 };
}
