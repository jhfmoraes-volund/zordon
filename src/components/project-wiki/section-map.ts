import { DescriptionSection } from "./description";
import { LinksSection } from "./links";
import { SponsorsSection } from "./sponsors";
import { IndicatorsSection } from "./indicators";
import { ObjectivesSection } from "./objectives";
import { EnvironmentsSection } from "./environments";
import { AccessSection } from "./access";
import type { SectionProps } from "./types";

export const sectionComponentMap: Record<
  string,
  React.ComponentType<SectionProps>
> = {
  description: DescriptionSection,
  links: LinksSection,
  sponsors: SponsorsSection,
  success_indicators: IndicatorsSection,
  objectives: ObjectivesSection,
  environments: EnvironmentsSection,
  access: AccessSection,
};
