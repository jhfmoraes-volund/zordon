import { useEffect, useState } from "react";

export type ProjectAccessVia =
  | "manager"
  | "project_access"
  | "grant_only"
  | "none";

export type MyProjectAccess = {
  /** null enquanto carrega. */
  via: ProjectAccessVia | null;
  /** capabilityKeys concedidas neste projeto (só relevante em grant_only). */
  grantedCapabilities: string[];
};

/**
 * Como o usuário alcança este projeto (GET /api/projects/[id]/my-access).
 * Em grant_only a page restringe o dock ao app/ritual concedido.
 */
export function useMyProjectAccess(projectId: string): MyProjectAccess {
  const [via, setVia] = useState<ProjectAccessVia | null>(null);
  const [grantedCapabilities, setGrantedCapabilities] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/my-access`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        setVia(d.via as ProjectAccessVia);
        setGrantedCapabilities((d.grantedCapabilities as string[]) ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { via, grantedCapabilities };
}
