"use client";

import { useState } from "react";
import { Layers, Pencil, Plus, Trash2, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModuleDialog, PersonaDialog } from "./dialogs";
import type { Module, Persona } from "./types";

type SettingsPanelProps = {
  modules: Module[];
  personas: Persona[];
  /** Mutators — page owns the state, panel just emits intent. */
  onCreateModule: (data: { name: string; description?: string }) => void;
  onUpdateModule: (id: string, data: { name: string; description?: string }) => void;
  onDeleteModule: (id: string) => void;
  onCreatePersona: (data: { name: string; description?: string }) => void;
  onUpdatePersona: (
    id: string,
    data: { name: string; description?: string },
  ) => void;
  onDeletePersona: (id: string) => void;
  /** Optional usage counts to label "in-use" vs deletable. */
  moduleUsage?: Record<string, number>;
  personaUsage?: Record<string, number>;
};

export function SettingsPanel({
  modules,
  personas,
  onCreateModule,
  onUpdateModule,
  onDeleteModule,
  onCreatePersona,
  onUpdatePersona,
  onDeletePersona,
  moduleUsage = {},
  personaUsage = {},
}: SettingsPanelProps) {
  const [moduleDialog, setModuleDialog] = useState<{
    open: boolean;
    initial: Module | null;
  }>({ open: false, initial: null });

  const [personaDialog, setPersonaDialog] = useState<{
    open: boolean;
    initial: Persona | null;
  }>({ open: false, initial: null });

  return (
    <div className="space-y-6">
      {/* Modules ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="inline-flex items-center gap-2">
                <Layers className="size-4 text-muted-foreground" />
                Modules
              </CardTitle>
              <CardDescription>
                Tags de agrupamento por área funcional. Per-projeto. Sem owner /
                due date.
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => setModuleDialog({ open: true, initial: null })}
            >
              <Plus className="size-3.5" />
              Novo módulo
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {modules.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum módulo. Crie o primeiro pra agrupar suas user stories.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              {modules.map((m, i) => {
                const usage = moduleUsage[m.id] ?? 0;
                return (
                  <div
                    key={m.id}
                    className={`flex items-center gap-3 px-3 py-2 text-sm ${
                      i > 0 ? "border-t" : ""
                    }`}
                  >
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {m.name}
                    </Badge>
                    <span className="flex-1 truncate text-muted-foreground">
                      {m.description ?? (
                        <span className="italic">sem descrição</span>
                      )}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {usage} {usage === 1 ? "story" : "stories"}
                    </span>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() =>
                        setModuleDialog({ open: true, initial: m })
                      }
                      aria-label="Editar"
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => onDeleteModule(m.id)}
                      disabled={usage > 0}
                      aria-label="Deletar"
                      title={
                        usage > 0
                          ? "Tem stories vinculadas. Reatribua antes."
                          : "Deletar"
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Personas ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="inline-flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                Personas
              </CardTitle>
              <CardDescription>
                Quem a story serve. Builder / PM / Cliente já vêm de seed —
                edite ou adicione conforme o domínio.
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => setPersonaDialog({ open: true, initial: null })}
            >
              <Plus className="size-3.5" />
              Nova persona
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-md border">
            {personas.map((p, i) => {
              const usage = personaUsage[p.id] ?? 0;
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 px-3 py-2 text-sm ${
                    i > 0 ? "border-t" : ""
                  }`}
                >
                  <span className="min-w-[120px] font-medium">{p.name}</span>
                  <span className="flex-1 truncate text-muted-foreground">
                    {p.description ?? (
                      <span className="italic">sem descrição</span>
                    )}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {usage} {usage === 1 ? "story" : "stories"}
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() =>
                      setPersonaDialog({ open: true, initial: p })
                    }
                    aria-label="Editar"
                  >
                    <Pencil />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onDeletePersona(p.id)}
                    disabled={usage > 0}
                    aria-label="Deletar"
                    title={
                      usage > 0
                        ? "Tem stories vinculadas. Reatribua antes."
                        : "Deletar"
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Dialogs ──────────────────────────────────────────────────────── */}
      <ModuleDialog
        open={moduleDialog.open}
        onOpenChange={(open) =>
          setModuleDialog((s) => ({ ...s, open, initial: open ? s.initial : null }))
        }
        initial={moduleDialog.initial}
        onSubmit={(data) => {
          if (moduleDialog.initial) {
            onUpdateModule(moduleDialog.initial.id, data);
          } else {
            onCreateModule(data);
          }
        }}
      />

      <PersonaDialog
        open={personaDialog.open}
        onOpenChange={(open) =>
          setPersonaDialog((s) => ({ ...s, open, initial: open ? s.initial : null }))
        }
        initial={personaDialog.initial}
        onSubmit={(data) => {
          if (personaDialog.initial) {
            onUpdatePersona(personaDialog.initial.id, data);
          } else {
            onCreatePersona(data);
          }
        }}
      />
    </div>
  );
}
