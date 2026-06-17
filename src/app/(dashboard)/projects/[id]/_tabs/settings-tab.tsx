"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SettingsPanel } from "@/components/story-hierarchy";
import {
  adaptModule,
  adaptPersona,
} from "@/components/story-hierarchy/adapters";
import { createClient } from "@/lib/supabase/client";
import { showErrorToast } from "@/lib/optimistic/toast";
import { GranolaFolderCard } from "./granola-folder-card";
import type { ProjectMeta } from "../_types";

type Props = {
  project: ProjectMeta;
  modules: ReturnType<typeof adaptModule>[];
  personas: ReturnType<typeof adaptPersona>[];
  moduleUsage: Record<string, number>;
  personaUsage: Record<string, number>;
  onCreateModule: (data: { name: string; description?: string }) => Promise<void>;
  onUpdateModule: (
    id: string,
    data: { name?: string; description?: string },
  ) => Promise<void>;
  onDeleteModule: (id: string) => Promise<void>;
  onCreatePersona: (data: { name: string; description?: string }) => Promise<void>;
  onUpdatePersona: (
    id: string,
    data: { name?: string; description?: string },
  ) => Promise<void>;
  onDeletePersona: (id: string) => Promise<void>;
  onUpdateProject: () => Promise<void>;
};

export function SettingsTab({
  project,
  modules,
  personas,
  moduleUsage,
  personaUsage,
  onCreateModule,
  onUpdateModule,
  onDeleteModule,
  onCreatePersona,
  onUpdatePersona,
  onDeletePersona,
  onUpdateProject,
}: Props) {
  const [refKey, setRefKey] = useState(project.referenceKey ?? "");
  const [savingRef, setSavingRef] = useState(false);
  const [dod, setDod] = useState<string[]>(project.definitionOfDone);
  const [dodNew, setDodNew] = useState("");
  const [savingDod, setSavingDod] = useState(false);

  useEffect(() => {
    setRefKey(project.referenceKey ?? "");
    setDod(project.definitionOfDone);
  }, [project]);

  async function saveRef() {
    setSavingRef(true);
    try {
      const supabase = createClient();
      const normalized = refKey.trim().toUpperCase();
      const { error } = await supabase
        .from("Project")
        .update({ referenceKey: normalized })
        .eq("id", project.id);
      if (error) {
        const isDup = /duplicate key|project_reference_key_unique/i.test(
          error.message,
        );
        showErrorToast(
          new Error(
            isDup
              ? `Reference "${normalized}" já está em uso por outro projeto.`
              : error.message,
          ),
          { label: "Falha ao salvar reference" },
        );
        return;
      }
      await onUpdateProject();
    } finally {
      setSavingRef(false);
    }
  }

  async function saveDod(items: string[]) {
    setSavingDod(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/dod`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        showErrorToast(new Error("Falha ao salvar DoD"), {
          label: "DoD",
        });
        return;
      }
      await onUpdateProject();
    } finally {
      setSavingDod(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* referenceKey */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reference key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Prefixo único pro código de stories deste projeto (CRM-US-001).
            Gerado automaticamente ao criar o projeto; só edite se precisar.
            2-5 caracteres (letras + dígitos), iniciando por letra.
          </p>
          <div className="flex items-center gap-2">
            <Input
              value={refKey}
              onChange={(e) =>
                setRefKey(
                  e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                )
              }
              maxLength={5}
              className="w-32 font-mono"
              placeholder="CRM"
            />
            <Button
              onClick={saveRef}
              disabled={
                savingRef ||
                !/^[A-Z][A-Z0-9]{1,4}$/.test(refKey) ||
                refKey === project.referenceKey
              }
            >
              {savingRef ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* DoD */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Definition of Done</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Critérios globais aplicados a todas as stories deste projeto.
          </p>
          <ul className="space-y-1.5">
            {dod.map((item, i) => (
              <li
                key={i}
                className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
              >
                <span className="flex-1">{item}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={async () => {
                    const next = dod.filter((_, j) => j !== i);
                    setDod(next);
                    await saveDod(next);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              value={dodNew}
              onChange={(e) => setDodNew(e.target.value)}
              placeholder="ex: PR review aprovado"
              className="flex-1"
            />
            <Button
              onClick={async () => {
                if (!dodNew.trim()) return;
                const next = [...dod, dodNew.trim()];
                setDod(next);
                setDodNew("");
                await saveDod(next);
              }}
              disabled={savingDod || !dodNew.trim()}
            >
              Adicionar
            </Button>
          </div>
        </CardContent>
      </Card>

      <GranolaFolderCard
        projectId={project.id}
        projectName={project.name}
        referenceKey={project.referenceKey}
      />

      <SettingsPanel
        modules={modules}
        personas={personas}
        moduleUsage={moduleUsage}
        personaUsage={personaUsage}
        onCreateModule={(data) => {
          onCreateModule(data);
        }}
        onUpdateModule={(id, data) => {
          onUpdateModule(id, data);
        }}
        onDeleteModule={(id) => {
          onDeleteModule(id);
        }}
        onCreatePersona={(data) => {
          onCreatePersona(data);
        }}
        onUpdatePersona={(id, data) => {
          onUpdatePersona(id, data);
        }}
        onDeletePersona={(id) => {
          onDeletePersona(id);
        }}
      />
    </div>
  );
}
