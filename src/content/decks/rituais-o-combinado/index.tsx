import { SlideCover } from "./slides/01-cover";
import { SlidePorque } from "./slides/02-porque";
import { SlidePacto } from "./slides/03-pacto";
import { SlideRituais } from "./slides/04-rituais";
import { SlideSprintPlanning } from "./slides/05-sprint-planning";
import { SlidePmReview } from "./slides/06-pm-review";
import { SlideReleasePlanning } from "./slides/07-release-planning";
import { SlideQuemFaz } from "./slides/08-quem-faz";
import { SlideComoAlimentar } from "./slides/09-como-alimentar";
import { SlideFechamento } from "./slides/10-fechamento";

export function RituaisCombinadoSlides(): React.ReactNode[] {
  return [
    <SlideCover key="01" />,
    <SlidePorque key="02" />,
    <SlidePacto key="03" />,
    <SlideRituais key="04" />,
    <SlideSprintPlanning key="05" />,
    <SlidePmReview key="06" />,
    <SlideReleasePlanning key="07" />,
    <SlideQuemFaz key="08" />,
    <SlideComoAlimentar key="09" />,
    <SlideFechamento key="10" />,
  ];
}
