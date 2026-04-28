/**
 * Neutralizes the "server-only" guard so server-side modules
 * (db.ts, agent/context.ts, ...) can be imported from a tsx CLI script.
 *
 * Used via `tsx --require scripts/_server-only-shim.cjs scripts/vitor-cli.ts`.
 */
const Module = require("node:module");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "server-only") {
    return require.resolve("./_server-only-noop.cjs", { paths: [__dirname] });
  }
  return originalResolve.call(this, request, parent, ...rest);
};
