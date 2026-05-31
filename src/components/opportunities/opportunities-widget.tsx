"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { OpportunityTable } from "./opportunity-table";
import { OpportunitySheet } from "./opportunity-sheet";
import { Button } from "@/components/ui/button";
import { useOpportunities } from "@/hooks/use-opportunities";
import { useAuth } from "@/contexts/auth-context";
import type { OpportunityRow } from "@/lib/dal/opportunities";

export type OpportunitiesWidgetProps = {
  clientId: string;
  initialOpportunities: OpportunityRow[];
};

export function OpportunitiesWidget({
  clientId,
  initialOpportunities,
}: OpportunitiesWidgetProps) {
  const { member } = useAuth();
  const {
    opportunities,
    create,
    patch,
    promote,
  } = useOpportunities(clientId, initialOpportunities);

  const [selectedOpportunity, setSelectedOpportunity] = useState<OpportunityRow | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  function handleCardClick(opportunity: OpportunityRow) {
    setSelectedOpportunity(opportunity);
  }

  function handleNewOpportunity() {
    setIsCreating(true);
    setSelectedOpportunity({
      id: "",
      clientId,
      title: "",
      description: null,
      impact: 3,
      effort: 3,
      status: "discovery",
      priorityRank: null,
      sourceMeetingId: null,
      sourceDesignSessionId: null,
      sourceTranscriptRefId: null,
      promotedProjectId: null,
      createdBy: member?.id ?? "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  function handleCloseSheet() {
    setSelectedOpportunity(null);
    setIsCreating(false);
  }

  async function handleSaveOpportunity(updated: Partial<OpportunityRow>) {
    if (isCreating) {
      // Create mode
      if (!member?.id) {
        console.error("No member ID for create");
        return;
      }
      await create({
        title: updated.title ?? "",
        description: updated.description ?? null,
        impact: updated.impact ?? 3,
        effort: updated.effort ?? 3,
        status: updated.status ?? "discovery",
        createdBy: member.id,
      });
    } else if (selectedOpportunity?.id) {
      // Edit mode
      await patch(selectedOpportunity.id, updated);
    }
  }

  async function handlePromoteById(opportunityId: string, projectName?: string) {
    const result = await promote(opportunityId, projectName);
    if (result) {
      // Navigate to the new design session
      window.location.href = `/design-sessions/${result.designSessionId}`;
    }
  }

  function handlePromoteFromList(opportunity: OpportunityRow) {
    void handlePromoteById(opportunity.id, opportunity.title);
  }

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          Oportunidades
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {opportunities.length}
          </span>
        </h2>
        <Button size="sm" onClick={handleNewOpportunity}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Nova oportunidade
        </Button>
      </div>

      <OpportunityTable
        opportunities={opportunities}
        onRowClick={handleCardClick}
        onPromote={handlePromoteFromList}
      />

      {/* Edit/Create sheet */}
      <OpportunitySheet
        opportunity={selectedOpportunity}
        onClose={handleCloseSheet}
        onSave={handleSaveOpportunity}
        onPromote={handlePromoteById}
      />
    </section>
  );
}
