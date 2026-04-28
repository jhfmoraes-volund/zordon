"use client";

import { use, useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { WizardLayout } from "@/components/design-session/wizard-layout";
import { PersonaJourneyBoard, Persona, JourneyStep } from "@/components/design-session/persona-journey-board";
import { SolutionCardBoard, SolutionCard } from "@/components/design-session/solution-card-board";
import { HypothesisBoard, Hypothesis } from "@/components/design-session/hypothesis-board";
import { PriorityBoard, PrioritizedItem, PriorityBucket } from "@/components/design-session/priority-board";
import { PostItBoard, PostItItem, PostItSection } from "@/components/design-session/post-it-board";
import { RiskGapBoard, type Gap, type Risk } from "@/components/design-session/risk-gap-board";
import { CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_TONE } from "@/components/design-session/risk-gap-board";
import { PreWorkStep } from "@/components/design-session/pre-work-step";
import { BriefingTaskChat } from "@/components/design-session/briefing-task-chat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { getStepsForSession, StepDef } from "@/lib/design-session-steps";
import type { Note } from "@/components/design-session/sticky-note";
import { DesignSessionProvider } from "@/contexts/design-session-context";

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

export default function StepPage({
  params,
}: {
  params: Promise<{ id: string; step: string }>;
}) {
  const { id, step: stepStr } = use(params);
  const stepIndex = parseInt(stepStr);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [stepData, setStepData] = useState<Record<string, unknown>>({});
  const [stepDataLoaded, setStepDataLoaded] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const steps = session ? getStepsForSession(session) : [];
  const currentStepDef = steps[stepIndex] as StepDef | undefined;

  // Load session
  useEffect(() => {
    fetch(`/api/design-sessions/${id}`)
      .then((r) => r.json())
      .then(setSession);
  }, [id]);

  // Load step data
  useEffect(() => {
    if (!currentStepDef) return;
    setStepDataLoaded(false);
    fetch(`/api/design-sessions/${id}/steps/${currentStepDef.key}`)
      .then((r) => r.json())
      .then((r) => {
        const { _notes, ...rest } = (r.data || {}) as Record<string, unknown>;
        setStepData(rest);
        setNotes(Array.isArray(_notes) ? (_notes as Note[]) : []);
        setStepDataLoaded(true);
      });
  }, [id, currentStepDef?.key]);

  // Persist step data + notes with debounce
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const stepDataRef = useRef(stepData);
  stepDataRef.current = stepData;

  const debouncedSave = useCallback(
    () => {
      if (!currentStepDef) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setSaving(true);
        await fetch(`/api/design-sessions/${id}/steps/${currentStepDef.key}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepIndex, data: { ...stepDataRef.current, _notes: notesRef.current } }),
        });
        setSaving(false);
      }, 500);
    },
    [id, stepIndex, currentStepDef?.key]
  );

  const saveStepData = useCallback(
    (data: Record<string, unknown>) => {
      setStepData(data);
      stepDataRef.current = data;
      debouncedSave();
    },
    [debouncedSave]
  );

  const genId = () => Math.random().toString(36).slice(2, 9);

  const handleAddNote = useCallback(() => {
    const updated = [...notesRef.current, { id: genId(), text: "" }];
    setNotes(updated);
    notesRef.current = updated;
    debouncedSave();
  }, [debouncedSave]);

  const handleUpdateNote = useCallback((noteId: string, text: string) => {
    const updated = notesRef.current.map((n) => (n.id === noteId ? { ...n, text } : n));
    setNotes(updated);
    notesRef.current = updated;
    debouncedSave();
  }, [debouncedSave]);

  const handleDeleteNote = useCallback((noteId: string) => {
    const updated = notesRef.current.filter((n) => n.id !== noteId);
    setNotes(updated);
    notesRef.current = updated;
    debouncedSave();
  }, [debouncedSave]);

  const refreshStepData = useCallback(async () => {
    if (!currentStepDef) return;
    const r = await fetch(`/api/design-sessions/${id}/steps/${currentStepDef.key}`);
    const json = await r.json();
    const { _notes, ...rest } = (json.data || {}) as Record<string, unknown>;
    setStepData(rest);
    stepDataRef.current = rest;
    setNotes(Array.isArray(_notes) ? (_notes as Note[]) : []);
    notesRef.current = Array.isArray(_notes) ? (_notes as Note[]) : [];
  }, [id, currentStepDef?.key]);

  const navigate = (targetStep: number) => {
    fetch(`/api/design-sessions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentStep: targetStep, status: "in_progress" }),
    });
    router.push(`/design-sessions/${id}/steps/${targetStep}`);
  };

  if (!session || !currentStepDef) {
    return <div className="p-6 text-muted-foreground">Carregando...</div>;
  }

  return (
    <div className="-mx-3 -my-4 h-[calc(100svh-3rem)] overflow-hidden sm:-mx-4 md:h-[calc(100svh-3.5rem)] lg:-m-6">
    <DesignSessionProvider
      sessionId={id}
      sessionTitle={session.title}
      sessionType={session.type}
      currentStepKey={currentStepDef.key}
      currentStepIndex={stepIndex}
      stepData={stepData}
      saveStepData={saveStepData}
      refreshStepData={refreshStepData}
    >
      <WizardLayout
        sessionTitle={session.title}
        sessionType={session.type}
        steps={steps}
        currentStep={stepIndex}
        onNext={() => {
          if (stepIndex < steps.length - 1) {
            navigate(stepIndex + 1);
          } else {
            router.push(`/design-sessions/${id}/review`);
          }
        }}
        onPrevious={() => stepIndex > 0 && navigate(stepIndex - 1)}
        onStepClick={navigate}
        saving={saving}
        notes={notes}
        onAddNote={handleAddNote}
        onUpdateNote={handleUpdateNote}
        onDeleteNote={handleDeleteNote}
        hideSidePanels={currentStepDef.key === "pre_work" || currentStepDef.key === "briefing"}
        backHref={`/projects/${session.projectId}`}
        memoriaHref={`/design-sessions/${id}/memoria`}
      >
        {stepDataLoaded ? (
          <StepContent
            stepKey={currentStepDef.key}
            sessionId={id}
            data={stepData}
            onChange={saveStepData}
          />
        ) : (
          <div className="p-6 text-muted-foreground">Carregando dados...</div>
        )}
      </WizardLayout>
    </DesignSessionProvider>
    </div>
  );
}

