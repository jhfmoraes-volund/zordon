# Theming Guide — Adicionando Temas de Cor

**Escopo**: como adicionar uma nova modalidade de cor (tema) ao app. Cobre a arquitetura existente, o passo-a-passo pra incluir um tema novo, regras de calibração de tokens e validação.

**Status**: vigente. Estrutura introduzida em 2026-05-29 com `charcoal` (default) e `oled`.

---

## 1. Arquitetura — visão geral

O sistema tem três camadas:

1. **CSS** — cada tema é um bloco `.dark[data-theme="<id>"]` em [src/app/globals.css](../../src/app/globals.css). Tokens variáveis (background, card, sidebar, border…) sobrescrevem o default declarado em `.dark`.
2. **Registry TS** — [src/lib/theme/themes.ts](../../src/lib/theme/themes.ts) lista os temas válidos (`THEMES`), define `ThemeId`, e expõe `swatches` pro preview visual.
3. **Persistência** — cookie `volund.theme` (1 ano, lido no SSR) + `Member.theme` no Supabase (cross-device). Escrita pela server action [`setUserTheme`](../../src/lib/theme/actions.ts).

O fluxo runtime:

```
Server (root layout)              Client
─────────────────────             ──────
readThemeCookie()         ──┐
  ↓                         │
<html data-theme="X">       │     ThemeProvider (initialTheme=X)
                            │       ↓
CSS aplica .dark[data-theme="X"]    useTheme() → { theme, setTheme, pending }
                                     ↓
                                    setUserTheme(next)  ──→  cookie + Member.theme
```

**Princípio**: tema é uma preferência *estável* (raramente muda) → cookie + DB; nenhuma necessidade de localStorage. SSR pinta `data-theme` antes do CSS aplicar → zero FOUC.

---

## 2. Anatomia — arquivos envolvidos

| Arquivo | Responsabilidade |
|---|---|
| [src/app/globals.css](../../src/app/globals.css) | Blocos `.dark[data-theme="<id>"]` com os tokens variáveis. |
| [src/lib/theme/themes.ts](../../src/lib/theme/themes.ts) | Registry: `THEMES`, `ThemeId`, `isThemeId`, `getTheme`, `DEFAULT_THEME_ID`. |
| [src/lib/theme/server.ts](../../src/lib/theme/server.ts) | `readThemeCookie()` — SSR-only. |
| [src/lib/theme/actions.ts](../../src/lib/theme/actions.ts) | Server action `setUserTheme` (cookie + DB). |
| [src/contexts/theme-context.tsx](../../src/contexts/theme-context.tsx) | `ThemeProvider` + `useTheme()` hook. |
| [src/components/theme-syncer.tsx](../../src/components/theme-syncer.tsx) | Reconcilia DB→cookie no mount do dashboard. |
| [src/components/settings/appearance-card.tsx](../../src/components/settings/appearance-card.tsx) | UI do seletor em `/settings`. |
| [supabase/migrations/20260530_member_theme.sql](../../supabase/migrations/20260530_member_theme.sql) | Schema: `Member.theme text NOT NULL DEFAULT 'charcoal'`. |

**Regra de ouro**: adicionar tema novo = **2 arquivos** (CSS + registry). Nenhum dos outros precisa mudar.

---

## 3. Como adicionar um tema novo — passo a passo

### Passo 1 — Escolher um id

Snake-case curto, descritivo, único. Exemplos: `slate`, `dimmed`, `nord`, `dracula`. Evite "dark"/"light" puros (são adjetivos, não nomes).

### Passo 2 — Calibrar os tokens variáveis

Os tokens que **variam entre temas** são apenas os da "escala de superfície" e bordas. Lista canônica:

