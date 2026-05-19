import { Slide01Cover } from "./slides/01-cover";
import { Slide02Overview } from "./slides/02-overview";
import { Slide03Torres } from "./slides/03-torres";
import { Slide04ImersaoDivider } from "./slides/04-imersao-divider";
import { Slide05ImersaoDetail } from "./slides/05-imersao-detail";
import { Slide06OpsDivider } from "./slides/06-ops-divider";
import { Slide07OpsDetail } from "./slides/07-ops-detail";
import { Slide08Forge } from "./slides/08-forge";
import { Slide09PosOpsDivider } from "./slides/09-posops-divider";
import { Slide10PosOpsDetail } from "./slides/10-posops-detail";

export function OperacaoVolundSlides(): React.ReactNode[] {
  return [
    <Slide01Cover key="01" />,
    <Slide02Overview key="02" />,
    <Slide03Torres key="03" />,
    <Slide04ImersaoDivider key="04" />,
    <Slide05ImersaoDetail key="05" />,
    <Slide06OpsDivider key="06" />,
    <Slide07OpsDetail key="07" />,
    <Slide08Forge key="08" />,
    <Slide09PosOpsDivider key="09" />,
    <Slide10PosOpsDetail key="10" />,
  ];
}
