"use client";

import { useEffect } from "react";
import { useAlphaChat } from "./store";

/**
 * Registra o atalho ⌘⇧A (Mac) / Ctrl+Shift+A (Win/Linux) pra toggle do Alpha.
 *
 * Importante: NÃO dispara quando o foco está em input/textarea/contentEditable
 * — assim "selecionar tudo" do sistema (⌘A) e digitar maiúscula 'A' continuam
 * funcionando normalmente.
 */
export function useAlphaKeyboard() {
  const { enabled, toggle } = useAlphaChat();

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || !e.shiftKey) return;
      if (e.key !== "A" && e.key !== "a") return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA";
      if (isEditable) return;

      e.preventDefault();
      toggle();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, toggle]);
}