| Token | Função | Faixa típica (dark) |
|---|---|---|
| `--background` | Fundo principal da página | `L 0.07 – 0.18` |
| `--card` | Surface elevada (cards, panels) | `bg + 0.04` a `bg + 0.08` |
| `--popover` | Popovers, dropdowns (geralmente = card) | mesmo de `--card` |
| `--secondary` | Backgrounds neutros secundários | `bg + 0.08` a `bg + 0.12` |
| `--muted` | Surfaces "calmas" (chips, tags) | `bg + 0.08` a `bg + 0.10` |
| `--accent` | Hover backgrounds | geralmente = `--secondary` |
| `--border` | Bordas com alpha sobre fundo | `oklch(1 0 0 / 8–14%)` |
| `--input` | Bordas de inputs | `border + 2%` alpha |
| `--sidebar` | Sidebar (frame escuro) | `bg − 0.02` a `bg − 0.04` |
| `--sidebar-accent` | Hover dentro do sidebar | `sidebar + 0.04` a `sidebar + 0.06` |

**Não tocar nesses (são theme-invariant em `.dark`)**:
- `--primary`, `--brand`, `--ring`, `--destructive` — identidade da marca.
- `--foreground`, `--muted-foreground`, `--accent-foreground` — contraste é função do `--background`, mas oscila pouco entre temas escuros. Só sobrescreva se o `--background` for radicalmente diferente (ex.: OLED puro).
- `--chart-*` — paleta de gráficos, independente do tema.
- `--paper-*` (sticky notes), `--accent-*` (status chips) — já calibrados pra dark genérico.

#### Heurísticas de calibração (oklch)

`oklch(L C H)` — L=lightness (0–1), C=chroma (saturação, 0–~0.4), H=hue (0–360°).

- **Tema cinza puro**: `C = 0`, `H = 0`. Só varia L.
- **Tema "frio" (slate/blue-gray)**: `C = 0.005–0.015`, `H = 240–260`.
- **Tema "quente" (warm gray)**: `C = 0.005–0.015`, `H = 40–70`.
- **Espaçamento entre níveis**: gap mínimo `L = 0.04` entre superfícies pra hierarquia ser perceptível.
- **Piso de luminância**: evite `L < 0.10` em `--background` se quiser saída do "preto OLED" — abaixo disso vira preto-puro visualmente.

### Passo 3 — Adicionar o bloco CSS

Em [src/app/globals.css](../../src/app/globals.css), depois dos blocos existentes:

```css
.dark[data-theme="<id>"] {
  --background: oklch(L 0 0);
  --card: oklch(L 0 0);
  --popover: oklch(L 0 0);
  --secondary: oklch(L 0 0);
  --muted: oklch(L 0 0);
  --accent: oklch(L 0 0);
  --border: oklch(1 0 0 / N%);
  --input: oklch(1 0 0 / N%);
  --sidebar: oklch(L 0 0);
  --sidebar-accent: oklch(L 0 0);
}
```

**Só inclua tokens que difiram do default `.dark`** — qualquer um omitido herda do bloco `.dark` (que carrega os valores de `charcoal`).

### Passo 4 — Registrar em `themes.ts`

Em [src/lib/theme/themes.ts](../../src/lib/theme/themes.ts):

```ts
export const THEMES = [
  { id: "charcoal", name: "Charcoal", description: "…", swatches: ["#1D1D1D", "#252525", "#343434"] },
  { id: "oled", name: "OLED Black", description: "…", swatches: ["#131313", "#121212", "#2F2F2F"] },
  // ↓ novo:
  { id: "<id>", name: "<Nome>", description: "<descrição curta>", swatches: ["#sidebar", "#bg", "#card"] },
] as const satisfies readonly Theme[];
```

