"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { showErrorToast } from "@/lib/optimistic/toast";
import { toast } from "sonner";
import { useClientContext } from "../_context/client-context";
import { ClientLogo } from "./client-logo";

const ACCEPTED_MIME = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_DIMENSION = 512;

function extensionFor(file: File): string {
  switch (file.type) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "png";
  }
}

async function resizeRaster(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    const scale = Math.min(
      1,
      MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context indisponível");
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("toBlob falhou"))),
        file.type,
        0.9,
      );
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function LogoUploader() {
  const { client, updateClient } = useClientContext();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  if (!client) return null;

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!client) return;
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!ACCEPTED_MIME.includes(file.type)) {
      toast.error("Formato não suportado. Use PNG, JPG, WEBP ou SVG.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("Arquivo maior que 2 MB.");
      return;
    }

    setBusy(true);
    try {
      const ext = extensionFor(file);
      const newPath = `${client.id}/logo.${ext}`;
      const body = file.type === "image/svg+xml" ? file : await resizeRaster(file);

      const { error: upErr } = await supabase.storage
        .from("client-logos")
        .upload(newPath, body, {
          upsert: true,
          contentType: file.type,
          cacheControl: "3600",
        });
      if (upErr) throw new Error(upErr.message);

      // Se o path antigo apontava pra extensão diferente, remove o arquivo órfão.
      const prev = client.logoStoragePath;
      if (prev && prev !== newPath) {
        await supabase.storage.from("client-logos").remove([prev]);
      }

      const updated = await updateClient({
        logoStoragePath: newPath,
        logoUpdatedAt: new Date().toISOString(),
      });
      if (updated) toast.success("Logo atualizado.");
    } catch (err) {
      showErrorToast(err, { label: "Falha ao subir logo" });
    } finally {
      setBusy(false);
    }
  }

  function handleRemove() {
    if (!client?.logoStoragePath) return;
    setConfirm({
      title: "Remover logo?",
      description: "O logo atual será apagado e o cliente voltará a usar as iniciais.",
      destructive: true,
      confirmLabel: "Remover",
      onConfirm: async () => {
        if (!client?.logoStoragePath) return;
        setBusy(true);
        try {
          const { error } = await supabase.storage
            .from("client-logos")
            .remove([client.logoStoragePath]);
          if (error) throw new Error(error.message);
          await updateClient({
            logoStoragePath: null,
            logoUpdatedAt: new Date().toISOString(),
          });
          toast.success("Logo removido.");
        } catch (err) {
          showErrorToast(err, { label: "Falha ao remover logo" });
        } finally {
          setBusy(false);
        }
      },
    });
  }

  return (
    <>
      <div className="flex items-center gap-4">
        <ClientLogo
          name={client.name}
          logoStoragePath={client.logoStoragePath}
          logoUpdatedAt={client.logoUpdatedAt}
          size="lg"
        />
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_MIME.join(",")}
            onChange={handlePick}
            className="hidden"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              <ImagePlus className="h-3.5 w-3.5 mr-1" />
              {client.logoStoragePath ? "Trocar logo" : "Adicionar logo"}
            </Button>
            {client.logoStoragePath ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={handleRemove}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Remover
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPG, WEBP ou SVG. Até 2 MB. Raster é redimensionado pra {MAX_DIMENSION}px.
          </p>
        </div>
      </div>

      <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
