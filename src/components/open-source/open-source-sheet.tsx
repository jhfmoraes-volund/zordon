"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import {
  ResponsiveSheet,
  ResponsiveSheetBody,
  ResponsiveSheetContent,
  ResponsiveSheetFooter,
  ResponsiveSheetHeader,
  ResponsiveSheetTitle,
} from "@/components/ui/responsive-sheet";
import { Field, FormBody } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { showErrorToast } from "@/lib/optimistic/toast";
import {
  PHOTO_ACCEPTED_MIME,
  PhotoValidationError,
  removePhoto,
  uploadResizedPhoto,
} from "@/lib/storage/photo";
import { toast } from "sonner";
import type {
  OpenSourceCardRow,
  OpenSourceCardInput,
} from "@/lib/dal/open-source";
import { OpenSourcePhoto, OPEN_SOURCE_BUCKET } from "./open-source-photo";
import { StringListInput } from "./string-list-input";
import { PairListInput } from "./pair-list-input";

type Draft = {
  name: string;
  title: string;
  category: string;
  archiveNumber: string;
  photoStoragePath: string | null;
  photoUpdatedAt: string | null;
  tags: string[];
  quote: string;
  quoteAttribution: string;
  humanFacts: { label: string; value: string }[];
  builderFacts: { label: string; value: string }[];
  callMeFor: string[];
  chat: { question: string; answer: string }[];
  truthsAndLie: string[];
  soundtrack: { title: string; artist: string }[];
};

function emptyDraft(): Draft {
  return {
    name: "",
    title: "",
    category: "ENDOMARKETING",
    archiveNumber: "",
    photoStoragePath: null,
    photoUpdatedAt: null,
    tags: [],
    quote: "",
    quoteAttribution: "",
    humanFacts: [
      { label: "hobby", value: "" },
      { label: "comida que não dispensa", value: "" },
      { label: "série no momento", value: "" },
    ],
    builderFacts: [
      { label: "último agente construído", value: "" },
      { label: "o que jamais delegaria", value: "" },
    ],
    callMeFor: [],
    chat: [{ question: "", answer: "" }],
    truthsAndLie: ["", "", ""],
    soundtrack: [{ title: "", artist: "" }],
  };
}

function draftFromCard(card: OpenSourceCardRow): Draft {
  return {
    name: card.name,
    title: card.title ?? "",
    category: card.category,
    archiveNumber: String(card.archiveNumber),
    photoStoragePath: card.photoStoragePath,
    photoUpdatedAt: card.photoUpdatedAt,
    tags: card.tags,
    quote: card.quote ?? "",
    quoteAttribution: card.quoteAttribution ?? "",
    humanFacts: card.humanFacts.length ? card.humanFacts : [{ label: "", value: "" }],
    builderFacts: card.builderFacts.length ? card.builderFacts : [{ label: "", value: "" }],
    callMeFor: card.callMeFor,
    chat: card.chat.length ? card.chat : [{ question: "", answer: "" }],
    truthsAndLie: card.truthsAndLie.length ? card.truthsAndLie : ["", "", ""],
    soundtrack: card.soundtrack.length ? card.soundtrack : [{ title: "", artist: "" }],
  };
}

type Props = {
  open: boolean;
  card: OpenSourceCardRow | null;
  onClose: () => void;
  onSubmit: (values: OpenSourceCardInput) => void | Promise<void>;
};

