import { notFound } from "next/navigation";

/**
 * `/forge-spike/*` is a developer sandbox (filesystem-based PRD governance + raw
 * run dispatch). The canonical, production Forge UI lives under
 * `/projects/[id]/forge/*`. This layout gates the whole spike tree to non-prod
 * so it can't be reached in production.
 */
export default function ForgeSpikeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <>{children}</>;
}
