"use client";

import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
} from "@/components/ui/responsive-dialog";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallAppButton() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [iosSheetOpen, setIosSheetOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS-only Safari API
      window.navigator.standalone === true;
    setIsStandalone(standalone);

    const ua = window.navigator.userAgent.toLowerCase();
    const iOS =
      /iphone|ipad|ipod/.test(ua) ||
      (ua.includes("mac") && "ontouchend" in document);
    setIsIOS(iOS);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (isStandalone) return null;

  // iOS Safari has no install prompt — show instructions instead
  if (isIOS && !deferredPrompt) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setIosSheetOpen(true)}
        >
          <Download className="h-3.5 w-3.5" />
          Instalar app
        </Button>
        <ResponsiveDialog open={iosSheetOpen} onOpenChange={setIosSheetOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>Instalar no iOS</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Para instalar como app:
              </ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <ResponsiveDialogBody>
              <ol className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <span className="font-mono text-muted-foreground">1.</span>
                  <span>
                    Toque em <Share className="inline h-4 w-4 align-text-bottom" />{" "}
                    <strong>Compartilhar</strong> na barra do Safari
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono text-muted-foreground">2.</span>
                  <span>
                    Role e toque em <strong>Adicionar à Tela de Início</strong>
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-mono text-muted-foreground">3.</span>
                  <span>
                    Toque em <strong>Adicionar</strong> no canto superior direito
                  </span>
                </li>
              </ol>
            </ResponsiveDialogBody>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </>
    );
  }

  if (!deferredPrompt) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={async () => {
        await deferredPrompt.prompt();
        const result = await deferredPrompt.userChoice;
        if (result.outcome === "accepted") setDeferredPrompt(null);
      }}
    >
      <Download className="h-3.5 w-3.5" />
      Instalar app
    </Button>
  );
}
