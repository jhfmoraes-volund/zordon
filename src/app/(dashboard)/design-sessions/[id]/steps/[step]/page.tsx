"use client";

import { use, useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { PageTitle } from "@/components/app-shell";
import { WizardLayout } from "@/components/design-session/wizard-layout";
import { PersonaJourneyBoard, Persona } from "@/components/design-session/persona-journey-board";
import { SolutionCardBoard } from "@/components/design-session/solution-card-board";
import { HypothesisBoard } from "@/components/design-session/hypothesis-board";
import { PriorityBoard } from "@/components/design-session/priority-board";
import { PostItBoard, PostItSection } from "@/components/design-session/post-it-board";
import { RiskGapBoard } from "@/components/design-session/risk-gap-board";
import { BoardLayout, BoardSection, StepHeader } from "@/components/design-session/board";
import { PreWorkStep } from "@/components/design-session/pre-work-step";
import { BriefingTaskChat } from "@/components/design-session/briefing-task-chat";
import { PrdBriefingStep } from "@/components/sessions/prd-session/prd-briefing-step";
import {
  DesignSessionTree,
  type TreeAction,
} from "@/components/design-session/design-session-tree";
import { BriefingRibbon } from "@/components/design-session/briefing-ribbon";
import { StorySheetByRef } from "@/components/story-sheet-by-ref";
import { TaskSheetByRef } from "@/components/task-sheet-by-ref";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Trash2,
  Target,
  Sparkles,
  Cpu,
  PlugZap,
  ShieldAlert,
  Gauge,
} from "lucide-react";
import { getStepsForSession, StepDef } from "@/lib/design-session-steps";
import { DesignSessionProvider } from "@/contexts/design-session-context";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import { genId } from "@/lib/utils";
import { useHypotheses } from "@/hooks/design-session/use-hypotheses";
import { useProductVision } from "@/hooks/design-session/use-product-vision";
import { useScope, type ScopeBucket } from "@/hooks/design-session/use-scope";
import { useRisksGaps } from "@/hooks/design-session/use-risks-gaps";
import { usePersonas } from "@/hooks/design-session/use-personas";
import { useTechnicalSpecs } from "@/hooks/design-session/use-technical-specs";
import { useBrainstormFeatures } from "@/hooks/design-session/use-brainstorm-features";
import { usePriorityItems } from "@/hooks/design-session/use-priority-items";

type Session = {
  id: string;
  title: string;
  type: string;
  status: string;
  currentStep: number;
  projectId: string;
  project: { name: string };
  selectedSteps: string[] | null;
};

// Espelha TYPE_LABELS de session-detail-sheet.tsx — mantém o rótulo do tipo
// consistente entre o sheet do projeto e o header do wizard.
const TYPE_LABELS: Record<string, string> = {
  inception: "Inception",
  continuous_improvement: "Melhoria contínua",
  super: "Inception",
};