export function OpenSourceSheet({ open, card, onClose, onSubmit }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // Reset the form when the sheet opens or switches cards. React's
  // "adjust state during render" pattern — no effect, no cascading renders.
  const formKey = open ? (card ? card.id : "new") : "closed";
  if (!open && loadedKey !== null) {
    setLoadedKey(null);
  } else if (open && formKey !== loadedKey) {
    setLoadedKey(formKey);
    setDraft(card ? draftFromCard(card) : emptyDraft());
  }

  const isEdit = Boolean(card);
  const canSave = draft.name.trim().length > 0 && !uploading && !saving;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function handlePickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    try {
      const { path } = await uploadResizedPhoto({
        bucket: OPEN_SOURCE_BUCKET,
        file,
      });

      // Remove a foto enviada anteriormente nesta sessão (evita órfãos).
      const prev = draft.photoStoragePath;
      if (prev && prev !== card?.photoStoragePath) {
        await removePhoto(OPEN_SOURCE_BUCKET, prev);
      }

      setDraft((d) => ({
        ...d,
        photoStoragePath: path,
        photoUpdatedAt: new Date().toISOString(),
      }));
    } catch (err) {
      if (err instanceof PhotoValidationError) toast.error(err.message);
      else showErrorToast(err, { label: "Falha ao subir foto" });
    } finally {
      setUploading(false);
    }
  }

  function handleRemovePhoto() {
    setDraft((d) => ({
      ...d,
      photoStoragePath: null,
      photoUpdatedAt: new Date().toISOString(),
    }));
  }

  async function handleSave() {
    if (!canSave) return;
    const parsedArchive = draft.archiveNumber.trim()
      ? Number(draft.archiveNumber.trim())
      : undefined;

    const values: OpenSourceCardInput = {
      name: draft.name.trim(),
      title: draft.title.trim() || null,
      category: draft.category.trim() || "ENDOMARKETING",
      archiveNumber:
        parsedArchive && Number.isFinite(parsedArchive) ? parsedArchive : undefined,
      photoStoragePath: draft.photoStoragePath,
      photoUpdatedAt: draft.photoUpdatedAt,
      tags: draft.tags.map((t) => t.trim()).filter(Boolean),
      quote: draft.quote.trim() || null,
      quoteAttribution: draft.quoteAttribution.trim() || null,
      humanFacts: draft.humanFacts.filter((f) => f.label.trim() || f.value.trim()),
      builderFacts: draft.builderFacts.filter(
        (f) => f.label.trim() || f.value.trim(),
      ),
      callMeFor: draft.callMeFor.map((t) => t.trim()).filter(Boolean),
      chat: draft.chat.filter((c) => c.question.trim() || c.answer.trim()),
      truthsAndLie: draft.truthsAndLie.map((t) => t.trim()).filter(Boolean),
      soundtrack: draft.soundtrack.filter((s) => s.title.trim() || s.artist.trim()),
    };

    setSaving(true);
    try {
      await onSubmit(values);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveSheet open={open} onOpenChange={(next) => !next && onClose()}>
      <ResponsiveSheetContent size="lg">
        <ResponsiveSheetHeader>
          <ResponsiveSheetTitle>
            {isEdit ? "Editar card" : "Novo card"}
          </ResponsiveSheetTitle>
        </ResponsiveSheetHeader>

        <ResponsiveSheetBody>
          <FormBody density="comfortable">
            {/* Foto */}
            <Field name="photo">
              <Field.Label>Foto</Field.Label>
              <div className="flex items-center gap-4">
                <OpenSourcePhoto
                  name={draft.name || "?"}
                  photoStoragePath={draft.photoStoragePath}
                  photoUpdatedAt={draft.photoUpdatedAt}
                  className="size-20"
                />
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept={PHOTO_ACCEPTED_MIME.join(",")}
                    onChange={handlePickPhoto}
                    className="hidden"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      <ImagePlus className="mr-1 size-3.5" />
                      {uploading
                        ? "Enviando…"
                        : draft.photoStoragePath
                          ? "Trocar foto"
                          : "Adicionar foto"}
                    </Button>
                    {draft.photoStoragePath ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={handleRemovePhoto}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="mr-1 size-3.5" />
                        Remover
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    PNG, JPG ou WEBP. Até 3 MB.
                  </p>
                </div>
              </div>
            </Field>

            <Field.Row cols={2}>
              <Field name="name" required>
                <Field.Label>Nome</Field.Label>
                <Field.Control>
                  <Input
                    value={draft.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="Ex: Vinícius Aguilar"
                  />
                </Field.Control>
              </Field>
              <Field name="title">
                <Field.Label>Cargo</Field.Label>
                <Field.Control>
                  <Input
                    value={draft.title}
                    onChange={(e) => set("title", e.target.value)}
                    placeholder="Ex: Product Builder"
                  />
                </Field.Control>
              </Field>
            </Field.Row>

            <Field.Row cols={2}>
              <Field name="category">
                <Field.Label>Categoria</Field.Label>
                <Field.Control>
                  <Input
                    value={draft.category}
                    onChange={(e) => set("category", e.target.value)}
                    placeholder="ENDOMARKETING"
                  />
                </Field.Control>
              </Field>
              <Field name="archiveNumber">
                <Field.Label>Número do arquivo</Field.Label>
                <Field.Control>
                  <Input
                    type="number"
                    value={draft.archiveNumber}
                    onChange={(e) => set("archiveNumber", e.target.value)}
                    placeholder={isEdit ? "" : "auto"}
                  />
                </Field.Control>
                <Field.Hint>Vazio = próximo número automático.</Field.Hint>
              </Field>
            </Field.Row>

            <Field name="tags">
              <Field.Label>Tags</Field.Label>
              <StringListInput
                values={draft.tags}
                onChange={(v) => set("tags", v)}
                placeholder="Ex: Claude Code, Cursor, GCP…"
              />
            </Field>

            <Field name="quote">
              <Field.Label>Citação</Field.Label>
              <Field.Control>
                <Textarea
                  value={draft.quote}
                  onChange={(e) => set("quote", e.target.value)}
                  placeholder="A frase de efeito do colaborador…"
                  rows={3}
                />
              </Field.Control>
            </Field>

            <Field name="quoteAttribution">
              <Field.Label>Assinatura da citação</Field.Label>
              <Field.Control>
                <Input
                  value={draft.quoteAttribution}
                  onChange={(e) => set("quoteAttribution", e.target.value)}
                  placeholder="Vazio = usa o nome"
                />
              </Field.Control>
            </Field>

            <Field name="humanFacts">
              <Field.Label>Humano</Field.Label>
              <PairListInput
                items={draft.humanFacts}
                onChange={(items) =>
                  set("humanFacts", items as Draft["humanFacts"])
                }
                fields={[
                  { key: "label", placeholder: "Rótulo (ex: hobby)" },
                  { key: "value", placeholder: "Valor (ex: Futevôlei)" },
                ]}
                addLabel="Adicionar fato"
              />
            </Field>

            <Field name="builderFacts">
              <Field.Label>Builder</Field.Label>
              <PairListInput
                items={draft.builderFacts}
                onChange={(items) =>
                  set("builderFacts", items as Draft["builderFacts"])
                }
                fields={[
                  { key: "label", placeholder: "Rótulo (ex: último agente construído)" },
                  { key: "value", placeholder: "Valor" },
                ]}
                addLabel="Adicionar fato"
              />
            </Field>

            <Field name="callMeFor">
              <Field.Label>Pode me chamar para</Field.Label>
              <StringListInput
                values={draft.callMeFor}
                onChange={(v) => set("callMeFor", v)}
                placeholder="Ex: criação de agentes…"
              />
            </Field>

            <Field name="chat">
              <Field.Label>Chat (perguntas e respostas)</Field.Label>
              <PairListInput
                items={draft.chat}
                onChange={(items) => set("chat", items as Draft["chat"])}
                fields={[
                  { key: "question", placeholder: "Pergunta" },
                  { key: "answer", placeholder: "Resposta", textarea: true },
                ]}
                addLabel="Adicionar pergunta"
              />
            </Field>

            <Field name="truthsAndLie">
              <Field.Label>2 verdades e 1 mentira</Field.Label>
              <StringListInput
                values={draft.truthsAndLie}
                onChange={(v) => set("truthsAndLie", v)}
                placeholder="Adicionar afirmação"
              />
              <Field.Hint>A mentira não é revelada — fica pro grupo adivinhar.</Field.Hint>
            </Field>

            <Field name="soundtrack">
              <Field.Label>Soundtrack</Field.Label>
              <PairListInput
                items={draft.soundtrack}
                onChange={(items) =>
                  set("soundtrack", items as Draft["soundtrack"])
                }
                fields={[
                  { key: "title", placeholder: "Música" },
                  { key: "artist", placeholder: "Artista" },
                ]}
                addLabel="Adicionar música"
              />
            </Field>
          </FormBody>
        </ResponsiveSheetBody>

        <ResponsiveSheetFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </ResponsiveSheetFooter>
      </ResponsiveSheetContent>
    </ResponsiveSheet>
  );
}
