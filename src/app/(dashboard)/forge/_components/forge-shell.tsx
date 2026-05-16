"use client";

import { ForgeProvider } from "@/hooks/use-forge-store";
import { ForgeHud } from "./forge-hud";
import { ForgeStage } from "./forge-stage";
import { ForgeControls } from "./forge-controls";
import { ForgeLogo } from "./forge-logo";

export function ForgeShell() {
  return (
    <ForgeProvider>
      <div className="container mx-auto max-w-6xl space-y-6 p-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <ForgeLogo />
          <ForgeControls />
        </header>

        <ForgeHud />

        <ForgeStage />
      </div>
    </ForgeProvider>
  );
}
