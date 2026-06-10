export type WikiSection = {
  id: string;
  projectId: string;
  sectionKey: string;
  title: string;
  data: unknown;
  order: number;
};

export type SponsorItem = { name: string; role: string; contact: string };
export type LinkItem = { label: string; url: string; category: string };
export type IndicatorItem = {
  indicator: string;
  target: string;
  current: string;
  status: string;
};
export type ObjectiveItem = { objective: string; description: string };
export type EnvironmentItem = {
  name: string;
  url: string;
  type: string;
  notes: string;
};
export type AccessItem = {
  service: string;
  url: string;
  credentials_hint: string;
  notes: string;
};

export type SectionProps = {
  section: WikiSection;
  onUpdate: (data: unknown) => Promise<void>;
};
