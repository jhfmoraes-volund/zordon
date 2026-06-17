"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Field, FormBody } from "@/components/ui/field";
import {
  MemberPhotoField,
  type MemberPhotoValue,
} from "@/components/members/member-photo-field";
import { fetchOrThrow, showErrorToast } from "@/lib/optimistic/toast";
import {
  SPECIALTIES,
  SPECIALTY_LABELS,
  roleLabel,
  specialtyLabel,
} from "@/lib/roles";
import type { SessionMember } from "@/contexts/auth-context";

/**
 * Edição self-service do próprio perfil (nome, especialidade, GitHub).
 * Cargo e nível de acesso ficam de fora — são admin-only, geridos em /members.
 */
export function ProfileEditDialog({
  open,
  onOpenChange,
  member,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: SessionMember;
}) {
  const router = useRouter();
  const [name, setName] = useState(member.name);
  const [specialty, setSpecialty] = useState("");
  const [githubUsername, setGithubUsername] = useState("");
  const [photo, setPhoto] = useState<MemberPhotoValue>({
    photoStoragePath: null,
    photoUpdatedAt: null,
  });
  // Foto que veio do servidor — não é apagada no cleanup de órfãos da sessão.
  const [initialPhotoPath, setInitialPhotoPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // specialty/githubUsername/foto não vivem no auth context — busca ao abrir.
  useEffect(() => {
    if (!open) return;
    setName(member.name);
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const { data } = await createClient()
        .from("Member")
        .select("specialty, githubUsername, photoStoragePath, photoUpdatedAt")
        .eq("id", member.id)
        .single();
      if (cancelled) return;
      setSpecialty(data?.specialty ?? "");
      setGithubUsername(data?.githubUsername ?? "");
      setPhoto({
        photoStoragePath: data?.photoStoragePath ?? null,
        photoUpdatedAt: data?.photoUpdatedAt ?? null,
      });
      setInitialPhotoPath(data?.photoStoragePath ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, member.id, member.name]);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await fetchOrThrow(`/api/members/${member.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          specialty: specialty || null,
          githubUsername: githubUsername.trim() || null,
          photoStoragePath: photo.photoStoragePath,
          photoUpdatedAt: photo.photoUpdatedAt,
        }),
      });
      toast.success("Perfil atualizado.");
      onOpenChange(false);
      router.refresh();
    } catch (error) {
      showErrorToast(error, { label: "Salvar perfil" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Editar perfil</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Cargo ({roleLabel(member.position)}) e nível de acesso são geridos
            pelo admin.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <FormBody>
            <Field name="photo">
              <Field.Label>Foto</Field.Label>
              <MemberPhotoField
                memberId={member.id}
                name={name}
                value={photo}
                initialStoragePath={initialPhotoPath}
                onChange={setPhoto}
              />
            </Field>
            <Field name="name" required>
              <Field.Label>Nome</Field.Label>
              <Field.Control>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                />
              </Field.Control>
            </Field>
            <Field name="specialty">
              <Field.Label>Especialidade</Field.Label>
              <Field.Control>
                <Select
                  value={specialty}
                  onValueChange={(v) => v && setSpecialty(v)}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {(value: string | null) => specialtyLabel(value)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SPECIALTIES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {SPECIALTY_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field.Control>
            </Field>
            <Field name="githubUsername">
              <Field.Label>GitHub username</Field.Label>
              <Field.Control>
                <Input
                  value={githubUsername}
                  onChange={(e) => setGithubUsername(e.target.value)}
                  placeholder="ex: octocat"
                  disabled={loading}
                />
              </Field.Control>
            </Field>
          </FormBody>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving || loading || !name.trim()}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
