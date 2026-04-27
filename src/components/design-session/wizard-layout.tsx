"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ArrowLeft, ChevronLeft, ChevronRight, Menu, Check, Circle, Loader2, BookOpen } from "lucide-react";
import type { StepDef } from "@/lib/design-session-steps";
import { StickyNoteBoard, type Note } from "./sticky-note";
import { AIChatBubble } from "./ai-chat-bubble";
import { AIChatMobileSheet, AIChatDesktopPanel } from "./ai-chat-panel";
import { useDesignSessionChat } from "@/hooks/use-design-session-chat";

export function WizardLayout({
  sessionTitle,
  sessionType,
  steps,
  currentStep,
  onNext,
  onPrevious,
  onStepClick,
  saving,
  notes,
  onAddNote,
  onUpdateNote,
  onDeleteNote,
  hideSidePanels,
  backHref,
  memoriaHref,
  children,
}: {
  sessionTitle: string;
  sessionType: string;
  steps: StepDef[];
  currentStep: number;
  onNext: () => void;
  onPrevious: () => void;
  onStepClick: (index: number) => void;
  saving?: boolean;
  notes: Note[];
  onAddNote: () => void;
  onUpdateNote: (id: string, text: string) => void;
  onDeleteNote: (id: string) => void;
  hideSidePanels?: boolean;
  backHref?: string;
  memoriaHref?: string;
  children: React.ReactNode;
}) {
  const step = steps[currentStep];
  const progress = ((currentStep + 1) / steps.length) * 100;
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  const typeLabel =
    sessionType === "inception" ? "Inception" : "Continuous Improvement";

  const chat = useDesignSessionChat();
  const chatLoading = chat.status === "streaming" || chat.status === "submitted";
  const chatProps = {
    messages: chat.messages,
    input: chat.input,
    isLoading: chatLoading,
    currentStepTitle: step?.title ?? "",
    onInputChange: chat.setInput,
    onSubmit: (e: React.FormEvent) => {
      e.preventDefault();
      chat.sendMessage(chat.input);
    },
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="border-b bg-background px-3 sm:px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 sm:gap-3 min-w-0 flex-1">
            {backHref && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                nativeButton={false}
                render={<Link href={backHref} aria-label="Voltar para o projeto" />}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <Sheet>
              <SheetTrigger render={<Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" />}>
                <Menu className="h-4 w-4" />
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-0">
                <div className="p-4 border-b">
                  <p className="font-semibold">{sessionTitle}</p>
                  <Badge variant="outline" className="mt-1">{typeLabel}</Badge>
                </div>
                <nav className="p-2">
                  {steps.map((s) => (
                    <button
                      key={s.index}
                      onClick={() => onStepClick(s.index)}
                      className={`flex items-center gap-3 w-full rounded-md px-3 py-2.5 text-left text-sm transition-colors ${
                        s.index === currentStep
                          ? "bg-primary/10 text-primary font-medium"
                          : "hover:bg-muted"
                      }`}
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border text-xs">
                        {s.index < currentStep ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : s.index === currentStep ? (
                          <Circle className="h-3 w-3 fill-primary text-primary" />
                        ) : (
                          <span className="text-muted-foreground">{s.index + 1}</span>
                        )}
                      </span>
                      <div>
                        <p className="leading-tight">{s.title}</p>
                        <p className="text-xs text-muted-foreground">{s.description}</p>
                      </div>
                    </button>
                  ))}
                </nav>
              </SheetContent>
            </Sheet>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-lg font-semibold truncate">{step?.title}</h1>
                <Badge variant="secondary" className="text-xs shrink-0">
                  {currentStep + 1}/{steps.length}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate hidden sm:block">{step?.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {memoriaHref && (
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
            )}
            {saving !== undefined && (
              <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1">
                {saving ? (
                  <><Loader2 className="h-3 w-3 animate-spin" /> Salvando...</>
                ) : (
                  "Salvo"
                )}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onPrevious}
              disabled={isFirst}
              aria-label="Anterior"
              className="px-2 sm:px-2.5"
            >
              <ChevronLeft className="h-4 w-4 sm:mr-1" />
              <span className="hidden sm:inline">Anterior</span>
            </Button>
            <Button
              size="sm"
              onClick={onNext}
              aria-label={isLast ? "Revisar tasks" : "Proximo"}
              className="px-2 sm:px-2.5"
            >
              <span className="hidden sm:inline">{isLast ? "Revisar tasks" : "Proximo"}</span>
              <ChevronRight className="h-4 w-4 sm:ml-1" />
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-1 w-full rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 p-6 ${chat.isOpen ? "overflow-hidden" : "overflow-auto"}`}>
        <div className="flex gap-6 h-full">
          <main className={`flex-1 min-w-0 ${chat.isOpen ? "overflow-y-auto" : ""}`}>{children}</main>
          {!hideSidePanels && (
            chat.isOpen ? (
              <aside className="hidden lg:flex shrink-0 w-[420px] h-full">
                <AIChatDesktopPanel {...chatProps} onClose={chat.close} />
              </aside>
            ) : (
              <aside className="hidden lg:block shrink-0">
                <StickyNoteBoard
                  notes={notes}
                  onAdd={onAddNote}
                  onUpdate={onUpdateNote}
                  onDelete={onDeleteNote}
                />
              </aside>
            )
          )}
        </div>
      </div>

      {/* AI Chat */}
      {!hideSidePanels && (
        <>
          <AIChatBubble
            isOpen={chat.isOpen}
            isStreaming={chat.status === "streaming"}
            onToggle={chat.toggle}
          />
          <AIChatMobileSheet
            {...chatProps}
            isOpen={chat.isOpen}
            onOpenChange={(open) => {
              if (open !== chat.isOpen) chat.toggle();
            }}
          />
        </>
      )}
    </div>
  );
}