// ─── Step Content Router ──────────────────────────────────

function StepContent({
  stepKey,
  sessionId,
  data,
  onChange,
}: {
  stepKey: string;
  sessionId: string;
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  switch (stepKey) {
    case "pre_work":
      return <PreWorkStep sessionId={sessionId} data={data} onChange={onChange} />;
    case "product_vision":
      return <ProductVisionStep data={data} onChange={onChange} />;
    case "scope_definition":
      return <ScopeDefinitionStep data={data} onChange={onChange} />;
    case "personas_journeys":
      return <PersonasJourneysStep data={data} onChange={onChange} />;
    case "brainstorm":
      return <BrainstormStep data={data} onChange={onChange} sessionId={sessionId} />;
    case "risks_gaps":
      return <RisksGapsStep data={data} onChange={onChange} sessionId={sessionId} />;
    case "prioritization":
      return <PrioritizationStep data={data} onChange={onChange} sessionId={sessionId} />;
    case "technical_specs":
      return <TechnicalSpecsStep data={data} onChange={onChange} />;
    case "hypotheses":
      return <HypothesesStep data={data} onChange={onChange} />;
    case "briefing":
      return <BriefingStep sessionId={sessionId} />;
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

function ProductVisionStep({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const get = (key: string) => (data[key] as string) || "";
  const set = (key: string, value: string) => onChange({ ...data, [key]: value });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">O Problema</CardTitle>
          <p className="text-sm text-muted-foreground">
            Por que este produto precisa existir? Qual problema resolve?
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Qual o problema central?</Label>
              <Textarea
                placeholder="Descreva o problema que este produto resolve..."
                value={get("problem")}
                onChange={(e) => set("problem", e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label>Quem sofre com esse problema?</Label>
              <Textarea
                placeholder="Ex: Gestores de vendas em empresas B2B de medio porte"
                value={get("whoSuffers")}
                onChange={(e) => set("whoSuffers", e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid gap-2">
              <Label>O que acontece se nao resolver?</Label>
              <Textarea
                placeholder="Consequencias de manter o status quo..."
                value={get("consequences")}
                onChange={(e) => set("consequences", e.target.value)}
                rows={2}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visao de Sucesso</CardTitle>
          <p className="text-sm text-muted-foreground">
            Como o mundo fica depois? Qual o cenario ideal?
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Como e o sucesso?</Label>
              <Textarea
                placeholder="Descreva o cenario ideal quando o produto estiver funcionando..."
                value={get("successVision")}
                onChange={(e) => set("successVision", e.target.value)}
                rows={3}
              />
            </div>
            <div className="grid gap-2">
              <Label>Metricas de impacto</Label>
              <Textarea
                placeholder="Como vamos medir que deu certo? Ex: reducao de 50% no tempo de resposta a leads"
                value={get("impactMetrics")}
                onChange={(e) => set("impactMetrics", e.target.value)}
                rows={2}
              />
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

// ─── Step: E / Nao E / Faz / Nao Faz ──────────────────────

const SCOPE_BUCKETS = [
  { key: "is", title: "É", tone: "emerald" },
  { key: "isNot", title: "NÃO É", tone: "rose" },
  { key: "does", title: "FAZ", tone: "sky" },
  { key: "doesNot", title: "NÃO FAZ", tone: "amber" },
] as const;

type ScopeBucketKey = (typeof SCOPE_BUCKETS)[number]["key"];

function ScopeDefinitionStep({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const genId = () => Math.random().toString(36).slice(2, 9);
  const getItems = (key: ScopeBucketKey) => (data[key] as PostItItem[]) || [];

  const sections: PostItSection[] = SCOPE_BUCKETS.map((b) => ({
    key: b.key,
    title: b.title,
    tone: b.tone,
    items: getItems(b.key),
  }));

  return (
    <div className="space-y-4">
      <div className="text-sm text-muted-foreground space-y-2">
        <p>
          Alinhe identidade e fronteiras do produto antes de explorar personas. Items curtos e afirmativos.
        </p>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <li><strong className="text-emerald-500">É</strong> — o que o produto é em essência (categoria, posicionamento)</li>
          <li><strong className="text-rose-500">NÃO É</strong> — mal-entendidos a evitar (com o que costumam confundir)</li>
          <li><strong className="text-sky-500">FAZ</strong> — capacidades concretas que vai entregar</li>
          <li><strong className="text-amber-500">NÃO FAZ</strong> — fronteiras explícitas, protege contra scope creep</li>
        </ul>
      </div>
      <PostItBoard
        sections={sections}
        columns={2}
        onAdd={(sectionKey, text) => {
          const key = sectionKey as ScopeBucketKey;
          onChange({ ...data, [key]: [...getItems(key), { id: genId(), text }] });
        }}
        onUpdate={(sectionKey, itemId, text) => {
          const key = sectionKey as ScopeBucketKey;
          onChange({
            ...data,
            [key]: getItems(key).map((i) => (i.id === itemId ? { ...i, text } : i)),
          });
        }}
        onDelete={(sectionKey, itemId) => {
          const key = sectionKey as ScopeBucketKey;
          onChange({ ...data, [key]: getItems(key).filter((i) => i.id !== itemId) });
        }}
      />
    </div>
  );
}

// ─── Step 1: Personas & Jornadas ──────────────────────────

function PersonasJourneysStep({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const genId = () => Math.random().toString(36).slice(2, 9);
  const personas = ((data.personas as Persona[]) || []).map((p) => ({
    ...p,
    id: p.id || genId(),
    asIsSteps: (p.asIsSteps || []).map((s) => ({ ...s, id: s.id || genId() })),
    toBeSteps: (p.toBeSteps || []).map((s) => ({ ...s, id: s.id || genId() })),
  }));

  const updatePersonas = (updated: Persona[]) => {
    onChange({ ...data, personas: updated });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Defina as personas que sofrem com o problema. Para cada uma, mapeie a jornada atual (AS-IS) e a jornada futura (TO-BE).
      </p>
      <PersonaJourneyBoard
        personas={personas}
        onAdd={(persona) => updatePersonas([...personas, persona])}
        onUpdate={(personaId, updates) =>
          updatePersonas(personas.map((p) => (p.id === personaId ? { ...p, ...updates } : p)))
        }
        onDelete={(personaId) => updatePersonas(personas.filter((p) => p.id !== personaId))}
        onAddJourneyStep={(personaId, type, step) => {
          updatePersonas(
            personas.map((p) => {
              if (p.id !== personaId) return p;
              const key = type === "asIs" ? "asIsSteps" : "toBeSteps";
              return { ...p, [key]: [...p[key], step] };
            })
          );
        }}
        onUpdateJourneyStep={(personaId, type, stepId, updates) => {
          updatePersonas(
            personas.map((p) => {
              if (p.id !== personaId) return p;
              const key = type === "asIs" ? "asIsSteps" : "toBeSteps";
              return {
                ...p,
                [key]: p[key].map((s: JourneyStep) =>
                  s.id === stepId ? { ...s, ...updates } : s
                ),
              };
            })
          );
        }}
        onDeleteJourneyStep={(personaId, type, stepId) => {
          updatePersonas(
            personas.map((p) => {
              if (p.id !== personaId) return p;
              const key = type === "asIs" ? "asIsSteps" : "toBeSteps";
              return {
                ...p,
                [key]: p[key].filter((s: JourneyStep) => s.id !== stepId),
              };
            })
          );
        }}
      />
    </div>
  );
}

// ─── Step 2: Brainstorm de Solucoes ───────────────────────

function BrainstormStep({
  data,
  onChange,
  sessionId,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  sessionId: string;
}) {
  const solutions = (data.solutions as SolutionCard[]) || [];
  const [personaNames, setPersonaNames] = useState<string[]>([]);

  // Load persona names from previous step
  useEffect(() => {
    fetch(`/api/design-sessions/${sessionId}/steps/personas_journeys`)
      .then((r) => r.json())
      .then((r) => {
        const personas = (r.data?.personas as Persona[]) || [];
        setPersonaNames(personas.map((p) => p.name));
      })
      .catch(() => {});
  }, [sessionId]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Hora de gerar ideias sem filtro. Cada solution card descreve uma ideia, como ela resolve o problema e pra qual persona.
      </p>
      <SolutionCardBoard
        solutions={solutions}
        personaNames={personaNames}
        onAdd={(sol) => onChange({ ...data, solutions: [...solutions, sol] })}
        onUpdate={(id, updates) =>
          onChange({
            ...data,
            solutions: solutions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
          })
        }
        onDelete={(id) =>
          onChange({ ...data, solutions: solutions.filter((s) => s.id !== id) })
        }
      />
    </div>
  );
}

// ─── Step: Riscos & Lacunas ───────────────────────────────

function RisksGapsStep({
  data,
  onChange,
  sessionId,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  sessionId: string;
}) {
  const gaps = (data.gaps as Gap[]) || [];
  const risks = (data.risks as Risk[]) || [];
  const [features, setFeatures] = useState<{ id: string; title: string }[]>([]);

  useEffect(() => {
    fetch(`/api/design-sessions/${sessionId}/steps/brainstorm`)
      .then((r) => r.json())
      .then((r) => {
        const solutions = ((r.data?.solutions as SolutionCard[]) || []).filter(
          (s) => !s.archived,
        );
        setFeatures(solutions.map((s) => ({ id: s.id, title: s.title })));
      })
      .catch(() => {});
  }, [sessionId]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Antes de cortar escopo, mapeie o que ainda esta nebuloso e o que pode dar errado.
        Use isso como criterio na priorizacao.
      </p>
      <RiskGapBoard
        gaps={gaps}
        risks={risks}
        features={features}
        onAddGap={(gap) => onChange({ ...data, gaps: [...gaps, gap] })}
        onUpdateGap={(id, updates) =>
          onChange({
            ...data,
            gaps: gaps.map((g) => (g.id === id ? { ...g, ...updates } : g)),
          })
        }
        onDeleteGap={(id) =>
          onChange({ ...data, gaps: gaps.filter((g) => g.id !== id) })
        }
        onAddRisk={(risk) => onChange({ ...data, risks: [...risks, risk] })}
        onUpdateRisk={(id, updates) =>
          onChange({
            ...data,
            risks: risks.map((r) => (r.id === id ? { ...r, ...updates } : r)),
          })
        }
        onDeleteRisk={(id) =>
          onChange({ ...data, risks: risks.filter((r) => r.id !== id) })
        }
      />
    </div>
  );
}

// ─── Step 3: Priorizacao & Escopo ─────────────────────────

function PrioritizationStep({
  data,
  onChange,
  sessionId,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  sessionId: string;
}) {
  const items = (data.items as PrioritizedItem[]) || [];
  const [loaded, setLoaded] = useState(false);

  // On first load, pull solutions from brainstorm step and seed as unclassified MVP items
  useEffect(() => {
    if (loaded || items.length > 0) return;
    fetch(`/api/design-sessions/${sessionId}/steps/brainstorm`)
      .then((r) => r.json())
      .then((r) => {
        const solutions = ((r.data?.solutions as SolutionCard[]) || []).filter(
          (s) => !s.archived,
        );
        if (solutions.length > 0) {
          const seeded: PrioritizedItem[] = solutions.map((s) => ({
            id: s.id,
            title: s.title,
            howItSolves: s.howItSolves,
            targetPersona: s.targetPersona,
            bucket: "mvp" as PriorityBucket,
            keyScreens: s.keyScreens,
            userFlows: s.userFlows,
            painPointRef: s.painPointRef,
            technicalNotes: s.technicalNotes,
          }));
          onChange({ ...data, items: seeded });
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [sessionId, loaded, items.length]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Distribua as solucoes entre MVP (entra agora), Next (proximo ciclo) e Out (fora do escopo).
        Todas comecam no MVP — mova o que nao e essencial.
      </p>
      <PriorityBoard
        items={items}
        onMove={(itemId, toBucket) =>
          onChange({
            ...data,
            items: items.map((i) => (i.id === itemId ? { ...i, bucket: toBucket } : i)),
          })
        }
        onDelete={(itemId) =>
          onChange({ ...data, items: items.filter((i) => i.id !== itemId) })
        }
      />
    </div>
  );
}

// ─── Step 4: Especificacoes Tecnicas ──────────────────────

// ─── Step 5: Hipoteses & Metricas ────────────────────────

function HypothesesStep({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const hypotheses = (data.hypotheses as Hypothesis[]) || [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Defina as hipoteses que precisam ser validadas com o MVP. Para cada uma, estabeleca o indicador, a meta e a evidencia necessaria.
      </p>
      <HypothesisBoard
        hypotheses={hypotheses}
        onAdd={(h) => onChange({ ...data, hypotheses: [...hypotheses, h] })}
        onUpdate={(id, updates) =>
          onChange({
            ...data,
            hypotheses: hypotheses.map((h) => (h.id === id ? { ...h, ...updates } : h)),
          })
        }
        onDelete={(id) =>
          onChange({ ...data, hypotheses: hypotheses.filter((h) => h.id !== id) })
        }
      />
    </div>
  );
}

// ─── Step 6: Especificacoes Tecnicas ──────────────────────

type TechSpecItem = { id: string; text: string };

function TechnicalSpecsStep({
  data,
  onChange,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const get = (key: string) => (data[key] as string) || "";
  const set = (key: string, value: string) => onChange({ ...data, [key]: value });
  const getItems = (key: string) => (data[key] as TechSpecItem[]) || [];
  const genId = () => Math.random().toString(36).slice(2, 9);

  const addItem = (key: string, text: string) => {
    if (!text.trim()) return;
    onChange({ ...data, [key]: [...getItems(key), { id: genId(), text: text.trim() }] });
  };

  const removeItem = (key: string, id: string) => {
    onChange({ ...data, [key]: getItems(key).filter((i) => i.id !== id) });
  };

  const updateItem = (key: string, id: string, text: string) => {
    onChange({ ...data, [key]: getItems(key).map((i) => (i.id === id ? { ...i, text } : i)) });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Stack & Infraestrutura</CardTitle>
          <p className="text-sm text-muted-foreground">
            Linguagens, frameworks, hospedagem, banco de dados — o que ja esta definido ou preferido?
          </p>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Ex: Next.js + TypeScript, PostgreSQL, deploy na Vercel, monorepo..."
            value={get("stack")}
            onChange={(e) => set("stack", e.target.value)}
            rows={3}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Integracoes</CardTitle>
          <p className="text-sm text-muted-foreground">
            APIs externas, sistemas legados, webhooks, servicos de terceiros.
          </p>
        </CardHeader>
        <CardContent>
          <ItemList
            items={getItems("integrations")}
            placeholder="Ex: API do Stripe para pagamentos"
            onAdd={(text) => addItem("integrations", text)}
            onUpdate={(id, text) => updateItem("integrations", id, text)}
            onDelete={(id) => removeItem("integrations", id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Regras Tecnicas & Restricoes</CardTitle>
          <p className="text-sm text-muted-foreground">
            Requisitos nao-funcionais, padroes obrigatorios, restricoes de seguranca, compliance.
          </p>
        </CardHeader>
        <CardContent>
          <ItemList
            items={getItems("rules")}
            placeholder="Ex: LGPD — dados pessoais devem ser criptografados em repouso"
            onAdd={(text) => addItem("rules", text)}
            onUpdate={(id, text) => updateItem("rules", id, text)}
            onDelete={(id) => removeItem("rules", id)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance & Escalabilidade</CardTitle>
          <p className="text-sm text-muted-foreground">
            SLAs, carga esperada, requisitos de latencia, picos de uso.
          </p>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Ex: Suportar 500 usuarios simultaneos, tempo de resposta < 200ms, pico no fim do mes..."
            value={get("performance")}
            onChange={(e) => set("performance", e.target.value)}
            rows={3}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Observacoes Adicionais</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Qualquer outra informacao tecnica relevante..."
            value={get("notes")}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
          />
        </CardContent>
      </Card>
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
  items: TechSpecItem[];
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
        <div key={item.id} className="flex gap-2 items-center">
          <Input
            value={item.text}
            onChange={(e) => onUpdate(item.id, e.target.value)}
            className="text-sm"
          />
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => onDelete(item.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="text-sm"
        />
        <Button variant="outline" size="sm" onClick={handleAdd} disabled={!newText.trim()}>
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
  const [taskCount, setTaskCount] = useState(0);
  const [briefingOpen, setBriefingOpen] = useState<boolean | null>(null);

  const loadTaskCount = useCallback(async () => {
    try {
      const r = await fetch(`/api/design-sessions/${sessionId}/tasks?countOnly=1`);
      const j = await r.json();
      setTaskCount(j.count ?? 0);
    } catch {
      // ignore
    }
  }, [sessionId]);

  useEffect(() => {
    const stepKeys = ["product_vision", "scope_definition", "personas_journeys", "brainstorm", "risks_gaps", "prioritization", "technical_specs", "hypotheses"];
    Promise.all([
      ...stepKeys.map((key) =>
        fetch(`/api/design-sessions/${sessionId}/steps/${key}`)
          .then((r) => r.json())
          .then((r) => ({ key, data: r.data || {} }))
      ),
      fetch(`/api/design-sessions/${sessionId}/tasks?countOnly=1`)
        .then((r) => r.json())
        .then((r) => r.count as number)
        .catch(() => 0),
    ]).then((results) => {
      const count = results.pop() as number;
      const map: Record<string, Record<string, unknown>> = {};
      for (const r of results as { key: string; data: Record<string, unknown> }[]) map[r.key] = r.data;
      setAllData(map);
      setTaskCount(count);
      setBriefingOpen(false);
      setLoading(false);
    });
  }, [sessionId]);

  if (loading) {
    return <div className="text-center text-muted-foreground py-12">Carregando briefing...</div>;
  }

  const isOpen = briefingOpen ?? false;
  const vision = allData.product_vision || {};
  const v = (key: string) => (vision[key] as string) || "";
  const scope = allData.scope_definition || {};
  const scopeBuckets = (key: "is" | "isNot" | "does" | "doesNot") =>
    (scope[key] as Array<{ id: string; text: string }> | undefined) || [];
  const hasScope =
    scopeBuckets("is").length > 0 ||
    scopeBuckets("isNot").length > 0 ||
    scopeBuckets("does").length > 0 ||
    scopeBuckets("doesNot").length > 0;
  const personas = (allData.personas_journeys?.personas as Persona[]) || [];
  const solutions = ((allData.brainstorm?.solutions as SolutionCard[]) || []).filter(
    (s) => !s.archived,
  );
  const priorityItems = (allData.prioritization?.items as PrioritizedItem[]) || [];
  const gaps = (allData.risks_gaps?.gaps as Gap[]) || [];
  const risks = (allData.risks_gaps?.risks as Risk[]) || [];
  const featureTitleById = new Map(
    solutions.map((s) => [s.id, s.title || "Sem titulo"]),
  );
  const featureLabel = (ref?: string) => {
    if (!ref) return null;
    return featureTitleById.get(ref) || ref;
  };
  const hypotheses = (allData.hypotheses?.hypotheses as Hypothesis[]) || [];
  const techSpecs = allData.technical_specs || {};
  const ts = (key: string) => {
    const val = techSpecs[key];
    if (!val) return "";
    if (typeof val === "string") return val;
    if (typeof val === "object") return Object.entries(val).map(([k, v]) => `${k}: ${v}`).join("\n");
    return String(val);
  };
  const tsItems = (key: string) => (techSpecs[key] as TechSpecItem[]) || [];

  const mvpItems = priorityItems.filter((i) => i.bucket === "mvp");
  const nextItems = priorityItems.filter((i) => i.bucket === "next");
  const outItems = priorityItems.filter((i) => i.bucket === "out");

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Card>
        <button
          type="button"
          onClick={() => setBriefingOpen(!isOpen)}
          className="w-full flex items-center justify-between p-6 text-left hover:bg-muted/30 transition-colors rounded-t-xl"
        >
          <div className="flex items-center gap-2">
            {isOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
            <div>
              <CardTitle className="text-base">Briefing Consolidado</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                {taskCount > 0
                  ? `${taskCount} task${taskCount > 1 ? "s" : ""} gerada${taskCount > 1 ? "s" : ""} • clique para ${isOpen ? "recolher" : "expandir"}`
                  : "Resumo de toda a session. Use como referencia para geracao de tasks."}
              </p>
            </div>
          </div>
        </button>
        {isOpen && (
        <CardContent className="space-y-6 text-sm">
          {/* Vision */}
          <section>
            <h3 className="font-semibold mb-2">1. Visao do Produto</h3>
            <div className="space-y-1 pl-4">
              {v("problem") && <p><strong>Problema:</strong> {v("problem")}</p>}
              {v("whoSuffers") && <p><strong>Quem sofre:</strong> {v("whoSuffers")}</p>}
              {v("consequences") && <p><strong>Consequencias:</strong> {v("consequences")}</p>}
              {v("successVision") && <p><strong>Visao de sucesso:</strong> {v("successVision")}</p>}
              {v("impactMetrics") && <p><strong>Metricas:</strong> {v("impactMetrics")}</p>}
            </div>
          </section>

          {hasScope && (
            <section>
              <h3 className="font-semibold mb-2">2. Escopo & Fronteiras</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-4">
                {([
                  { key: "is" as const, label: "É", className: "text-emerald-500" },
                  { key: "isNot" as const, label: "NÃO É", className: "text-rose-500" },
                  { key: "does" as const, label: "FAZ", className: "text-sky-500" },
                  { key: "doesNot" as const, label: "NÃO FAZ", className: "text-amber-500" },
                ]).map(({ key, label, className }) => {
                  const items = scopeBuckets(key);
                  if (items.length === 0) return null;
                  return (
                    <div key={key}>
                      <p className={`text-xs font-medium ${className}`}>{label}</p>
                      <ul className="list-disc list-inside text-xs">
                        {items.map((i) => <li key={i.id}>{i.text}</li>)}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {personas.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">3. Personas & Jornadas</h3>
              {personas.map((p) => (
                <div key={p.id} className="pl-4 mb-3">
                  <p className="font-medium">{p.name} — {p.role}</p>
                  {p.context && <p className="text-muted-foreground">{p.context}</p>}
                  {p.asIsSteps.length > 0 && (
                    <div className="mt-1">
                      <p className="text-xs font-medium text-red-600">AS-IS:</p>
                      <ul className="list-disc list-inside text-xs">
                        {p.asIsSteps.map((s) => (
                          <li key={s.id}>{s.description}{s.painOrGain && <span className="text-red-500"> — Dor: {s.painOrGain}</span>}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {p.toBeSteps.length > 0 && (
                    <div className="mt-1">
                      <p className="text-xs font-medium text-green-600">TO-BE:</p>
                      <ul className="list-disc list-inside text-xs">
                        {p.toBeSteps.map((s) => (
                          <li key={s.id}>{s.description}{s.painOrGain && <span className="text-green-600"> — Ganho: {s.painOrGain}</span>}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {solutions.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">4. Solucoes Levantadas</h3>
              <ul className="list-disc list-inside pl-4">
                {solutions.map((s) => (
                  <li key={s.id}><strong>{s.title}</strong>{s.howItSolves && ` — ${s.howItSolves}`}{s.targetPersona && <span className="text-muted-foreground"> (Persona: {s.targetPersona})</span>}</li>
                ))}
              </ul>
            </section>
          )}

          {(gaps.length > 0 || risks.length > 0) && (
            <section>
              <h3 className="font-semibold mb-2">5. Riscos & Lacunas</h3>
              <div className="pl-4 space-y-3">
                {gaps.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-sky-600">Lacunas ({gaps.length})</p>
                    <ul className="list-disc list-inside text-xs space-y-1">
                      {gaps.map((g) => (
                        <li key={g.id}>
                          {(g.category || g.severity) && (
                            <span className="font-medium">
                              [{g.category ? CATEGORY_LABEL[g.category] : "—"}
                              {g.severity ? ` · ${SEVERITY_LABEL[g.severity]}` : ""}]
                            </span>
                          )}{" "}
                          {g.text}
                          {featureLabel(g.relatedFeature) && (
                            <span className="text-muted-foreground"> — ref: {featureLabel(g.relatedFeature)}</span>
                          )}
                          {g.mitigation && (
                            <span className="block pl-4 text-muted-foreground">Mitigacao: {g.mitigation}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {risks.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-red-600">Riscos ({risks.length})</p>
                    <ul className="list-disc list-inside text-xs space-y-1">
                      {risks.map((r) => (
                        <li key={r.id}>
                          <span className="font-medium">[{CATEGORY_LABEL[r.category]} · {SEVERITY_LABEL[r.severity]}]</span>{" "}
                          {r.text}
                          {featureLabel(r.relatedFeature) && (
                            <span className="text-muted-foreground"> — ref: {featureLabel(r.relatedFeature)}</span>
                          )}
                          {r.mitigation && (
                            <span className="block pl-4 text-muted-foreground">Mitigacao: {r.mitigation}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {priorityItems.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">6. Priorizacao</h3>
              <div className="pl-4 space-y-2">
                {mvpItems.length > 0 && (<div><p className="text-xs font-medium text-green-700">MVP ({mvpItems.length})</p><ul className="list-disc list-inside text-xs">{mvpItems.map((i) => <li key={i.id}>{i.title}</li>)}</ul></div>)}
                {nextItems.length > 0 && (<div><p className="text-xs font-medium text-blue-700">Next ({nextItems.length})</p><ul className="list-disc list-inside text-xs">{nextItems.map((i) => <li key={i.id}>{i.title}</li>)}</ul></div>)}
                {outItems.length > 0 && (<div><p className="text-xs font-medium text-muted-foreground">Out ({outItems.length})</p><ul className="list-disc list-inside text-xs">{outItems.map((i) => <li key={i.id}>{i.title}</li>)}</ul></div>)}
              </div>
            </section>
          )}

          {hypotheses.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">7. Hipoteses & Metricas</h3>
              <div className="pl-4 space-y-3">
                {hypotheses.map((h, i) => (
                  <div key={h.id}>
                    <p className="text-xs font-medium">Hipotese {i + 1}: {h.hypothesis}</p>
                    <div className="text-xs text-muted-foreground pl-2 space-y-0.5">
                      {h.indicator && <p><strong>Indicador:</strong> {h.indicator}</p>}
                      {h.target && <p><strong>Meta:</strong> {h.target}</p>}
                      {h.expectedResult && <p><strong>Resultado esperado:</strong> {h.expectedResult}</p>}
                      {h.evidence && <p><strong>Evidencia:</strong> {h.evidence}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(ts("stack") || tsItems("integrations").length > 0 || tsItems("rules").length > 0 || ts("performance") || ts("notes")) && (
            <section>
              <h3 className="font-semibold mb-2">8. Especificacoes Tecnicas</h3>
              <div className="pl-4 space-y-2">
                {ts("stack") && (<div><p className="text-xs font-medium">Stack & Infra</p><p className="text-xs text-muted-foreground">{ts("stack")}</p></div>)}
                {tsItems("integrations").length > 0 && (<div><p className="text-xs font-medium">Integracoes</p><ul className="list-disc list-inside text-xs">{tsItems("integrations").map((i) => <li key={i.id}>{i.text}</li>)}</ul></div>)}
                {tsItems("rules").length > 0 && (<div><p className="text-xs font-medium">Regras & Restricoes</p><ul className="list-disc list-inside text-xs">{tsItems("rules").map((i) => <li key={i.id}>{i.text}</li>)}</ul></div>)}
                {ts("performance") && (<div><p className="text-xs font-medium">Performance</p><p className="text-xs text-muted-foreground">{ts("performance")}</p></div>)}
                {ts("notes") && (<div><p className="text-xs font-medium">Observacoes</p><p className="text-xs text-muted-foreground">{ts("notes")}</p></div>)}
              </div>
            </section>
          )}
        </CardContent>
        )}
      </Card>

      {/* Chat com Vitor — sempre visível, persistente */}
      <BriefingTaskChat sessionId={sessionId} onTasksChanged={loadTaskCount} />
    </div>
  );
}
