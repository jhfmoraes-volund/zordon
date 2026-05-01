type WithId<T> = T & { id: string; updatedAt?: string | null };

export function reconcileById<T extends WithId<unknown>>(
  prev: T[],
  server: T,
): T[] {
  const idx = prev.findIndex((x) => x.id === server.id);
  if (idx === -1) return [...prev, server];

  const local = prev[idx];
  if (
    local.updatedAt &&
    server.updatedAt &&
    new Date(server.updatedAt).getTime() < new Date(local.updatedAt).getTime()
  ) {
    return prev;
  }

  const next = prev.slice();
  next[idx] = { ...local, ...server };
  return next;
}

export function reconcileMany<T extends WithId<unknown>>(
  prev: T[],
  servers: T[],
): T[] {
  let next = prev;
  for (const s of servers) next = reconcileById(next, s);
  return next;
}

export function replaceTempId<T extends WithId<unknown>>(
  prev: T[],
  tempId: string,
  real: T,
): T[] {
  const idx = prev.findIndex((x) => x.id === tempId);
  if (idx === -1) return reconcileById(prev, real);
  const next = prev.slice();
  next[idx] = real;
  return next;
}

export function removeById<T extends WithId<unknown>>(
  prev: T[],
  id: string,
): T[] {
  return prev.filter((x) => x.id !== id);
}

export function removeManyById<T extends WithId<unknown>>(
  prev: T[],
  ids: string[],
): T[] {
  const set = new Set(ids);
  return prev.filter((x) => !set.has(x.id));
}

export function patchById<T extends WithId<unknown>>(
  prev: T[],
  id: string,
  patch: Partial<T>,
): T[] {
  const idx = prev.findIndex((x) => x.id === id);
  if (idx === -1) return prev;
  const next = prev.slice();
  next[idx] = { ...next[idx], ...patch };
  return next;
}

export function patchManyById<T extends WithId<unknown>>(
  prev: T[],
  ids: string[],
  patch: Partial<T>,
): T[] {
  const set = new Set(ids);
  return prev.map((x) => (set.has(x.id) ? { ...x, ...patch } : x));
}

export const tempId = (prefix = "tmp"): string =>
  `${prefix}_${crypto.randomUUID()}`;

export const isTempId = (id: string): boolean => id.startsWith("tmp_");
