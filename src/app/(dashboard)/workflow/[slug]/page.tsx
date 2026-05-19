import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DeckStage } from "@/components/deck/deck-stage";
import { getDeck } from "@/content/decks/registry";
import { OperacaoVolundSlides } from "@/content/decks/operacao-volund";

const DECK_SLIDES: Record<string, () => React.ReactNode[]> = {
  "operacao-volund": OperacaoVolundSlides,
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

  const slides = slidesFactory();

  return (
    <Suspense fallback={null}>
      <DeckStage exitHref="/workflow">{slides}</DeckStage>
    </Suspense>
  );
}
