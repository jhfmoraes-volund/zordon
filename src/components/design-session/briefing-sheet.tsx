"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CATEGORY_LABEL,
  SEVERITY_LABEL,
  type Gap,
  type Risk,
} from "@/components/design-session/risk-gap-board";
import type { Persona } from "@/components/design-session/persona-journey-board";
import type { SolutionCard } from "@/components/design-session/solution-card-board";
import type { Hypothesis } from "@/components/design-session/hypothesis-board";
import type { PrioritizedItem } from "@/components/design-session/priority-board";

type TechSpecItem = { id: string; text: string };

type Props = {
  open: boolean;
  onClose: () => void;
  allData: Record<string, Record<string, unknown>>;
};

/**
 * Sheet horizontal lateral com o conteúdo completo do briefing consolidado.
 * Substitui o Card colapsável que ocupava o palco — agora vive on-demand
 * acessível pelo BriefingRibbon.
 */
export function BriefingSheet({ open, onClose, allData }: Props) {
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
    if (typeof val === "object")
      return Object.entries(val).map(([k, vv]) => `${k}: ${vv}`).join("\n");
    return String(val);
  };
  const tsItems = (key: string) => (techSpecs[key] as TechSpecItem[]) || [];

  const mvpItems = priorityItems.filter((i) => i.bucket === "mvp");
  const nextItems = priorityItems.filter((i) => i.bucket === "next");
  const outItems = priorityItems.filter((i) => i.bucket === "out");

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="!max-w-5xl w-full sm:!max-w-5xl overflow-y-auto p-6"
      >
        <SheetHeader className="px-0">
          <SheetTitle>Briefing Consolidado</SheetTitle>
        </SheetHeader>
        <div className="space-y-6 text-sm pt-2">
          <section>
            <h3 className="font-semibold mb-2">1. Visao do Produto</h3>
            <div className="space-y-1 pl-4">
              {v("problem") && (
                <p>
                  <strong>Problema:</strong> {v("problem")}
                </p>
              )}
              {v("whoSuffers") && (
                <p>
                  <strong>Quem sofre:</strong> {v("whoSuffers")}
                </p>
              )}
              {v("consequences") && (
                <p>
                  <strong>Consequencias:</strong> {v("consequences")}
                </p>
              )}
              {v("successVision") && (
                <p>
                  <strong>Visao de sucesso:</strong> {v("successVision")}
                </p>
              )}
              {v("impactMetrics") && (
                <p>
                  <strong>Metricas:</strong> {v("impactMetrics")}
                </p>
              )}
            </div>
          </section>

          {hasScope && (
            <section>
              <h3 className="font-semibold mb-2">2. Escopo & Fronteiras</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-4">
                {(
                  [
                    { key: "is" as const, label: "É", className: "text-emerald-500" },
                    { key: "isNot" as const, label: "NÃO É", className: "text-rose-500" },
                    { key: "does" as const, label: "FAZ", className: "text-sky-500" },
                    { key: "doesNot" as const, label: "NÃO FAZ", className: "text-amber-500" },
                  ]
                ).map(({ key, label, className }) => {
                  const items = scopeBuckets(key);
                  if (items.length === 0) return null;
                  return (
                    <div key={key}>
                      <p className={`text-xs font-medium ${className}`}>{label}</p>
                      <ul className="list-disc list-inside text-xs">
                        {items.map((i) => (
                          <li key={i.id}>{i.text}</li>
                        ))}
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
                  <p className="font-medium">
                    {p.name} — {p.role}
                  </p>
                  {p.context && (
                    <p className="text-muted-foreground">{p.context}</p>
                  )}
                  {p.asIsSteps.length > 0 && (
                    <div className="mt-1">
                      <p className="text-xs font-medium text-red-600">AS-IS:</p>
                      <ul className="list-disc list-inside text-xs">
                        {p.asIsSteps.map((s) => (
                          <li key={s.id}>
                            {s.description}
                            {s.painOrGain && (
                              <span className="text-red-500"> — Dor: {s.painOrGain}</span>
                            )}
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
                            {s.painOrGain && (
                              <span className="text-green-600"> — Ganho: {s.painOrGain}</span>
                            )}
                          </li>
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
                  <li key={s.id}>
                    <strong>{s.title}</strong>
                    {s.howItSolves && ` — ${s.howItSolves}`}
                    {s.targetPersona && (
                      <span className="text-muted-foreground"> (Persona: {s.targetPersona})</span>
                    )}
                  </li>
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
                {mvpItems.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-green-700">MVP ({mvpItems.length})</p>
                    <ul className="list-disc list-inside text-xs">
                      {mvpItems.map((i) => (
                        <li key={i.id}>{i.title}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {nextItems.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-blue-700">Next ({nextItems.length})</p>
                    <ul className="list-disc list-inside text-xs">
                      {nextItems.map((i) => (
                        <li key={i.id}>{i.title}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {outItems.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Out ({outItems.length})</p>
                    <ul className="list-disc list-inside text-xs">
                      {outItems.map((i) => (
                        <li key={i.id}>{i.title}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {hypotheses.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2">7. Hipoteses & Metricas</h3>
              <div className="pl-4 space-y-3">
                {hypotheses.map((h, i) => (
                  <div key={h.id}>
                    <p className="text-xs font-medium">
                      Hipotese {i + 1}: {h.hypothesis}
                    </p>
                    <div className="text-xs text-muted-foreground pl-2 space-y-0.5">
                      {h.indicator && (
                        <p>
                          <strong>Indicador:</strong> {h.indicator}
                        </p>
                      )}
                      {h.target && (
                        <p>
                          <strong>Meta:</strong> {h.target}
                        </p>
                      )}
                      {h.expectedResult && (
                        <p>
                          <strong>Resultado esperado:</strong> {h.expectedResult}
                        </p>
                      )}
                      {h.evidence && (
                        <p>
                          <strong>Evidencia:</strong> {h.evidence}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(ts("stack") ||
            tsItems("integrations").length > 0 ||
            tsItems("rules").length > 0 ||
            ts("performance") ||
            ts("notes")) && (
            <section>
              <h3 className="font-semibold mb-2">8. Especificacoes Tecnicas</h3>
              <div className="pl-4 space-y-2">
                {ts("stack") && (
                  <div>
                    <p className="text-xs font-medium">Stack & Infra</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-line">{ts("stack")}</p>
                  </div>
                )}
                {tsItems("integrations").length > 0 && (
                  <div>
                    <p className="text-xs font-medium">Integracoes</p>
                    <ul className="list-disc list-inside text-xs">
                      {tsItems("integrations").map((i) => (
                        <li key={i.id}>{i.text}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {tsItems("rules").length > 0 && (
                  <div>
                    <p className="text-xs font-medium">Regras & Restricoes</p>
                    <ul className="list-disc list-inside text-xs">
                      {tsItems("rules").map((i) => (
                        <li key={i.id}>{i.text}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {ts("performance") && (
                  <div>
                    <p className="text-xs font-medium">Performance</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-line">{ts("performance")}</p>
                  </div>
                )}
                {ts("notes") && (
                  <div>
                    <p className="text-xs font-medium">Observacoes</p>
                    <p className="text-xs text-muted-foreground whitespace-pre-line">{ts("notes")}</p>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
