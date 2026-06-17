"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MemberAvatar } from "@/components/ui/member-avatar";
import { showErrorToast } from "@/lib/optimistic/toast";
import {
  MEMBER_PHOTO_BUCKET,
  PHOTO_ACCEPTED_MIME,
  PhotoValidationError,
  publicPhotoUrl,
  removePhoto,
  uploadResizedPhoto,
} from "@/lib/storage/photo";

export type MemberPhotoValue = {
  photoStoragePath: string | null;
  photoUpdatedAt: string | null;
};

/**
 * Campo de foto de membro reutilizável (perfil self-service + edição admin).
 * Sobe pro bucket member-photos namespaceado por `memberId` (a RLS amarra a
 * foto ao dono), faz cleanup do upload anterior desta sessão e devolve o novo
 * estado via `onChange`. NÃO persiste — quem renderiza salva (PUT /api/members).
 */
export function MemberPhotoField({
  memberId,
  name,
  value,
  initialStoragePath,
  onChange,
}: {
  memberId: string;
  name: string;
  value: MemberPhotoValue;
  /** Path vindo do servidor — preservado no cleanup (só apaga uploads da sessão). */
  initialStoragePath: string | null;
  onChange: (next: MemberPhotoValue) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const previewUrl = publicPhotoUrl(
    MEMBER_PHOTO_BUCKET,
    value.photoStoragePath,
    value.photoUpdatedAt,
  );

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    try {
      const { path } = await uploadResizedPhoto({
        bucket: MEMBER_PHOTO_BUCKET,
        file,
        dir: memberId,
      });
      const prev = value.photoStoragePath;
      if (prev && prev !== initialStoragePath) {
        await removePhoto(MEMBER_PHOTO_BUCKET, prev);
      }
      onChange({ photoStoragePath: path, photoUpdatedAt: new Date().toISOString() });
    } catch (err) {
      if (err instanceof PhotoValidationError) toast.error(err.message);
      else showErrorToast(err, { label: "Falha ao subir foto" });
    } finally {
      setUploading(false);
    }
  }

  function handleRemove() {
    onChange({ photoStoragePath: null, photoUpdatedAt: new Date().toISOString() });
  }

  return (
    <div className="flex items-center gap-4">
      <MemberAvatar name={name || "?"} avatarUrl={previewUrl} className="size-16 text-lg" />
      <div className="flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept={PHOTO_ACCEPTED_MIME.join(",")}
          onChange={handlePick}
          className="hidden"
        />
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
            : value.photoStoragePath
              ? "Trocar foto"
              : "Adicionar foto"}
        </Button>
        {value.photoStoragePath ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleRemove}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="mr-1 size-3.5" /> Remover
          </Button>
        ) : null}
      </div>
    </div>
  );
}
