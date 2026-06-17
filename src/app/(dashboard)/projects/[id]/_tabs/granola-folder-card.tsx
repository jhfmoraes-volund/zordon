"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ConfirmState } from "@/components/ui/confirm-dialog";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import type {
  GranolaFoldersResponse,
  GranolaFolderOption,
  GranolaFolderBinding,
} from "@/app/api/projects/[id]/granola-folders/route";

type Props = {
  projectId: string;
  projectName: string;
  referenceKey: string | null;
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/** Uma folder é "sugerida" se seu nome casa (contém/igual) projectName ou referenceKey. */
function isSuggested(
  folderName: string | null,
  signals: string[],
): boolean {
  if (!folderName) return false;
  const name = normalize(folderName);
  if (!name) return false;
  return signals.some(
    (sig) => sig.length >= 2 && (name.includes(sig) || sig.includes(name)),
  );
}

export function GranolaFolderCard({
  projectId,
  projectName,
  referenceKey,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState<GranolaFolderOption[]>([]);
  const [bindings, setBindings] = useState<GranolaFolderBinding[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [binding, setBinding] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetchOrThrow(
        `/api/projects/${projectId}/granola-folders`,
      );
      const data = (await res.json()) as GranolaFoldersResponse;
      setNeedsAuth(data.needsAuth);
      setError(data.error ?? null);
      setAvailable(data.available);
      setBindings(data.bindings);
    } catch (err) {
      showErrorToast(err, { label: "Falha ao carregar folders do Granola" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const signals = useMemo(
    () => [normalize(projectName), normalize(referenceKey ?? "")].filter(Boolean),
    [projectName, referenceKey],
  );

  const boundIds = useMemo(
    () => new Set(bindings.map((b) => b.folderId)),
    [bindings],
  );

  // Folders disponíveis que ainda não estão vinculadas, com flag de sugestão.
  const options = useMemo(
    () =>
      available
        .filter((f) => !boundIds.has(f.id))
        .map((f) => ({
          ...f,
          suggested: isSuggested(f.name, signals),
        })),
    [available, boundIds, signals],
  );

  // Pré-seleciona a primeira folder sugerida quando a lista muda.
  useEffect(() => {
    if (selected && options.some((o) => o.id === selected)) return;
    const firstSuggested = options.find((o) => o.suggested);
    setSelected(firstSuggested?.id ?? "");
  }, [options, selected]);

  async function bind() {
    if (!selected) return;
    const folder = options.find((o) => o.id === selected);
    setBinding(true);
    try {
      const res = await fetchOrThrow(
        `/api/projects/${projectId}/granola-folders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderId: selected,
            folderName: folder?.name ?? null,
          }),
        },
      );
      const { binding: created } = (await res.json()) as {
        binding: GranolaFolderBinding;
      };
      setBindings((prev) => [...prev, created]);
      setSelected("");
    } catch (err) {
      showErrorToast(err, { label: "Falha ao vincular folder" });
    } finally {
      setBinding(false);
    }
  }

  function askRemove(b: GranolaFolderBinding) {
    const label = b.folderName ?? b.folderId;
    setConfirm({
      title: "Desvincular folder?",
      description: `A folder "${label}" deixará de alimentar o PM Review deste projeto.`,
      confirmLabel: "Desvincular",
      destructive: true,
      onConfirm: async () => {
        try {
          await fetchOrThrow(
            `/api/projects/${projectId}/granola-folders/${b.id}`,
            { method: "DELETE" },
          );
          setBindings((prev) => prev.filter((x) => x.id !== b.id));
        } catch (err) {
          showErrorToast(err, { label: "Falha ao desvincular folder" });
        }
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Folders do Granola</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Vincule folders do Granola a este projeto. As reuniões dessas folders
          alimentam o PM Review automaticamente.
        </p>

        {loading ? (
          <p className="text-xs text-muted-foreground">Carregando…</p>
        ) : needsAuth ? (
          <p className="text-xs text-muted-foreground">
            Conecte sua conta Granola na aba Integrações para vincular folders.
          </p>
        ) : (
          <>
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : null}

            {bindings.length > 0 ? (
              <ul className="space-y-1.5">
                {bindings.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm"
                  >
                    <span className="flex-1 truncate">
                      {b.folderName ?? b.folderId}
                      {b.memberId === null ? (
                        <span className="ml-2 text-xs text-amber-600">
                          órfã — desvincule e reconecte
                        </span>
                      ) : null}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => askRemove(b)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma folder vinculada ainda.
              </p>
            )}

            {options.length > 0 ? (
              <div className="flex gap-2">
                <Select
                  value={selected}
                  onValueChange={(v) => setSelected(v ?? "")}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Escolha uma folder…" />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {(o.name ?? o.id) + (o.suggested ? " (sugerida)" : "")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={bind} disabled={binding || !selected}>
                  {binding ? "Vinculando…" : "Vincular"}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Nenhuma folder disponível para vincular.
              </p>
            )}
          </>
        )}
      </CardContent>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </Card>
  );
}
