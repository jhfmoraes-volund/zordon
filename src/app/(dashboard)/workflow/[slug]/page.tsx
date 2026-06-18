import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DeckStage } from "@/components/deck/deck-stage";
import { getDeck } from "@/content/decks/registry";
import { OperacaoVolundSlides } from "@/content/decks/operacao-volund";
import { RituaisCombinadoSlides } from "@/content/decks/rituais-o-combinado";
import { ComoFuncionamOsAgentesSlides } from "@/content/decks/como-funcionam-os-agentes";
import { PmReviewPassoAPassoSlides } from "@/content/decks/pm-review-passo-a-passo";
import { getAccessLevel } from "@/lib/dal";
import { hasMinAccessLevel } from "@/lib/roles";

const DECK_SLIDES: Record<string, () => React.ReactNode[]> = {
  "operacao-volund": OperacaoVolundSlides,
  "rituais-o-combinado": RituaisCombinadoSlides,
  "como-funcionam-os-agentes": ComoFuncionamOsAgentesSlides,
  "pm-review-passo-a-passo": PmReviewPassoAPassoSlides,
};

export default async function DeckPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const meta = getDeck(slug);
  const slidesFactory = DECK_SLIDES[slug];

  if (!meta || !slidesFactory) {
    notFound();
  }

  // Gated decks (e.g. PM & Admin playbooks) are invisible to lower levels —
  // mirror the library filter so deep-linking can't bypass it.
  if (meta.minAccessLevel) {
    const accessLevel = await getAccessLevel();
    if (!hasMinAccessLevel(accessLevel, meta.minAccessLevel)) {
      notFound();
    }
  }

  const slides = slidesFactory();

  return (
    <Suspense fallback={null}>
      <DeckStage exitHref="/workflow">{slides}</DeckStage>
    </Suspense>
  );
}
