"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveSheet,
  ResponsiveSheetContent,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
  ResponsiveSheetDescription,
  ResponsiveSheetBody,
} from "@/components/ui/responsive-sheet";
import { AutomationRitualCard } from "@/components/ceremonies/automation-ritual-card";

type Props = {
  projectId: string;
  canConfigure: boolean;
};

/**
 * RitualsSettingsSheet — botão de engrenagem ao lado do "Novo Ritual" que abre
 * um sheet de configurações dos rituais do projeto. Hospeda o card de vínculo
 * de folders do Granola (realocado da aba Settings do projeto).
 */
export function RitualsSettingsSheet({
  projectId,
  canConfigure,
}: Props) {
  const [open, setOpen] = useState(false);

  if (!canConfigure) return null;

  return (
    <ResponsiveSheet open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Configurações dos Rituais"
      >
        <Settings className="size-3.5" />
      </Button>
      <ResponsiveSheetContent size="md">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>Configurações dos Rituais</ResponsiveSheetTitle>
          <ResponsiveSheetDescription>
            Como os rituais deste projeto são alimentados.
          </ResponsiveSheetDescription>
        </ResponsiveSheetHeader>
        <ResponsiveSheetBody className="space-y-4">
          {/* Um card por tipo de ritual. PoC: PM Review. */}
          <AutomationRitualCard
            ritualType="pm_review"
            projectId={projectId}
          />
        </ResponsiveSheetBody>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
