import { redirect } from "next/navigation";

/**
 * Oportunidades virou o app "Inovação" no dock de Apps do cliente.
 * Preserva deep-links antigos redirecionando pro launcher com ?app=opportunities.
 */
export default async function OpportunitiesRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/clients/${id}/apps?app=opportunities`);
}
