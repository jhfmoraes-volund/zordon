import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/dal";
import { OnboardingClient } from "./client";

export default async function OnboardingPage() {
  const member = await getCurrentMember();

  if (!member) {
    // Sem Member linkado — não dá pra onboardar; manda pro login.
    redirect("/login");
  }

  // Já completou — não força a refazer.
  if (member.onboardedAt) {
    redirect("/");
  }

  return (
    <OnboardingClient
      member={{
        id: member.id,
        name: member.name,
      }}
    />
  );
}
