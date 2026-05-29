/**
 * Theme registry.
 *
 * Cada tema = um bloco `.dark[data-theme="<id>"]` em src/app/globals.css.
 * Adicionar tema novo: (1) bloco CSS, (2) entrada aqui. Nada mais.
 *
 * `swatches` alimenta o preview visual no /settings (hex aproximado dos
 * tokens --sidebar / --background / --card pra cada tema).
 */

export const THEME_STORAGE_KEY = "volund.theme";

export type Theme = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly swatches: readonly [string, string, string];
};

export const THEMES = [
  {
    id: "charcoal",
    name: "Charcoal",
    description: "Grafite premium — equilíbrio entre escuro e legível.",
    swatches: ["#1D1D1D", "#252525", "#343434"],
  },
  {
    id: "oled",
    name: "OLED Black",
    description: "Preto absoluto — máximo contraste, ideal pra OLED.",
    swatches: ["#131313", "#121212", "#2F2F2F"],
  },
] as const satisfies readonly Theme[];

export type ThemeId = (typeof THEMES)[number]["id"];

export const DEFAULT_THEME_ID: ThemeId = "charcoal";

const THEME_IDS = THEMES.map((t) => t.id) as readonly ThemeId[];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

export function getTheme(id: ThemeId): (typeof THEMES)[number] {
  const found = THEMES.find((t) => t.id === id);
  return found ?? THEMES[0];
}
