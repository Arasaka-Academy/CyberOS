import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

type Values = ReadonlyMap<string, readonly string[]>;
const methods = new Set(["get", "post", "put", "patch", "delete"]);
function unwrap(node: ts.Expression): ts.Expression {
  return ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
}
function values(node: ts.Expression | undefined, aliases: Values): readonly string[] {
  if (!node) return [];
  node = unwrap(node);
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isIdentifier(node)) return aliases.get(node.text) ?? [];
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((item) => values(item as ts.Expression, aliases));
  if (ts.isTemplateExpression(node)) {
    let result = [node.head.text];
    for (const span of node.templateSpans) result = result.flatMap((prefix) => values(span.expression, aliases).map((part) => prefix + part + span.literal.text));
    return result;
  }
  return [];
}
export function collectApiActions(): string[] {
  const directory = fileURLToPath(new URL("../../api/src/routes/", import.meta.url));
  const actions = new Set<string>();
  for (const name of readdirSync(directory)) {
    if (!name.endsWith(".ts") || name.endsWith(".test.ts")) continue;
    const source = ts.createSourceFile(name, readFileSync(path.join(directory, name), "utf8"), ts.ScriptTarget.Latest, true);
    const constants = new Map<string, readonly string[]>();
    const collectConstants = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const resolved = values(node.initializer, constants);
        if (resolved.length) constants.set(node.name.text, resolved);
      }
      ts.forEachChild(node, collectConstants);
    };
    collectConstants(source);
    const add = (method: string, urls: readonly string[]) => {
      for (const url of urls) if (url === "/health" || url.startsWith("/api/")) actions.add(`${method.toUpperCase()} ${url}`);
    };
    const visit = (node: ts.Node, aliases: Values): void => {
      if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
        const declaration = node.initializer.declarations[0];
        if (declaration && ts.isIdentifier(declaration.name)) {
          visit(node.statement, new Map([...aliases, [declaration.name.text, values(node.expression, aliases)]])); return;
        }
        const array = unwrap(node.expression);
        if (declaration && ts.isArrayBindingPattern(declaration.name) && ts.isArrayLiteralExpression(array)) {
          const binding = declaration.name;
          for (const item of array.elements) if (ts.isArrayLiteralExpression(item)) {
            const next = new Map(aliases);
            binding.elements.forEach((part, index) => { if (ts.isBindingElement(part) && ts.isIdentifier(part.name)) next.set(part.name.text, values(item.elements[index] as ts.Expression | undefined, aliases)); });
            visit(node.statement, next);
          }
          return;
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "server") {
        const method = node.expression.name.text;
        if (methods.has(method)) add(method, values(node.arguments[0], aliases));
        if (method === "route" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
          const props = node.arguments[0].properties;
          const field = (key: string) => props.find((prop): prop is ts.PropertyAssignment => ts.isPropertyAssignment(prop) && prop.name.getText(source) === key)?.initializer;
          for (const verb of values(field("method"), aliases)) add(verb, values(field("url"), aliases));
        }
      }
      ts.forEachChild(node, (child) => visit(child, aliases));
    };
    visit(source, constants);
  }
  // Inventory concrete routes behind Fastify's NVR dispatch proxy as well.
  const rust = readFileSync(fileURLToPath(new URL("../../../crates/nvr/src/server.rs", import.meta.url)), "utf8");
  for (const match of rust.matchAll(/\.route\(\s*"([^"]+)"\s*,\s*([\s\S]*?)(?=\n\s*\.route\(|\n\s*\.with_state\()/g)) {
    for (const method of match[2]!.matchAll(/\b(get|post|put|patch|delete)\s*\(/g)) {
      actions.add(`${method[1]!.toUpperCase()} /api${match[1]!.replace(/\{([^}]+)\}/g, ":$1")}`);
    }
  }
  return [...actions].sort();
}

/** Placeholder spelling does not change the product action's identity. */
export function canonicalAction(action: string): string {
  return action.replace(/:[A-Za-z][A-Za-z0-9_]*/g, ":param");
}
