import { ForgeShell } from "@/components/forge/forge-shell";

export const metadata = {
  title: "FORGE · Sandbox",
};

/**
 * Sandbox da Forja — roda o mock source (storyline ARCHITECT/SCOUT/WRITER/TESTER).
 * Permanece até a Fase 11 (realtime source) substituir o mock por dados reais.
 */
export default function ForgeSandboxPage() {
  return <ForgeShell />;
}
