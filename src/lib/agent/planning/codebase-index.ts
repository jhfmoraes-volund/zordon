import { Parser, Language } from "web-tree-sitter";
import fs from "fs/promises";
import path from "path";

/**
 * Structured index of the codebase for planning agents.
 * Extracted via tree-sitter AST parsing.
 */
export interface CodebaseIndex {
  files: FileEntry[];
  dbTables: string[];
  apiRoutes: ApiRoute[];
  exports: ExportEntry[];
  interfaces: InterfaceEntry[];
}

interface FileEntry {
  path: string;
  loc: number;
}

interface ApiRoute {
  method: string;
  path: string;
  file: string;
}

interface ExportEntry {
  name: string;
  kind: "function" | "const" | "class" | "type";
  file: string;
}

interface InterfaceEntry {
  name: string;
  file: string;
}

/**
 * Builds a structured index of the codebase by walking src/**\/*.ts(x),
 * parsing with tree-sitter, and extracting:
 * - Exported functions/consts/classes/types
 * - Interfaces
 * - DB tables (via CREATE TABLE regex in migrations)
 * - API routes (via route.ts files)
 *
 * Results are cached in /tmp/volund-codebase-index/<sha>.json by git SHA.
 */
export async function buildCodebaseIndex(
  repoRoot: string
): Promise<CodebaseIndex> {
  // Get current git SHA for cache key
  const { execSync } = await import("child_process");
  const gitSha = execSync("git rev-parse HEAD", {
    cwd: repoRoot,
    encoding: "utf-8",
  }).trim();

  const cacheDir = "/tmp/volund-codebase-index";
  const cacheFile = path.join(cacheDir, `${gitSha}.json`);

  // Check cache
  try {
    const cached = await fs.readFile(cacheFile, "utf-8");
    return JSON.parse(cached);
  } catch {
    // Cache miss - proceed to build
  }

  // Initialize tree-sitter
  await Parser.init();
  const parser = new Parser();
  const wasmPath = path.join(
    repoRoot,
    "node_modules",
    "tree-sitter-typescript",
    "tree-sitter-typescript.wasm"
  );
  const TypeScript = await Language.load(wasmPath);
  parser.setLanguage(TypeScript);

  const index: CodebaseIndex = {
    files: [],
    dbTables: [],
    apiRoutes: [],
    exports: [],
    interfaces: [],
  };

  // Walk src/**/*.ts(x)
  const srcDir = path.join(repoRoot, "src");
  const files = await walkFiles(srcDir, /\.tsx?$/);

  for (const file of files) {
    const content = await fs.readFile(file, "utf-8");
    const loc = content.split("\n").length;

    index.files.push({
      path: path.relative(repoRoot, file),
      loc,
    });

    // Parse with tree-sitter
    const tree = parser.parse(content);
    if (!tree) continue;
    const root = tree.rootNode;

    // Extract exports
    for (const node of root.children) {
      if (node.type === "export_statement") {
        const declaration = node.childForFieldName("declaration");
        if (!declaration) continue;

        if (declaration.type === "function_declaration") {
          const name = declaration.childForFieldName("name")?.text;
          if (name) {
            index.exports.push({
              name,
              kind: "function",
              file: path.relative(repoRoot, file),
            });
          }
        } else if (declaration.type === "lexical_declaration") {
          const declarator = declaration.descendantsOfType("variable_declarator")[0];
          const name = declarator?.childForFieldName("name")?.text;
          if (name) {
            index.exports.push({
              name,
              kind: "const",
              file: path.relative(repoRoot, file),
            });
          }
        } else if (declaration.type === "class_declaration") {
          const name = declaration.childForFieldName("name")?.text;
          if (name) {
            index.exports.push({
              name,
              kind: "class",
              file: path.relative(repoRoot, file),
            });
          }
        } else if (declaration.type === "type_alias_declaration") {
          const name = declaration.childForFieldName("name")?.text;
          if (name) {
            index.exports.push({
              name,
              kind: "type",
              file: path.relative(repoRoot, file),
            });
          }
        }
      }

      // Extract interfaces
      if (node.type === "interface_declaration") {
        const name = node.childForFieldName("name")?.text;
        if (name) {
          index.interfaces.push({
            name,
            file: path.relative(repoRoot, file),
          });
        }
      }
    }

    // Extract API routes from route.ts files
    if (file.endsWith("route.ts") && file.includes("/api/")) {
      const routePath = file
        .split("/api/")[1]
        .replace("/route.ts", "")
        .replace(/\[([^\]]+)\]/g, ":$1"); // [id] -> :id

      // Check for HTTP method exports
      for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
        if (content.includes(`export async function ${method}`)) {
          index.apiRoutes.push({
            method,
            path: `/api/${routePath}`,
            file: path.relative(repoRoot, file),
          });
        }
      }
    }
  }

  // Extract DB tables from migrations
  const migrationsDir = path.join(repoRoot, "supabase", "migrations");
  try {
    const migrationFiles = await fs.readdir(migrationsDir);
    for (const file of migrationFiles) {
      if (!file.endsWith(".sql")) continue;
      const content = await fs.readFile(
        path.join(migrationsDir, file),
        "utf-8"
      );
      const matches = content.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["']?(\w+)["']?/gi);
      for (const match of matches) {
        const tableName = match[1];
        if (!index.dbTables.includes(tableName)) {
          index.dbTables.push(tableName);
        }
      }
    }
  } catch {
    // No migrations dir - skip
  }

  // Save to cache
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(cacheFile, JSON.stringify(index, null, 2));

  return index;
}

/**
 * Recursively walks a directory and returns all files matching the pattern.
 */
async function walkFiles(dir: string, pattern: RegExp): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...(await walkFiles(fullPath, pattern)));
      } else if (entry.isFile() && pattern.test(entry.name)) {
        result.push(fullPath);
      }
    }
  } catch {
    // Directory not readable - skip
  }
  return result;
}
