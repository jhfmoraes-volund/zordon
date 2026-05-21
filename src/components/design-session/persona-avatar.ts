// Persona avatars são mocks visuais — não estão linkados à identidade real.
// 6 imagens em /public/persona-avatars/persona-{1..6}.jpg, mapeadas
// deterministicamente por hash do id da persona. Mesma persona → mesma foto
// sempre.

const TOTAL = 6;

// Simple deterministic hash → bucket [1..TOTAL]. Avoids importing crypto in
// the client bundle and is good enough for a mock display mapping.
function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function avatarFor(personaId: string): string {
  if (!personaId) return `/persona-avatars/persona-1.jpg`;
  const n = (hash(personaId) % TOTAL) + 1;
  return `/persona-avatars/persona-${n}.jpg`;
}
