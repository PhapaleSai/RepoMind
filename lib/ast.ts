import { parse } from "@babel/parser";
import type { File, Node, Statement } from "@babel/types";

// Real AST-based symbol/import extraction for JS/TS/JSX/TSX, replacing the regex heuristics
// that used to run for every language. @babel/parser is pure JS (no native bindings), so it
// bundles cleanly into a Vercel serverless function — unlike tree-sitter, which needs either
// native .node binaries per platform or a WASM grammar file per language shipped as a runtime
// asset. That's the real tradeoff of "AST-based extraction" in this environment: a proper
// parser for JS/TS today, rather than a shakier multi-language setup that risks breaking the
// deploy. Python and every other ingested language still fall back to the regex heuristics in
// lib/graph.ts — a real AST for those would need a second, non-trivial parsing stack.

export interface AstSymbol {
  name: string;
  kind: "function" | "class";
}

export interface AstExtraction {
  symbols: AstSymbol[];
  importSpecs: string[];
}

const JS_TS_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);

export function isAstSupported(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  return dot !== -1 && JS_TS_EXTENSIONS.has(filePath.slice(dot));
}

function unwrapExported(stmt: Statement): Node {
  if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) return stmt.declaration;
  if (stmt.type === "ExportDefaultDeclaration") return stmt.declaration as Node;
  return stmt;
}

// Only walks into plain objects/arrays that look like AST nodes — enough to find every
// CallExpression (require(...) and dynamic import(...)) anywhere in the file without pulling
// in @babel/traverse as an extra dependency.
function walk(node: any, visit: (n: any) => void) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const key in node) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit);
    } else if (value && typeof value === "object") {
      walk(value, visit);
    }
  }
}

function extractImports(ast: File): string[] {
  const specs: string[] = [];
  walk(ast.program, (node) => {
    if (node.type === "ImportDeclaration" && typeof node.source?.value === "string") {
      specs.push(node.source.value);
    } else if (
      node.type === "CallExpression" &&
      (node.callee?.type === "Import" || (node.callee?.type === "Identifier" && node.callee.name === "require")) &&
      node.arguments?.[0]?.type === "StringLiteral"
    ) {
      specs.push(node.arguments[0].value);
    }
  });
  return specs;
}

function extractTopLevelSymbols(ast: File): AstSymbol[] {
  const symbols: AstSymbol[] = [];
  const seen = new Set<string>();

  function add(name: string | undefined | null, kind: AstSymbol["kind"]) {
    if (!name) return;
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    symbols.push({ name, kind });
  }

  for (const stmt of ast.program.body) {
    const node = unwrapExported(stmt);
    if (!node) continue;

    if (node.type === "FunctionDeclaration") {
      add(node.id?.name, "function");
    } else if (node.type === "ClassDeclaration") {
      add(node.id?.name, "class");
    } else if (node.type === "TSInterfaceDeclaration") {
      add(node.id?.name, "class");
    } else if (node.type === "VariableDeclaration") {
      for (const decl of node.declarations) {
        if (decl.id.type !== "Identifier" || !decl.init) continue;
        if (decl.init.type === "ArrowFunctionExpression" || decl.init.type === "FunctionExpression") {
          add(decl.id.name, "function");
        }
      }
    }
  }

  return symbols;
}

export function extractJsSymbolsAndImports(content: string, filePath: string): AstExtraction {
  const isTsx = filePath.endsWith(".tsx");
  const isTs = filePath.endsWith(".ts") || filePath.endsWith(".mts") || filePath.endsWith(".cts") || isTsx;

  const ast = parse(content, {
    sourceType: "unambiguous",
    errorRecovery: true,
    plugins: [
      isTs ? "typescript" : "flow",
      "jsx",
      "classProperties",
      "classPrivateProperties",
      "classPrivateMethods",
      "decorators-legacy",
      "optionalChaining",
      "nullishCoalescingOperator",
      "objectRestSpread",
      "dynamicImport",
      "topLevelAwait",
      "exportDefaultFrom",
    ],
  });

  return { symbols: extractTopLevelSymbols(ast), importSpecs: extractImports(ast) };
}
