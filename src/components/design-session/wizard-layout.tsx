"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ConversationFab,
  ConversationPanel,
} from "@/components/ui/conversation";
import { ArrowLeft, BookOpen } from "lucide-react";
import type { StepDef } from "@/lib/design-session-steps";
import { useDesignSessionChat } from "@/hooks/use-design-session-chat";
import { useIsMobile } from "@/hooks/use-mobile";
import { StickyNoteBoard } from "./sticky-note";
import { useStepNotes } from "@/hooks/design-session/use-step-notes";
import { isStepKey, type StepKey } from "@/lib/design-session/types";
import {
  DSRibbon,
  StepSubHeader,
  StepActionsProvider,
  StepActionsSlot,
} from "./ribbon";

export function WizardLayout({
  sessionId,
  sessionTitle,
  sessionType,
  steps,
  currentStep,
  onNext,
  onPrevious,
  onStepClick,
  hideSidePanels,
  backHref,
  memoriaHref,
  children,
}: {
  sessionId: string;
  sessionTitle: string;
  sessionType: string;
  steps: StepDef[];
  currentStep: number;
  onNext: () => void;
  onPrevious: () => void;
  onStepClick: (index: number) => void;
  hideSidePanels?: boolean;
  backHref?: string;
  memoriaHref?: string;
  children: React.ReactNode;
}) {
  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  const chat = useDesignSessionChat();
  const isMobile = useIsMobile();
  const chatStreaming =
    chat.status === "streaming" || chat.status === "submitted";

  const stepBadge = step?.title ? (
    <Badge variant="secondary" className="text-xs">
      {step.title}
    </Badge>
  ) : null;

  const sharedChatProps = {
    agent: "vitor" as const,
    messages: chat.messages,
    status: chat.status,
    input: chat.input,
    onInputChange: chat.setInput,
    onSubmit: () => chat.sendMessage(chat.input),
    onStop: chat.stop,
    planMode: chat.planMode,
    onPlanModeChange: chat.setPlanMode,
    onExecutePlan: () => chat.sendMessage("vai"),
    headerSlot: stepBadge,
    fallbackActive: chat.isFallback,
  };

  const ribbonLeft = backHref ? (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 shrink-0"
      nativeButton={false}
      render={<Link href={backHref} aria-label="Voltar para o projeto" />}
    >
      <ArrowLeft className="h-4 w-4" />
    </Button>
  ) : null;

  const ribbonRight = memoriaHref ? (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 px-2 sm:px-2.5"
      nativeButton={false}
      render={<Link href={memoriaHref} aria-label="Ver memória do Vitor" />}
    >
      <BookOpen className="h-4 w-4 sm:mr-1" />
      <span className="hidden sm:inline">Memória</span>
    </Button>
  ) : null;

  return (
    <StepActionsProvider>
      <div
        className="flex flex-col h-full min-h-0"
        aria-label={`Design Session: ${sessionTitle}`}
        data-session-type={sessionType}
      >
        <DSRibbon
          steps={steps}
          currentStep={currentStep}
          onStepClick={onStepClick}
          leftSlot={ribbonLeft}
          rightSlot={ribbonRight}
        />

        {step ? (
          <StepSubHeader
            step={step}
            totalSteps={steps.length}
            onPrevious={onPrevious}
            onNext={onNext}
            isFirst={isFirst}
            isLast={isLast}
            actions={<StepActionsSlot className="contents" />}
          />
        ) : null}

        <div className={`flex-1 p-6 ${chat.isOpen ? "overflow-hidden" : "overflow-auto"}`}>
          <div className="flex gap-6 h-full">
            <main className={`flex-1 min-w-0 ${chat.isOpen ? "overflow-y-auto" : ""}`}>{children}</main>
            {!hideSidePanels && (
              chat.isOpen && !isMobile ? (
                <aside className="hidden lg:flex shrink-0 w-[420px] h-full">
                  <ConversationPanel
                    {...sharedChatProps}
                    variant="desktop"
                    onClose={chat.close}
                  />
                </aside>
              ) : (
                <aside className="hidden lg:block shrink-0">
                  {step && isStepKey(step.key) ? (
                    <StepNotesPanel sessionId={sessionId} stepKey={step.key} />
                  ) : null}
                </aside>
              )
            )}
          </div>
        </div>

        {!hideSidePanels && (
          <>
            <ConversationFab
              agent="vitor"
              isOpen={chat.isOpen}
              isStreaming={chatStreaming}
              onClick={chat.toggle}
            />
            {isMobile && (
              <ConversationPanel
                {...sharedChatProps}
                variant="mobile"
                isOpen={chat.isOpen}
                onOpenChange={(open) => {
                  if (open !== chat.isOpen) chat.toggle();
                }}
                onClose={chat.close}
              />
            )}
          </>
        )}
      </div>
    </StepActionsProvider>
  );
}

function StepNotesPanel({
  sessionId,
  stepKey,
}: {
  sessionId: string;
  stepKey: StepKey;
}) {
  const { notes, addNote, updateNote, deleteNote } = useStepNotes(sessionId, stepKey);
  return (
    <StickyNoteBoard
      notes={notes}
      onAdd={addNote}
      onUpdate={updateNote}
      onDelete={deleteNote}
    />
  );
}
