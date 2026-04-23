import { redirect } from "next/navigation";

export default async function AgentIndex({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/agents/${slug}/settings`);
}
