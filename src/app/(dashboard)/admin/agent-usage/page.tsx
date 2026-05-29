import { redirect } from "next/navigation";

export default async function LegacyAdminAgentUsageRedirect({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const params = await searchParams;
  const window = params.window ? `&window=${encodeURIComponent(params.window)}` : "";
  redirect(`/agents?tab=costs${window}`);
}
