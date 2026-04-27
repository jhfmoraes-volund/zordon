"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";
import { SPECIALTIES, type Specialty } from "@/lib/roles";

const SENIORITIES = ["junior", "pleno", "senior", "principal"] as const;
type Seniority = (typeof SENIORITIES)[number];

export type ProfileInput = {
  specialty: Specialty;
  seniority: Seniority;
  githubUsername: string;
};

export type CapacityInput = {
  fpCapacity: number;
  dedicationPercent: number;
};

function assertOwn(memberId: string, currentMemberId: string) {
  if (memberId !== currentMemberId) {
    throw new Error("Forbidden — onboarding pertence a outro membro");
  }
}

export async function saveProfileStep(memberId: string, input: ProfileInput) {
  const me = await getCurrentMember();
  if (!me) throw new Error("Unauthorized");
  assertOwn(memberId, me.id);

  if (!SPECIALTIES.includes(input.specialty)) {
    throw new Error("Especialidade inválida");
  }
  if (!SENIORITIES.includes(input.seniority)) {
    throw new Error("Senioridade inválida");
  }
  const handle = input.githubUsername.trim().replace(/^@/, "");
  if (handle.length === 0 || handle.length > 39 || !/^[\w-]+$/.test(handle)) {
    throw new Error("Handle do GitHub inválido");
  }

  const { error } = await db()
    .from("Member")
    .update({
      specialty: input.specialty,
      seniority: input.seniority,
      githubUsername: handle,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", memberId);

  if (error) throw new Error(error.message);
}

export async function saveCapacityStep(memberId: string, input: CapacityInput) {
  const me = await getCurrentMember();
  if (!me) throw new Error("Unauthorized");
  assertOwn(memberId, me.id);

  const fp = Math.round(input.fpCapacity);
  const dedication = Math.round(input.dedicationPercent);
  if (fp < 0 || fp > 200) throw new Error("Capacidade fora do intervalo");
  if (dedication < 10 || dedication > 100) {
    throw new Error("Dedicação fora do intervalo");
  }

  const { error } = await db()
    .from("Member")
    .update({
      fpCapacity: fp,
      dedicationPercent: dedication,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", memberId);

  if (error) throw new Error(error.message);
}

export async function completeOnboarding(memberId: string) {
  const me = await getCurrentMember();
  if (!me) throw new Error("Unauthorized");
  assertOwn(memberId, me.id);

  const { error } = await db()
    .from("Member")
    .update({
      onboardedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", memberId);

  if (error) throw new Error(error.message);

  revalidatePath("/", "layout");
  redirect("/");
}
