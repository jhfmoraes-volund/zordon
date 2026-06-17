import { SlideCover } from "./slides/01-cover";
import { SlideModelo } from "./slides/02-modelo";
import { SlideMapa } from "./slides/03-mapa";
import { SlideDesignSession } from "./slides/04-design-session";
import { SlideRituais } from "./slides/05-rituais";
import { SlideOps } from "./slides/06-ops";
import { SlideRuntime } from "./slides/07-runtime";
import { SlideMcp } from "./slides/08-mcp";
import { SlideSeguranca } from "./slides/09-seguranca";
import { SlideRoadmap } from "./slides/10-roadmap";
import { SlideFechamento } from "./slides/11-fechamento";

export function ComoFuncionamOsAgentesSlides(): React.ReactNode[] {
  return [
    <SlideCover key="01" />,
    <SlideModelo key="02" />,
    <SlideMapa key="03" />,
    <SlideDesignSession key="04" />,
    <SlideRituais key="05" />,
    <SlideOps key="06" />,
    <SlideRuntime key="07" />,
    <SlideMcp key="08" />,
    <SlideSeguranca key="09" />,
    <SlideRoadmap key="10" />,
    <SlideFechamento key="11" />,
  ];
}
