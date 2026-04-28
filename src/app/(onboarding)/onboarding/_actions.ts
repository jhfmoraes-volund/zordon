"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getCurrentMember } from "@/lib/dal";

export async function completeOnboarding(memberId: string) {
  const me = await getCurrentMember();
  if (!me) throw new Error("Unauthorized");
  if (memberId !== me.id) {
    throw new Error("Forbidden — onboarding pertence a outro membro");
  }

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
