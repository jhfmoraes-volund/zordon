"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { SECTION_ORDER } from "./constants";
import { DescriptionSection } from "./description";
import { LinksSection } from "./links";
import { SponsorsSection } from "./sponsors";
import { IndicatorsSection } from "./indicators";
import { ObjectivesSection } from "./objectives";
import { EnvironmentsSection } from "./environments";
import { AccessSection } from "./access";
import type { SectionProps, WikiSection } from "./types";

const sectionComponentMap: Record<
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

export function ProjectWiki({ projectId }: { projectId: string }) {
  const [sections, setSections] = useState<WikiSection[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/projects/${projectId}/wiki`)
      .then((r) => r.json())
      .then((data) => {
        setSections(data);
        setLoading(false);
      })
      .catch(() => {
        toast.error("Erro ao carregar wiki");
        setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateSection = useCallback(
    async (sectionKey: string, data: unknown) => {
      const res = await fetch(
        `/api/projects/${projectId}/wiki/${sectionKey}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data }),
        }
      );
      if (!res.ok) throw new Error("Failed to save");
    },
    [projectId]
  );

  if (loading) {
    return (
      <div className="p-6 text-muted-foreground">Carregando wiki...</div>
    );
  }

  // Sort sections by SECTION_ORDER
  const sorted = [...sections].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a.sectionKey);
    const bi = SECTION_ORDER.indexOf(b.sectionKey);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div className="space-y-6">
      {sorted.map((section) => {
        const Component = sectionComponentMap[section.sectionKey];
        if (!Component) return null;
        return (
          <Component
            key={section.id}
            section={section}
            onUpdate={(data: unknown) => updateSection(section.sectionKey, data)}
          />
        );
      })}
    </div>
  );
}
