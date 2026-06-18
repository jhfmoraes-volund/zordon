import { SlideCover } from "./slides/01-cover";
import { SlideCombinado } from "./slides/02-combinado";
import { SlideAnatomia } from "./slides/03-anatomia";
import { SlideDuasFormas } from "./slides/04-duas-formas";
import { SlideAutomacaoSetup } from "./slides/05-automacao-setup";
import { SlideAlimentarGranola } from "./slides/06-alimentar-granola";
import { SlideManual } from "./slides/07-manual";
import { SlidePublicar } from "./slides/08-publicar";
import { SlideChecklist } from "./slides/09-checklist";
import { SlideFechamento } from "./slides/10-fechamento";

export function PmReviewPassoAPassoSlides(): React.ReactNode[] {
  return [
    <SlideCover key="01" />,
    <SlideCombinado key="02" />,
    <SlideAnatomia key="03" />,
    <SlideDuasFormas key="04" />,
    <SlideAutomacaoSetup key="05" />,
    <SlideAlimentarGranola key="06" />,
    <SlideManual key="07" />,
    <SlidePublicar key="08" />,
    <SlideChecklist key="09" />,
    <SlideFechamento key="10" />,
  ];
}