**Swatches** = 3 hex aproximados de `--sidebar`, `--background`, `--card`. Servem só pro preview no `/settings`. Converter oklch→hex: use [oklch.com](https://oklch.com) ou o devtools do navegador. Não precisa ser perfeito (é miniatura).

### Passo 5 — Smoke test

```bash
pnpm dev
# abrir /settings → card "Aparência" → clicar no tema novo
# verificar: troca instantânea, persistência em reload, sem console errors
```

Reload — o tema deve continuar selecionado (cookie). Login em outro browser/incógnito — deve voltar pro tema escolhido após `ThemeSyncer` rodar (DB→cookie).

### Passo 6 — Commit

Padrão do repo (ver [feedback_commit_convention.md](../../.claude/projects/-Users-joaomoraes-projetos-ai-dev-Perke-perke-volund/memory/feedback_commit_convention.md)):

```bash
bash scripts/sync-main.sh -m "ZRD-JM-NN: theme — add <nome> theme"
```

Migration: **não precisa** — coluna `Member.theme` é `text` sem CHECK constraint. Ids desconhecidos no DB caem no fallback `charcoal` via `isThemeId()`. Decisão consciente pra desacoplar adição de tema da camada de schema.

---

## 4. Regras invioláveis

1. **Não introduza tokens novos em `[data-theme]`.** Se precisar de um valor que não existe, ele deve nascer em `.dark` (invariante) ou no `:root` (light futuro). Tema só *sobrescreve*, nunca *cria*.
2. **Não toque em `--primary`, `--brand`, `--ring`, `--destructive`.** Esses são da identidade visual; mudá-los por tema quebra o reconhecimento da marca.
3. **Não use `localStorage` pra preferência de tema.** Cookie + DB é o contrato. Romper isso reintroduz FOUC.
4. **Não adicione CHECK constraint em `Member.theme`.** É proposital — desacopla migration de adição de tema.
5. **Mantenha contraste WCAG AA**: texto sobre `--background` ≥ 4.5:1. Quando `--background` muda muito, valide `--foreground` no [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/).

---

## 5. Calibração — exemplo prático (criando "Slate")

Objetivo: tema cinza-azulado, sensação "aço escuro".

**Decisões:**
- Hue: 250 (azul levemente arroxeado).
- Chroma: 0.008 (perceptível como "frio" sem virar tema colorido).
- L mais alto que charcoal (sensação mais "premium hardware"): `bg = 0.155`.

**Bloco CSS:**

```css
.dark[data-theme="slate"] {
  --background: oklch(0.155 0.008 250);
  --card: oklch(0.215 0.008 250);
  --popover: oklch(0.215 0.008 250);
  --secondary: oklch(0.265 0.008 250);
  --muted: oklch(0.255 0.008 250);
  --accent: oklch(0.265 0.008 250);
  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 14%);
  --sidebar: oklch(0.125 0.008 250);
  --sidebar-accent: oklch(0.175 0.008 250);
}
```

**Registry:**

```ts
{ id: "slate", name: "Slate", description: "Cinza-aço frio.", swatches: ["#1E2027", "#252830", "#33363F"] }
```

---

## 6. Anti-patterns

- **Tema com chroma alto no `--background`** (`C > 0.02`): vira "tema colorido", não "tema cinza". Fora do escopo do produto atual.
- **Tokens variáveis com `oklch` muito próximos** (`ΔL < 0.04`): hierarquia visual some, cards "vazam" no background.
- **Mudar `--foreground` sem mudar `--background`**: só causa contraste pior; foreground é função do bg, não do tema.
- **Esquecer `--sidebar-accent`**: hover no sidebar fica invisível se ficar igual ao `--sidebar`.
- **Definir tema só com 1-2 tokens**: aparenta funcionar mas pontos do app puxam tokens não-overridados → mistura visual entre temas.

---

## 7. Futuro

- **Light mode**: bloco `:root[data-theme="<id>"]` (sem `.dark`). Mesmo registry, mesmo cookie. `ThemeProvider` ganha um eixo extra `appearance: 'light' | 'dark' | 'system'`.
- **BYO theme** (usuário define cores): substituir bloco CSS estático por `<style>` injetado em runtime com tokens custom. Registry ganha `kind: 'preset' | 'custom'`. Member ganha coluna `themeCustomTokens jsonb`.
- **Theme preview no /settings**: hoje só swatches; pode evoluir pra mini-render de um card simulado com o tema antes de aplicar.

Esses são caminhos abertos pela arquitetura atual, não compromissos. Refatorar quando o caso de uso aparecer.
