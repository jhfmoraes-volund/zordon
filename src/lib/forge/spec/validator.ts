/**
 * Validator for spec.md files.
 *
 * Combines parsing + Zod schema validation.
 * Returns a validated Spec object or a list of errors with line:col information.
 */
import { parseSpec } from "./parser";
import { SpecSchema } from "./schema";
import type { Spec } from "./schema";
import type { ParseError } from "./parser";
import { ZodError } from "zod";

export type ValidationError = ParseError;

export type ValidationResult =
  | { ok: true; spec: Spec }
  | { ok: false; errors: ValidationError[] };

/**
 * Validate a spec.md file.
 *
 * Steps:
 * 1. Parse the markdown into structured sections
 * 2. Validate against Zod schema
 * 3. Return validated Spec or errors with line:col info
 */
export function validateSpec(path: string): ValidationResult {
  // Step 1: Parse
  const parseResult = parseSpec(path);
  if (!parseResult.ok) {
    return { ok: false, errors: parseResult.errors };
  }

  // Step 2: Validate with Zod
  try {
    const validated = SpecSchema.parse(parseResult.spec);
    return { ok: true, spec: validated };
  } catch (err) {
    if (err instanceof ZodError) {
      const errors: ValidationError[] = err.issues.map((e) => ({
        line: 0, // Zod errors don't have line info; could enhance later
        column: 0,
        message: `${e.path.join(".")}: ${e.message}`,
        section: e.path[0]?.toString(),
      }));
      return { ok: false, errors };
    }

    return {
      ok: false,
      errors: [{ line: 0, column: 0, message: `Validation failed: ${err}` }],
    };
  }
}
