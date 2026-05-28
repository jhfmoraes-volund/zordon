import { cn } from "@/lib/utils";

/**
 * Centraliza o conteúdo da página numa coluna de largura máxima fixa —
 * padrão Linear/Cursor/Supabase. O shell do dashboard ([dashboard]/layout.tsx)
 * deixa o <main> "neutro" (sem limite de largura); cada page que é
 * lista/form/settings envolve seu conteúdo em <PageContainer> pra não esticar
 * em monitores wide.
 *
 * Páginas full-bleed (kanban com várias colunas, wizard com canvas próprio,
 * deck de slides) NÃO usam este wrapper — renderizam direto e ocupam toda a
 * largura do <main>. Casos atuais: projects/[id], squads/[id],
 * design-sessions/[id]/steps/[step], ops, workflow/[slug].
 *
 * O 1280px (`size="default"`) bate com o teto canônico já usado no
 * BoardLayout das design sessions (cols triple/quad), mantendo consistência
 * com o resto do app. `size="narrow"` (760px) serve pra páginas tipo form
 * estreito (settings, profile, perfil de cliente).
 */
const SIZES = {
  narrow: "max-w-[760px]",
  default: "max-w-[1280px]",
} as const;

export type PageContainerSize = keyof typeof SIZES;

export function PageContainer({
  size = "default",
  className,
  children,
}: {
  size?: PageContainerSize;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full", SIZES[size], className)}>
      {children}
    </div>
  );
}
