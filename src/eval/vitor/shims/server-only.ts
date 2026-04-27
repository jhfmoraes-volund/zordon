/**
 * No-op shim for the `server-only` package, used in eval scripts that run
 * via tsx (outside Next.js). Aliased via tsconfig.eval.json paths.
 * Production builds still use the real package via Next.js webpack.
 */
export {};