export default function StepPage({
  params,
}: {
  params: Promise<{ id: string; step: string }>;
}) {
  const { id, step: stepStr } = use(params);
  const stepIndex = parseInt(stepStr);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);

  const steps = session ? getStepsForSession(session) : [];
  const currentStepDef = steps[stepIndex] as StepDef | undefined;

  // Load session
  useEffect(() => {
    fetch(`/api/design-sessions/${id}`)
      .then((r) => r.json())
      .then(setSession);
  }, [id]);

  const navigate = (targetStep: number) => {
    // Só promove draft → in_progress no primeiro toque. Nunca toca em
    // `completed` — isso é território exclusivo de /complete e /reopen, que
    // fazem cascata. Sobrescrever aqui derruba a invariante "stories só
    // aparecem se DS.status=completed" e some com elas do projeto.
    const body: Record<string, unknown> = { currentStep: targetStep };
    if (session?.status === "draft") body.status = "in_progress";
    fetchOrThrow(`/api/design-sessions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch((e) =>
      showErrorToast(e, { label: "Falha ao salvar progresso de step" }),
    );
    router.push(`/design-sessions/${id}/steps/${targetStep}`);
  };

  if (!session || !currentStepDef) {
    return <div className="p-6 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="-mx-3 -my-4 h-[calc(100svh-3rem)] overflow-hidden sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6">
    <PageTitle
      title={session.title}
      subtitle={`${session.project.name} · ${TYPE_LABELS[session.type] ?? session.type}`}
      backHref={`/projects/${session.projectId}?tab=apps&app=sessions`}
    />
    <DesignSessionProvider
      sessionId={id}
      sessionTitle={session.title}
      sessionType={session.type}
      currentStepKey={currentStepDef.key}
      currentStepIndex={stepIndex}
    >
      <WizardLayout
        sessionId={id}
        sessionTitle={session.title}
        sessionType={session.type}
        steps={steps}
        currentStep={stepIndex}
        onNext={() => {
          // No último step (briefing) o WizardLayout esconde o botão — governance
          // acontece in-place via SessionGovernanceBar.
          if (stepIndex < steps.length - 1) navigate(stepIndex + 1);
        }}
        onPrevious={() => stepIndex > 0 && navigate(stepIndex - 1)}
        onStepClick={navigate}
        hideSidePanels={currentStepDef.key === "pre_work" || currentStepDef.key === "briefing" || currentStepDef.key === "prd_briefing"}
        backHref={`/projects/${session.projectId}?tab=apps&app=sessions`}
        memoriaHref={`/design-sessions/${id}/memoria`}
      >
        <StepContent stepKey={currentStepDef.key} sessionId={id} projectId={session.projectId} sessionType={session.type} />
      </WizardLayout>
    </DesignSessionProvider>
    </div>
  );
}

// ─── Step Content Router ──────────────────────────────────

function StepContent({
  stepKey,
  sessionId,
  projectId,
  sessionType,
}: {
  stepKey: string;
  sessionId: string;
  projectId: string;
  sessionType: string;
}) {
  switch (stepKey) {
    case "pre_work":
      return <PreWorkStep sessionId={sessionId} projectId={projectId} />;
    case "product_vision":
      return <ProductVisionStep sessionId={sessionId} />;
    case "scope_definition":
      return <ScopeDefinitionStep sessionId={sessionId} />;
    case "personas_journeys":
      return <PersonasJourneysStep sessionId={sessionId} />;
    case "brainstorm":
      return <BrainstormStep sessionId={sessionId} />;
    case "risks_gaps":
      return <RisksGapsStep sessionId={sessionId} />;
    case "prioritization":
      return <PrioritizationStep sessionId={sessionId} />;
    case "technical_specs":
      return <TechnicalSpecsStep sessionId={sessionId} />;
    case "hypotheses":
      return <HypothesesStep sessionId={sessionId} />;
    case "briefing":
      // Vitor (inception/super) agora termina sempre no PRD Tree, não na
      // árvore Module→Story→Task (deprecated p/ Vitor). BriefingStep (árvore
      // de Story) segue p/ CI e demais usos.
      if (sessionType === "inception" || sessionType === "super") {
        return <PrdBriefingStep sessionId={sessionId} projectId={projectId} />;
      }
      return <BriefingStep sessionId={sessionId} />;
    case "prd_briefing":
      return <PrdBriefingStep sessionId={sessionId} projectId={projectId} />;
    // CI steps
    case "retrospective":
    case "new_demands":
    case "refinement":
      return (
        <div className="text-center text-muted-foreground py-12">
          Step &quot;{stepKey}&quot; sera implementado na proxima fase.
        </div>
      );
    default:
      return (
        <div className="text-center text-muted-foreground py-12">
          Step &quot;{stepKey}&quot; nao reconhecido.
        </div>
      );
  }
}

// ─── Step 0: Visao do Produto ─────────────────────────────

function ProductVisionStep({ sessionId }: { sessionId: string }) {
  const { value, loaded, updateField } = useProductVision(sessionId);

  if (!loaded) {
    return <div className="text-sm text-muted-foreground">Carregando visão de produto...</div>;
  }

  return (
    <div className="space-y-4">
      <StepHeader cols="single" description="Antes de tudo, alinhe o problema, quem sofre com ele e o que muda quando o produto existe. Frases curtas, decisões compartilhadas." />
      <BoardLayout cols="single" stack gap={4}>
      <BoardSection
        accent="rose"
        icon={<Target className="size-4" />}
        title="O Problema"
        subtitle="Por que este produto precisa existir? Qual problema resolve?"
        bodyClassName="space-y-4"
      >
        <div className="grid gap-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Qual o problema central?
          </Label>
          <Textarea
            placeholder="Descreva o problema que este produto resolve..."
            value={value.problem}
            onChange={(e) => updateField("problem", e.target.value)}
            rows={3}
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Quem sofre com esse problema?
          </Label>
          <Textarea
            placeholder="Ex: Gestores de vendas em empresas B2B de medio porte"
            value={value.whoSuffers}
            onChange={(e) => updateField("whoSuffers", e.target.value)}
            rows={2}
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            O que acontece se nao resolver?
          </Label>
          <Textarea
            placeholder="Consequencias de manter o status quo..."
            value={value.consequences}
            onChange={(e) => updateField("consequences", e.target.value)}
            rows={2}
          />
        </div>
      </BoardSection>

      <BoardSection
        accent="emerald"
        icon={<Sparkles className="size-4" />}
        title="Visao de Sucesso"
        subtitle="Como o mundo fica depois? Qual o cenario ideal?"
        bodyClassName="space-y-4"
      >
        <div className="grid gap-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Como e o sucesso?
          </Label>
          <Textarea
            placeholder="Descreva o cenario ideal quando o produto estiver funcionando..."
            value={value.successVision}
            onChange={(e) => updateField("successVision", e.target.value)}
            rows={3}
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Metricas de impacto
          </Label>
          <Textarea
            placeholder="Como vamos medir que deu certo? Ex: reducao de 50% no tempo de resposta a leads"
            value={value.impactMetrics}
            onChange={(e) => updateField("impactMetrics", e.target.value)}
            rows={2}
          />
        </div>
      </BoardSection>
      </BoardLayout>
    </div>
  );
}

// ─── Step: E / Nao E / Faz / Nao Faz ──────────────────────

const SCOPE_BUCKETS = [
  { key: "inScope", title: "É", tone: "emerald" },
  { key: "outOfScope", title: "NÃO É", tone: "rose" },
  { key: "does", title: "FAZ", tone: "sky" },
  { key: "doesNot", title: "NÃO FAZ", tone: "amber" },
] as const;

function ScopeDefinitionStep({ sessionId }: { sessionId: string }) {
  const { value, loaded, addItem, updateItem, deleteItem } = useScope(sessionId);

  if (!loaded) {
    return <div className="text-sm text-muted-foreground">Carregando escopo...</div>;
  }

  const sections: PostItSection[] = SCOPE_BUCKETS.map((b) => ({
    key: b.key,
    title: b.title,
    tone: b.tone,
    items: value[b.key],
  }));

  return (
    <div className="space-y-4">
      <StepHeader
        cols="double"
        description="Alinhe identidade e fronteiras do produto antes de explorar personas. Items curtos e afirmativos."
        legend={[
          { label: "É", accent: "emerald", hint: "o que o produto é em essência (categoria, posicionamento)" },
          { label: "NÃO É", accent: "rose", hint: "mal-entendidos a evitar (com o que costumam confundir)" },
          { label: "FAZ", accent: "sky", hint: "capacidades concretas que vai entregar" },
          { label: "NÃO FAZ", accent: "amber", hint: "fronteiras explícitas, protege contra scope creep" },
        ]}
      />
      <PostItBoard
        sections={sections}
        columns={2}
        onAdd={(sectionKey, text) =>
          addItem(sectionKey as ScopeBucket, { id: genId(), text })
        }
        onUpdate={(sectionKey, itemId, text) =>
          updateItem(sectionKey as ScopeBucket, itemId, text)
        }
        onDelete={(sectionKey, itemId) =>
          deleteItem(sectionKey as ScopeBucket, itemId)
        }
      />
    </div>
  );
}

// ─── Step 1: Personas & Jornadas ──────────────────────────

function PersonasJourneysStep({ sessionId }: { sessionId: string }) {
  const { personas, loaded, addPersona, updatePersona, deletePersona } =
    usePersonas(sessionId);

  if (!loaded) {
    return <div className="text-sm text-muted-foreground">Carregando personas...</div>;
  }

  // Map row → Persona shape used by the board.
  const boardPersonas: Persona[] = personas.map((p) => ({
    id: p.id,
    name: p.name,
    role: p.role,
    context: p.context,
    asIsSteps: p.asIsSteps,
    toBeSteps: p.toBeSteps,
  }));

  return (
    <div className="space-y-4">
      <StepHeader cols="double" description="Defina as personas que sofrem com o problema. Para cada uma, mapeie a jornada atual (AS-IS) e a jornada futura (TO-BE)." />
      <PersonaJourneyBoard
        personas={boardPersonas}
        onAdd={(persona) =>
          addPersona({
            name: persona.name,
            role: persona.role,
            context: persona.context,
            asIsSteps: persona.asIsSteps,
            toBeSteps: persona.toBeSteps,
          })
        }
        onUpdate={(personaId, updates) =>
          updatePersona(personaId, {
            ...(updates.name !== undefined && { name: updates.name }),
            ...(updates.role !== undefined && { role: updates.role }),
            ...(updates.context !== undefined && { context: updates.context }),
            ...(updates.asIsSteps !== undefined && { asIsSteps: updates.asIsSteps }),
            ...(updates.toBeSteps !== undefined && { toBeSteps: updates.toBeSteps }),
          })
        }
        onDelete={(personaId) => deletePersona(personaId)}
        onAddJourneyStep={(personaId, type, step) => {
          const p = personas.find((x) => x.id === personaId);
          if (!p) return;
          const key = type === "asIs" ? "asIsSteps" : "toBeSteps";
          updatePersona(personaId, { [key]: [...p[key], step] });
        }}
        onUpdateJourneyStep={(personaId, type, stepId, updates) => {
          const p = personas.find((x) => x.id === personaId);
          if (!p) return;
          const key = type === "asIs" ? "asIsSteps" : "toBeSteps";
          updatePersona(personaId, {
            [key]: p[key].map((s) => (s.id === stepId ? { ...s, ...updates } : s)),
          });
        }}
        onDeleteJourneyStep={(personaId, type, stepId) => {
          const p = personas.find((x) => x.id === personaId);
          if (!p) return;
          const key = type === "asIs" ? "asIsSteps" : "toBeSteps";
          updatePersona(personaId, { [key]: p[key].filter((s) => s.id !== stepId) });
        }}
      />
    </div>
  );
}

// ─── Step 2: Brainstorm de Solucoes ───────────────────────

function BrainstormStep({ sessionId }: { sessionId: string }) {
  const { features, loaded, addFeature, updateFeature, deleteFeature } =
    useBrainstormFeatures(sessionId);
  const [personaNames, setPersonaNames] = useState<string[]>([]);

  // Load persona names from the personas table (replaces legacy /steps/personas_journeys).
  useEffect(() => {
    fetch(`/api/design-sessions/${sessionId}/personas`)
      .then((r) => r.json())
      .then((r) => {
        const personas = (r.personas as { name: string }[]) || [];
        setPersonaNames(personas.map((p) => p.name));
      })
      .catch(() => {});
  }, [sessionId]);

  if (!loaded) {
    return <div className="text-sm text-muted-foreground">Carregando ideias...</div>;
  }

  return (
    <div className="space-y-4">
      <StepHeader cols="triple" description="Hora de gerar ideias sem filtro. Cada solution card descreve uma ideia, como ela resolve o problema e pra qual persona." />
      <SolutionCardBoard
        solutions={features.map((f) => ({
          id: f.id,
          title: f.title,
          howItSolves: f.howItSolves ?? "",
          targetPersona: f.targetPersona ?? "",
          keyScreens: f.keyScreens ?? undefined,
          userFlows: f.userFlows ?? undefined,
          painPointRef: f.painPointRef ?? undefined,
          technicalNotes: f.technicalNotes ?? undefined,
          archived: f.archived,
        }))}
        personaNames={personaNames}
        onAdd={(sol) =>
          addFeature({
            title: sol.title,
            howItSolves: sol.howItSolves,
            targetPersona: sol.targetPersona,
            keyScreens: sol.keyScreens ?? null,
            userFlows: sol.userFlows ?? null,
            painPointRef: sol.painPointRef ?? null,
            technicalNotes: sol.technicalNotes ?? null,
            archived: sol.archived ?? false,
          })
        }
        onUpdate={(id, updates) =>
          updateFeature(id, {
            ...(updates.title !== undefined && { title: updates.title }),
            ...(updates.howItSolves !== undefined && { howItSolves: updates.howItSolves }),
            ...(updates.targetPersona !== undefined && {
              targetPersona: updates.targetPersona,
            }),
            ...(updates.keyScreens !== undefined && {
              keyScreens: updates.keyScreens ?? null,
            }),
            ...(updates.userFlows !== undefined && { userFlows: updates.userFlows ?? null }),
            ...(updates.painPointRef !== undefined && {
              painPointRef: updates.painPointRef ?? null,
            }),
            ...(updates.technicalNotes !== undefined && {
              technicalNotes: updates.technicalNotes ?? null,
            }),
            ...(updates.archived !== undefined && { archived: updates.archived }),
          })
        }
        onDelete={(id) => deleteFeature(id)}
      />
    </div>
  );
}

// ─── Step: Riscos & Lacunas ───────────────────────────────

function RisksGapsStep({ sessionId }: { sessionId: string }) {
  const {
    risks,
    gaps,
    loaded,
    addRisk,
    updateRisk,
    deleteRisk,
    addGap,
    updateGap,
    deleteGap,
  } = useRisksGaps(sessionId);
  const [features, setFeatures] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    fetch(`/api/design-sessions/${sessionId}/brainstorm-features`)
      .then((r) => r.json())
      .then((r) => {
        const list = ((r.features as { id: string; title: string; archived: boolean }[]) || []).filter(
          (s) => !s.archived,
        );
        setFeatures(list.map((s) => ({ id: s.id, title: s.title })));
      })
      .catch(() => {});
  }, [sessionId]);

  if (!loaded) {
    return <div className="text-sm text-muted-foreground">Carregando riscos e gaps...</div>;
  }

  return (
    <div className="space-y-4">
      <StepHeader cols="double" description="Antes de cortar escopo, mapeie o que ainda esta nebuloso e o que pode dar errado. Use isso como criterio na priorizacao." />
      <RiskGapBoard
        gaps={gaps.map((g) => ({
          id: g.id,
          text: g.text,
          category: g.category ?? undefined,
          severity: g.severity ?? undefined,
          relatedFeature: g.relatedFeature ?? undefined,
          mitigation: g.mitigation ?? undefined,
        }))}
        risks={risks.map((r) => ({
          id: r.id,
          text: r.text,
          category: r.category,
          severity: r.severity,
          relatedFeature: r.relatedFeature ?? undefined,
          mitigation: r.mitigation ?? undefined,
        }))}
        features={features}
        onAddGap={(gap) =>
          addGap({
            text: gap.text,
            category: gap.category ?? null,
            severity: gap.severity ?? null,
            relatedFeature: gap.relatedFeature ?? null,
            mitigation: gap.mitigation ?? null,
          })
        }
        onUpdateGap={(id, updates) =>
          updateGap(id, {
            ...(updates.text !== undefined && { text: updates.text }),
            ...(updates.category !== undefined && { category: updates.category ?? null }),
            ...(updates.severity !== undefined && { severity: updates.severity ?? null }),
            ...(updates.relatedFeature !== undefined && {
              relatedFeature: updates.relatedFeature ?? null,
            }),
            ...(updates.mitigation !== undefined && {
              mitigation: updates.mitigation ?? null,
            }),
          })
        }
        onDeleteGap={(id) => deleteGap(id)}
        onAddRisk={(risk) =>
          addRisk({
            text: risk.text,
            category: risk.category,
            severity: risk.severity,
            relatedFeature: risk.relatedFeature ?? null,
            mitigation: risk.mitigation ?? null,
          })
        }
        onUpdateRisk={(id, updates) =>
          updateRisk(id, {
            ...(updates.text !== undefined && { text: updates.text }),
            ...(updates.category !== undefined && { category: updates.category }),
            ...(updates.severity !== undefined && { severity: updates.severity }),
            ...(updates.relatedFeature !== undefined && {
              relatedFeature: updates.relatedFeature ?? null,
            }),
            ...(updates.mitigation !== undefined && {
              mitigation: updates.mitigation ?? null,
            }),
          })
        }
        onDeleteRisk={(id) => deleteRisk(id)}
      />
    </div>
  );
}

// ─── Step 3: Priorizacao & Escopo ─────────────────────────

function PrioritizationStep({ sessionId }: { sessionId: string }) {
  const { items, loaded, updateItem, deleteItem } = usePriorityItems(sessionId);

  if (!loaded) {
    return <div className="text-sm text-muted-foreground">Carregando priorização...</div>;
  }

  return (
    <div className="space-y-4">
      <StepHeader
        cols="triple"
        description="Distribua as solucoes entre MVP (entra agora), Next (proximo ciclo) e Out (fora do escopo). Todas comecam no MVP — mova o que nao e essencial."
        legend={[
          { label: "MVP", accent: "emerald", hint: "entra agora" },
          { label: "NEXT", accent: "amber", hint: "proximo ciclo" },
          { label: "OUT", accent: "neutral", hint: "fora do escopo" },
        ]}
      />
      <PriorityBoard
        items={items.map((i) => ({
          id: i.id,
          title: i.title,
          howItSolves: i.howItSolves,
          targetPersona: i.targetPersona,
          bucket: i.bucket,
          keyScreens: i.keyScreens ?? undefined,
          userFlows: i.userFlows ?? undefined,
          painPointRef: i.painPointRef ?? undefined,
          technicalNotes: i.technicalNotes ?? undefined,
        }))}
        onMove={(itemId, toBucket) => updateItem(itemId, { bucket: toBucket })}
        onDelete={(itemId) => deleteItem(itemId)}
      />
    </div>
  );
}

// ─── Step 4: Especificacoes Tecnicas ──────────────────────

// ─── Step 5: Hipoteses & Metricas ────────────────────────

function HypothesesStep({ sessionId }: { sessionId: string }) {
  const { hypotheses, loaded, addHypothesis, updateHypothesis, deleteHypothesis } =
    useHypotheses(sessionId);

  return (
    <div className="space-y-4">
      <StepHeader cols="single" description="Defina as hipoteses que precisam ser validadas com o MVP. Para cada uma, estabeleca o indicador, a meta e a evidencia necessaria." />
      {!loaded ? (
        <div className="text-sm text-muted-foreground">Carregando hipóteses...</div>
      ) : (
        <HypothesisBoard
          hypotheses={hypotheses.map((h) => ({
            id: h.id,
            hypothesis: h.hypothesis,
            indicator: h.indicator,
            target: h.target,
            expectedResult: h.expectedResult,
            evidence: h.evidence ?? "",
          }))}
          onAdd={(h) =>
            addHypothesis({
              hypothesis: h.hypothesis,
              indicator: h.indicator,
              target: h.target,
              expectedResult: h.expectedResult,
              evidence: h.evidence ?? null,
            })
          }
          onUpdate={(id, updates) =>
            updateHypothesis(id, {
              ...(updates.hypothesis !== undefined && { hypothesis: updates.hypothesis }),
              ...(updates.indicator !== undefined && { indicator: updates.indicator }),
              ...(updates.target !== undefined && { target: updates.target }),
              ...(updates.expectedResult !== undefined && {
                expectedResult: updates.expectedResult,
              }),
              ...(updates.evidence !== undefined && { evidence: updates.evidence ?? null }),
            })
          }
          onDelete={(id) => deleteHypothesis(id)}
        />
      )}
    </div>
  );
}

// ─── Step 6: Especificacoes Tecnicas ──────────────────────

function TechnicalSpecsStep({ sessionId }: { sessionId: string }) {
  const { value, loaded, updateField, addItem, updateItem, deleteItem } =
    useTechnicalSpecs(sessionId);

  if (!loaded) {
    return <div className="text-sm text-muted-foreground">Carregando specs técnicas...</div>;
  }

  return (
    <div className="space-y-4">
      <StepHeader cols="single" description="Registre o que ja esta decidido tecnicamente. Stack, integracoes, restricoes e SLAs alimentam o briefing e a geracao de tasks." />
      <BoardLayout cols="single" stack gap={4}>
      <BoardSection
        accent="indigo"
        icon={<Cpu className="size-4" />}
        eyebrow="Infraestrutura"
        title="Stack"
        subtitle="Linguagens, frameworks, hospedagem, banco — o que ja esta definido?"
      >
        <Textarea
          placeholder="Ex: Next.js + TypeScript, PostgreSQL, deploy na Vercel, monorepo..."
          value={value.stack}
          onChange={(e) => updateField("stack", e.target.value)}
        />
      </BoardSection>

      <BoardSection
        accent="sky"
        icon={<PlugZap className="size-4" />}
        eyebrow="Integracoes"
        title="APIs & terceiros"
        subtitle="APIs externas, sistemas legados, webhooks, terceiros."
      >
        <ItemList
          items={value.integrations}
          placeholder="Ex: API do Stripe para pagamentos"
          onAdd={(text) => addItem("integrations", { id: genId(), text: text.trim() })}
          onUpdate={(id, text) => updateItem("integrations", id, text)}
          onDelete={(id) => deleteItem("integrations", id)}
        />
      </BoardSection>

      <BoardSection
        accent="amber"
        icon={<ShieldAlert className="size-4" />}
        eyebrow="Restricoes"
        title="Regras tecnicas"
        subtitle="Requisitos nao-funcionais, padroes, seguranca, compliance."
      >
        <ItemList
          items={value.rules}
          placeholder="Ex: LGPD — dados pessoais devem ser criptografados em repouso"
          onAdd={(text) => addItem("rules", { id: genId(), text: text.trim() })}
          onUpdate={(id, text) => updateItem("rules", id, text)}
          onDelete={(id) => deleteItem("rules", id)}
        />
      </BoardSection>

      <BoardSection
        accent="emerald"
        icon={<Gauge className="size-4" />}
        eyebrow="Performance"
        title="SLAs & escalabilidade"
        subtitle="SLAs, carga esperada, latencia, picos de uso."
      >
        <Textarea
          placeholder="Ex: Suportar 500 usuarios simultaneos, tempo de resposta < 200ms, pico no fim do mes..."
          value={value.performance}
          onChange={(e) => updateField("performance", e.target.value)}
        />
      </BoardSection>
      </BoardLayout>
    </div>
  );
}

function ItemList({
  items,
  placeholder,
  onAdd,
  onUpdate,
  onDelete,
}: {
  items: { id: string; text: string }[];
  placeholder: string;
  onAdd: (text: string) => void;
  onUpdate: (id: string, text: string) => void;
  onDelete: (id: string) => void;
}) {
  const [newText, setNewText] = useState("");

  const handleAdd = () => {
    if (!newText.trim()) return;
    onAdd(newText.trim());
    setNewText("");
  };

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="flex gap-2 items-start">
          <Textarea
            value={item.text}
            onChange={(e) => onUpdate(item.id, e.target.value)}
            rows={1}
            className="min-h-0 resize-none py-1.5 text-sm leading-snug"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => onDelete(item.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex gap-2 items-start">
        <Textarea
          placeholder={placeholder}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleAdd();
            }
          }}
          rows={1}
          className="min-h-0 resize-none py-1.5 text-sm leading-snug"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={handleAdd}
          disabled={!newText.trim()}
          className="h-8 shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Step 6: Briefing ─────────────────────────────────────

function BriefingStep({ sessionId }: { sessionId: string }) {
  const [allData, setAllData] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const sendChatRef = useRef<((text: string) => void) | null>(null);
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  const [openStoryRef, setOpenStoryRef] = useState<string | null>(null);
  const [openTaskRef, setOpenTaskRef] = useState<string | null>(null);

  const handleTreeAction = useCallback(
    async (action: TreeAction) => {
      // 1. Persist subPhase + targetStoryId BEFORE sending the message so
      //    Vitor's loadContext reads the new state on the very next request.
      // Vocabulary lives in @/lib/design-sessions/constants — keep in sync.
      const subPhase =
        action.type === "detail-story" ? "story_detail" : "task_breakdown";
      await fetch(`/api/design-sessions/${sessionId}/sub-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subPhase, targetStoryId: action.storyId }),
      });

      // 2. Build the natural-language nudge for Vitor.
      const text =
        action.type === "detail-story"
          ? `Vamos detalhar a story ${action.storyRef} ("${action.title}"). Modo story_detail — proponha persona + AC de produto antes de aplicar.`
          : `Vamos gerar as tasks técnicas da story ${action.storyRef} ("${action.title}"). Modo task_breakdown — proponha o plano de tasks antes de aplicar.`;

      // 3. Send through the chat (parent received sendMessage via onSendReady).
      sendChatRef.current?.(text);
    },
    [sessionId],
  );

  useEffect(() => {
    fetch(`/api/design-sessions/${sessionId}/full`)
      .then((r) => r.json())
      .then((full) => {
        // Reconstruct the per-step shape that BriefingSheet expects, sourcing
        // from the normalized tables instead of the legacy step_data JSON.
        const scope = full.scope as
          | {
              inScope?: unknown[];
              outOfScope?: unknown[];
              does?: unknown[];
              doesNot?: unknown[];
            }
          | null;
        const map: Record<string, Record<string, unknown>> = {
          product_vision: (full.productVision ?? {}) as Record<string, unknown>,
          scope_definition: scope
            ? {
                is: scope.inScope ?? [],
                isNot: scope.outOfScope ?? [],
                does: scope.does ?? [],
                doesNot: scope.doesNot ?? [],
              }
            : {},
          personas_journeys: { personas: full.personas ?? [] },
          brainstorm: { solutions: full.brainstormFeatures ?? [] },
          risks_gaps: { risks: full.risks ?? [], gaps: full.gaps ?? [] },
          prioritization: { items: full.priorityItems ?? [] },
          technical_specs: (full.technicalSpecs ?? {}) as Record<string, unknown>,
          hypotheses: { hypotheses: full.hypotheses ?? [] },
        };
        setAllData(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return <div className="text-center text-muted-foreground py-12">Carregando briefing...</div>;
  }

  return (
    // -m-6 cancela o padding global do WizardLayout pra colar o ribbon na
    // borda inferior do header. h-full + flex-col faz o conteúdo abaixo do
    // ribbon ocupar exatamente a altura restante (até o bottom do viewport),
    // e cada coluna do grid rola independente — chat não acompanha a árvore.
    <div className="-m-6 h-full flex flex-col min-h-0">
      <BriefingRibbon
        sessionId={sessionId}
        briefingData={allData}
        refreshKey={treeRefreshKey}
        onStatusChange={() => setTreeRefreshKey((k) => k + 1)}
      />

      {/* Árvore (esquerda) + Chat com Vitor (direita). Cada coluna ocupa
          a altura disponível e rola por dentro. Chat tem composer fixo no
          fim da própria coluna, sem precisar de sticky. */}
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(420px,1fr)] gap-6 p-6">
        <div className="surface overflow-y-auto min-h-0">
          <h3 className="sticky top-0 z-10 bg-card/95 backdrop-blur text-sm font-semibold px-5 pt-5 pb-3 border-b">
            Hierarquia (Module → Story → Task)
          </h3>
          <div className="px-5 py-4">
            <DesignSessionTree
              sessionId={sessionId}
              refreshKey={treeRefreshKey}
              onAction={handleTreeAction}
              onOpenStory={(ref) => setOpenStoryRef(ref)}
            />
          </div>
        </div>

        <div className="min-h-0">
          <BriefingTaskChat
            sessionId={sessionId}
            onTasksChanged={() => setTreeRefreshKey((k) => k + 1)}
            onSendReady={(send) => {
              sendChatRef.current = send;
            }}
          />
        </div>
      </div>

      <StorySheetByRef
        storyRef={openStoryRef}
        onClose={() => setOpenStoryRef(null)}
        onAfterChange={() => setTreeRefreshKey((k) => k + 1)}
        onOpenTask={(taskRef) => {
          setOpenStoryRef(null);
          setOpenTaskRef(taskRef);
        }}
      />

      <TaskSheetByRef
        taskRef={openTaskRef}
        onClose={() => setOpenTaskRef(null)}
        onAfterChange={() => setTreeRefreshKey((k) => k + 1)}
        onOpenStory={(storyRef) => {
          setOpenTaskRef(null);
          setOpenStoryRef(storyRef);
        }}
        onOpenTaskByRef={(taskRef) => {
          setOpenTaskRef(null);
          // Re-open in next tick so the keyed remount picks up the new ref.
          setTimeout(() => setOpenTaskRef(taskRef), 0);
        }}
      />
    </div>
  );
}
