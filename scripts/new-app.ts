/**
 * new-app — scaffolder de Zordon App (App SDK).
 *
 * Gera um app auto-contido em 3 toques deterministas:
 *   1. stub da Surface  → src/components/apps/<key>/<key>-app.tsx
 *   2. def (metadata)   → src/lib/apps/defs/overview/<key>.tsx
 *   3. registra no barrel (src/lib/apps/overview-registry.ts) nos marcadores
 *      <new-app:import> / <new-app:entry>.
 *
 * Escopo: só `overview` por enquanto (único migrado pro AppHost). Client/project
 * seguem no switch antigo — gerar def pra eles renderizaria nada, então é erro.
 *
 * Uso:
 *   npx tsx scripts/new-app.ts <key> --name "Nome" --tagline "..." \
 *     --desc "..." [--icon LayoutGrid] [--dot bg-sky-500] [--window 3xl] \
 *     [--access admin] [--dry]
 *
 * A skill /new-app orquestra (coleta os inputs e chama isto).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const BARREL = join(ROOT, "src/lib/apps/overview-registry.ts");

// ─── args ────────────────────────────────────────────────
function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[k] = true;
      else {
        out[k] = next;
        i++;
      }
    } else positionals.push(a);
  }
  return { out, positionals };
}

const { out, positionals } = parseArgs(process.argv.slice(2));
const key = String(out.key ?? positionals[0] ?? "").trim();
const scope = String(out.scope ?? "overview");
const dry = Boolean(out.dry);

function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// ─── validação ───────────────────────────────────────────
if (!key) die("informe a key do app: npx tsx scripts/new-app.ts <key> --name ...");
if (!/^[a-z][a-z0-9-]*$/.test(key))
  die(`key inválida "${key}" — use minúsculas/hífens (ex.: weekly-reports).`);
if (scope !== "overview")
  die(`scope "${scope}" ainda não migrado pro App SDK — só "overview" por ora.`);

const name = String(out.name ?? "").trim() || die("--name é obrigatório.");
const tagline =
  String(out.tagline ?? "").trim() || die("--tagline é obrigatório (uma linha).");
const description =
  String(out.desc ?? out.description ?? "").trim() ||
  die("--desc é obrigatório (corpo do card).");
const icon = String(out.icon ?? "LayoutGrid").trim();
const dot = String(out.dot ?? "bg-sky-500").trim();
const windowSize = String(out.window ?? "3xl").trim();
const access = out.access ? String(out.access).trim() : "";

if (!["lg", "xl", "2xl", "3xl"].includes(windowSize))
  die(`--window "${windowSize}" inválido — use lg|xl|2xl|3xl.`);
if (access && !["builder", "manager", "admin"].includes(access))
  die(`--access "${access}" inválido — use builder|manager|admin.`);

// ─── nomes derivados ─────────────────────────────────────
const pascal = key
  .split("-")
  .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  .join("");
const camel = pascal.charAt(0).toLowerCase() + pascal.slice(1);
const comp = `${pascal}App`;
const defVar = `${camel}App`;

const compDir = join(ROOT, "src/components/apps", key);
const compFile = join(compDir, `${key}-app.tsx`);
const defFile = join(ROOT, "src/lib/apps/defs/overview", `${key}.tsx`);

// ─── colisões ────────────────────────────────────────────
const barrelSrc = readFileSync(BARREL, "utf8");
if (existsSync(defFile)) die(`já existe def: ${defFile}`);
if (existsSync(compFile)) die(`já existe componente: ${compFile}`);
if (barrelSrc.includes(`defs/overview/${key}"`))
  die(`"${key}" já está registrado no barrel.`);
if (!barrelSrc.includes("// <new-app:import>") || !barrelSrc.includes("// <new-app:entry>"))
  die("marcadores <new-app:*> não encontrados no barrel — verifique overview-registry.ts.");

// ─── templates ───────────────────────────────────────────
const compTpl = `"use client";

/**
 * App ${name} (Overview) — ${tagline}
 *
 * Stub gerado por /new-app. Troque pelo conteúdo real. Convenções:
 *   - ResponsiveSheet / ResponsiveDialog / ConfirmDialog (nunca nu).
 *   - useOptimisticCollection ao mutar listas; erros via Sonner toast.
 *   - Estética console: hairline, radius md, mono pra keys/números, sem emoji.
 *   - Barreira real do dado = RLS + rota /api/${key}/* — ${access || "minAccessLevel"} só esconde a UI.
 */

export function ${comp}() {
  return (
    <div className="rounded-md border px-3 py-8 text-center text-sm text-muted-foreground">
      ${name} — superfície vazia. Implemente em{" "}
      <span className="font-mono">src/components/apps/${key}/${key}-app.tsx</span>.
    </div>
  );
}
`;

const accessLine = access ? `  minAccessLevel: "${access}",\n` : "";
const defTpl = `/**
 * App ${name} (Overview${access ? ", " + access + "-only" : ""}) — ${tagline}
 */
import { ${icon} } from "lucide-react";

import { ${comp} } from "@/components/apps/${key}/${key}-app";
import { defineApp } from "@/lib/apps/define-app";

export const ${defVar} = defineApp({
  scope: "overview",
  key: "${key}",
  name: "${name}",
  tagline: "${tagline}",
  description:
    "${description.replace(/"/g, '\\"')}",
  icon: ${icon},
  dot: "${dot}",
  window: "${windowSize}",
${accessLine}  Surface: () => <${comp} />,
});
`;

const importLine = `import { ${defVar} } from "@/lib/apps/defs/overview/${key}";`;
const nextBarrel = barrelSrc
  .replace("// <new-app:import>", `${importLine}\n// <new-app:import>`)
  .replace("  // <new-app:entry>", `  ${defVar},\n  // <new-app:entry>`);

// ─── escrita ─────────────────────────────────────────────
if (dry) {
  console.log(`\n— DRY RUN — nada escrito —\n`);
  console.log(`# ${compFile}\n${compTpl}`);
  console.log(`# ${defFile}\n${defTpl}`);
  console.log(`# patch ${BARREL}:\n  + ${importLine}\n  + ${defVar}, (no array)\n`);
  process.exit(0);
}

mkdirSync(compDir, { recursive: true });
writeFileSync(compFile, compTpl);
writeFileSync(defFile, defTpl);
writeFileSync(BARREL, nextBarrel);

console.log(`\n✓ app "${key}" scaffoldado (escopo overview):`);
console.log(`  · ${compFile}`);
console.log(`  · ${defFile}`);
console.log(`  · registrado em ${BARREL}`);
console.log(`\nPróximos passos:`);
console.log(`  1. npx tsc --noEmit   (confere que compila)`);
console.log(`  2. Implemente a UI em src/components/apps/${key}/${key}-app.tsx`);
console.log(`  3. Se precisar de dados: crie src/app/api/${key}/ + RLS (a barreira real do acesso)`);
console.log(`  4. Confira o ícone "${icon}" em lucide-react (troque no def se não existir)\n`);
