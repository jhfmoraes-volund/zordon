/**
 * Layout sem gate global — o acesso por session é gateado nas API routes via
 * `requireSessionAccessApi` (que respeita DS.visibility), e cada page server-side
 * faz seu próprio check. Guests podem entrar em DS marcadas como `public`.
 */
export default async function DesignSessionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
