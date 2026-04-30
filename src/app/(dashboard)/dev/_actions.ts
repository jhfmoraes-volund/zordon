"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentMember, getRealRole } from "@/lib/dal";
import { hasMinLevel, MANAGER } from "@/lib/roles";

/**
 * Zera o onboardedAt do membro atual e manda pra /onboarding pra testar
 * o flow do começo. Restrito a manager+ (mesmo gate do sandbox layout).
 */
export async function resetOwnOnboarding() {
  const realRole = await getRealRole();
  if (!hasMinLevel(realRole, MANAGER)) {
    throw new Error("Forbidden — apenas manager+");
  }

  const me = await getCurrentMember();
  if (!me) throw new Error("Unauthorized");

  // Bloqueia reset enquanto impersonando — caso contrário o admin acabaria
  // resetando o onboarding de outra pessoa.
  if (me._impersonatedBy) {
    throw new Error("Saia da impersonação antes de resetar");
  }

  const { error } = await db()
    .from("Member")
    .update({
      onboardedAt: null,
      updatedAt: new Date().toISOString(),
    })
    .eq("id", me.id);

  if (error) throw new Error(error.message);

  revalidatePath("/", "layout");
  redirect("/onboarding");
}
