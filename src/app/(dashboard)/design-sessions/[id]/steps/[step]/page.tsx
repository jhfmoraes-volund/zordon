"use client";

import { use, useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { WizardLayout } from "@/components/design-session/wizard-layout";
import { PostItBoard, PostItSection } from "@/components/design-session/post-it-board";
import { PersonaJourneyBoard, Persona, JourneyStep } from "@/components/design-session/persona-journey-board";
import { SolutionCardBoard, SolutionCard } from "@/components/design-session/solution-card-board";
import { PriorityBoard, PrioritizedItem, PriorityBucket } from "@/components/design-session/priority-board";
import { SequencingBoard, Phase } from "@/components/design-session/sequencing-board";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { TaskPreview, type PreviewTask } from "@/components/design-session/task-preview";
import { getSteps, StepDef } from "@/lib/design-session-steps";

type Session = {
  id: string;
  title: string;
  type: string;
  status: string;
  currentStep: number;
  project: { name: string };
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
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const steps = session ? getSteps(session.type) : [];
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
    fetch(`/api/design-sessions/${id}/steps/${currentStepDef.key}`)
      .then((r) => r.json())
      .then((r) => setStepData(r.data || {}));
  }, [id, currentStepDef?.key]);

  // Save step data with debounce
  const saveStepData = useCallback(
    (data: Record<string, unknown>) => {
      if (!currentStepDef) return;
      setStepData(data);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        setSaving(true);
        await fetch(`/api/design-sessions/${id}/steps/${currentStepDef.key}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stepIndex, data }),
        });
        setSaving(false);
      }, 500);
    },
    [id, stepIndex, currentStepDef?.key]
  );

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
    <WizardLayout
      sessionTitle={session.title}
      sessionType={session.type}
      steps={steps}
      currentStep={stepIndex}
      onNext={() => stepIndex < steps.length - 1 && navigate(stepIndex + 1)}
      onPrevious={() => stepIndex > 0 && navigate(stepIndex - 1)}
      onStepClick={navigate}
      saving={saving}
    >
      <StepContent
        stepKey={currentStepDef.key}
        sessionId={id}
        data={stepData}
        onChange={saveStepData}
      />
    </WizardLayout>
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
    case "product_vision":
      return <ProductVisionStep data={data} onChange={onChange} />;
    case "personas_journeys":
      return <PersonasJourneysStep data={data} onChange={onChange} />;
    case "brainstorm":
      return <BrainstormStep data={data} onChange={onChange} sessionId={sessionId} />;
    case "prioritization":
      return <PrioritizationStep data={data} onChange={onChange} sessionId={sessionId} />;
    case "sequencing":
      return <SequencingStep data={data} onChange={onChange} sessionId={sessionId} />;
    case "technical_specs":
      return <TechnicalSpecsStep data={data} onChange={onChange} />;
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
              <Input
                placeholder="Ex: Gestores de vendas em empresas B2B de medio porte"
                value={get("whoSuffers")}
                onChange={(e) => set("whoSuffers", e.target.value)}
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

      {/* Preview */}
      {(get("problem") || get("successVision")) && (
        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-sm">Preview da Visao</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            {get("problem") && (
              <p>
                <strong>Problema:</strong> {get("problem")}
              </p>
            )}
            {get("whoSuffers") && (
              <p>
                <strong>Quem sofre:</strong> {get("whoSuffers")}
              </p>
            )}
            {get("successVision") && (
              <p>
                <strong>Sucesso:</strong> {get("successVision")}
              </p>
            )}
            {get("impactMetrics") && (
              <p>
                <strong>Metricas:</strong> {get("impactMetrics")}
              </p>
            )}
          </CardContent>
        </Card>
      )}
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
  const personas = (data.personas as Persona[]) || [];

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
        const solutions = (r.data?.solutions as SolutionCard[]) || [];
        if (solutions.length > 0) {
          const seeded: PrioritizedItem[] = solutions.map((s) => ({
            id: s.id,
            title: s.title,
            howItSolves: s.howItSolves,
            targetPersona: s.targetPersona,
            bucket: "mvp" as PriorityBucket,
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

// ─── Step 4: Sequenciamento ───────────────────────────────

function SequencingStep({
  data,
  onChange,
  sessionId,
}: {
  data: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  sessionId: string;
}) {
  const phases = (data.phases as Phase[]) || [];
  const [loaded, setLoaded] = useState(false);

  // On first load, seed with MVP items from prioritization step in a single "Release 1" phase
  useEffect(() => {
    if (loaded || phases.length > 0) return;
    fetch(`/api/design-sessions/${sessionId}/steps/prioritization`)
      .then((r) => r.json())
      .then((r) => {
        const items = (r.data?.items as PrioritizedItem[]) || [];
        const mvpItems = items.filter((i) => i.bucket === "mvp");
        if (mvpItems.length > 0) {
          const genId = () => Math.random().toString(36).slice(2, 9);
          const seeded: Phase[] = [
            {
              id: genId(),
              name: "Release 1",
              items: mvpItems.map((i) => ({
                id: i.id,
                title: i.title,
                targetPersona: i.targetPersona,
              })),
            },
          ];
          onChange({ ...data, phases: seeded });
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [sessionId, loaded, phases.length]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Organize os items do MVP em fases/releases. Crie novas fases e mova items entre elas para definir a ordem de entrega.
      </p>
      <SequencingBoard
        phases={phases}
        onAddPhase={(phase) => onChange({ ...data, phases: [...phases, phase] })}
        onDeletePhase={(phaseId) =>
          onChange({ ...data, phases: phases.filter((p) => p.id !== phaseId) })
        }
        onRenamePhase={(phaseId, name) =>
          onChange({
            ...data,
            phases: phases.map((p) => (p.id === phaseId ? { ...p, name } : p)),
          })
        }
        onMoveItem={(itemId, fromPhaseId, toPhaseId) => {
          const fromPhase = phases.find((p) => p.id === fromPhaseId);
          const item = fromPhase?.items.find((i) => i.id === itemId);
          if (!item) return;
          onChange({
            ...data,
            phases: phases.map((p) => {
              if (p.id === fromPhaseId) return { ...p, items: p.items.filter((i) => i.id !== itemId) };
              if (p.id === toPhaseId) return { ...p, items: [...p.items, item] };
              return p;
            }),
          });
        }}
        onRemoveItem={(phaseId, itemId) =>
          onChange({
            ...data,
            phases: phases.map((p) =>
              p.id === phaseId ? { ...p, items: p.items.filter((i) => i.id !== itemId) } : p
            ),
          })
        }
      />
    </div>
  );
}

// ─── Step 5: Especificacoes Tecnicas ──────────────────────

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
  const [generating, setGenerating] = useState(false);
  const [previewTasks, setPreviewTasks] = useState<PreviewTask[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stepKeys = ["product_vision", "personas_journeys", "brainstorm", "prioritization", "sequencing", "technical_specs"];
    Promise.all(
      stepKeys.map((key) =>
        fetch(`/api/design-sessions/${sessionId}/steps/${key}`)
          .then((r) => r.json())
          .then((r) => ({ key, data: r.data || {} }))
      )
    ).then((results) => {
      const map: Record<string, Record<string, unknown>> = {};
      for (const r of results) map[r.key] = r.data;
      setAllData(map);
      setLoading(false);
    });
  }, [sessionId]);

  if (loading) {
    return <div className="text-center text-muted-foreground py-12">Carregando briefing...</div>;
  }

  const vision = allData.product_vision || {};
  const v = (key: string) => (vision[key] as string) || "";
  const personas = (allData.personas_journeys?.personas as Persona[]) || [];
  const solutions = (allData.brainstorm?.solutions as SolutionCard[]) || [];
  const priorityItems = (allData.prioritization?.items as PrioritizedItem[]) || [];
  const phases = (allData.sequencing?.phases as Phase[]) || [];
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
        <CardHeader>
          <CardTitle className="text-base">Briefing Consolidado</CardTitle>
          <p className="text-sm text-muted-foreground">
            Resumo de toda a session. Use como referencia para geracao de tasks.
          </p>
        </CardHeader>
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

          {/* Personas */}
          {personas.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">2. Personas & Jornadas</h3>
              {personas.map((p) => (
                <div key={p.id} className="pl-4 mb-3">
                  <p className="font-medium">{p.name} — {p.role}</p>
                  {p.context && <p className="text-muted-foreground">{p.context}</p>}
                  {p.asIsSteps.length > 0 && (
                    <div className="mt-1">
                      <p className="text-xs font-medium text-red-600">AS-IS:</p>
                      <ul className="list-disc list-inside text-xs">
                        {p.asIsSteps.map((s) => (
                          <li key={s.id}>
                            {s.description}
                            {s.painOrGain && <span className="text-red-500"> — Dor: {s.painOrGain}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {p.toBeSteps.length > 0 && (
                    <div className="mt-1">
                      <p className="text-xs font-medium text-green-600">TO-BE:</p>
                      <ul className="list-disc list-inside text-xs">
                        {p.toBeSteps.map((s) => (
                          <li key={s.id}>
                            {s.description}
                            {s.painOrGain && <span className="text-green-600"> — Ganho: {s.painOrGain}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {/* Solutions */}
          {solutions.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">3. Solucoes Levantadas</h3>
              <ul className="list-disc list-inside pl-4">
                {solutions.map((s) => (
                  <li key={s.id}>
                    <strong>{s.title}</strong>
                    {s.howItSolves && ` — ${s.howItSolves}`}
                    {s.targetPersona && <span className="text-muted-foreground"> (Persona: {s.targetPersona})</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Prioritization */}
          {priorityItems.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">4. Priorizacao</h3>
              <div className="pl-4 space-y-2">
                {mvpItems.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-green-700">MVP ({mvpItems.length})</p>
                    <ul className="list-disc list-inside text-xs">
                      {mvpItems.map((i) => <li key={i.id}>{i.title}</li>)}
                    </ul>
                  </div>
                )}
                {nextItems.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-blue-700">Next ({nextItems.length})</p>
                    <ul className="list-disc list-inside text-xs">
                      {nextItems.map((i) => <li key={i.id}>{i.title}</li>)}
                    </ul>
                  </div>
                )}
                {outItems.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Out ({outItems.length})</p>
                    <ul className="list-disc list-inside text-xs">
                      {outItems.map((i) => <li key={i.id}>{i.title}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Sequencing */}
          {phases.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">5. Sequenciamento</h3>
              <div className="pl-4 space-y-2">
                {phases.map((phase, i) => (
                  <div key={phase.id}>
                    <p className="text-xs font-medium">Fase {i + 1}: {phase.name} ({phase.items.length} items)</p>
                    <ul className="list-disc list-inside text-xs">
                      {phase.items.map((item) => <li key={item.id}>{item.title}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Technical Specs */}
          {(ts("stack") || tsItems("integrations").length > 0 || tsItems("rules").length > 0 || ts("performance") || ts("notes")) && (
            <section>
              <h3 className="font-semibold mb-2">6. Especificacoes Tecnicas</h3>
              <div className="pl-4 space-y-2">
                {ts("stack") && (
                  <div>
                    <p className="text-xs font-medium">Stack & Infra</p>
                    <p className="text-xs text-muted-foreground">{ts("stack")}</p>
                  </div>
                )}
                {tsItems("integrations").length > 0 && (
                  <div>
                    <p className="text-xs font-medium">Integracoes</p>
                    <ul className="list-disc list-inside text-xs">
                      {tsItems("integrations").map((i) => <li key={i.id}>{i.text}</li>)}
                    </ul>
                  </div>
                )}
                {tsItems("rules").length > 0 && (
                  <div>
                    <p className="text-xs font-medium">Regras & Restricoes</p>
                    <ul className="list-disc list-inside text-xs">
                      {tsItems("rules").map((i) => <li key={i.id}>{i.text}</li>)}
                    </ul>
                  </div>
                )}
                {ts("performance") && (
                  <div>
                    <p className="text-xs font-medium">Performance</p>
                    <p className="text-xs text-muted-foreground">{ts("performance")}</p>
                  </div>
                )}
                {ts("notes") && (
                  <div>
                    <p className="text-xs font-medium">Observacoes</p>
                    <p className="text-xs text-muted-foreground">{ts("notes")}</p>
                  </div>
                )}
              </div>
            </section>
          )}
        </CardContent>
      </Card>

      {/* Task Generation */}
      {confirmed ? (
        <Card>
          <CardContent className="py-8 text-center space-y-2">
            <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto" />
            <p className="text-sm font-medium">Tasks criadas com sucesso!</p>
            <p className="text-sm text-muted-foreground">
              As tasks foram adicionadas ao backlog do projeto.
            </p>
          </CardContent>
        </Card>
      ) : previewTasks.length > 0 ? (
        <TaskPreview
          tasks={previewTasks}
          onChange={setPreviewTasks}
          onConfirm={async () => {
            setConfirming(true);
            try {
              const included = previewTasks.filter((t) => t.included);
              const res = await fetch(`/api/design-sessions/${sessionId}/generate-tasks`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  confirm: true,
                  tasks: included.map(({ id, included: _, ...rest }) => rest),
                }),
              });
              if (!res.ok) throw new Error("Falha ao criar tasks");
              setConfirmed(true);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Erro ao criar tasks");
            } finally {
              setConfirming(false);
            }
          }}
          confirming={confirming}
        />
      ) : (
        <div className="text-center py-6 space-y-3">
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
          <Button
            onClick={async () => {
              setGenerating(true);
              setError(null);
              try {
                const res = await fetch(`/api/design-sessions/${sessionId}/generate-tasks`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({}),
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                setPreviewTasks(
                  data.tasks.map((t: Record<string, unknown>, i: number) => ({
                    ...t,
                    id: `gen-${i}`,
                    included: true,
                  }))
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : "Erro ao gerar tasks");
              } finally {
                setGenerating(false);
              }
            }}
            disabled={generating}
            size="lg"
            className="gap-2"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Gerando tasks com IA...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Gerar Tasks com IA
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            A IA vai analisar todos os dados da session e gerar tasks detalhadas com acceptance criteria.
          </p>
        </div>
      )}
    </div>
  );
}
