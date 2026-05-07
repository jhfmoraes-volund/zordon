import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Forms standardization (docs/forms-standardization-plan.md):
// no fixed h-8/h-9/h-10/h-11 in form call-sites. Altura vem de --field-h
// via primitivos. Allowlist explícita de primitivos canônicos abaixo.
const FORM_HEIGHT_RESTRICT = {
  selector:
    "Literal[value=/(^|\\s)(h|min-h)-(8|9|10|11)(\\s|$)/], TemplateElement[value.raw=/(^|\\s)(h|min-h)-(8|9|10|11)(\\s|$)/]",
  message:
    "Form controls usam --field-h via primitivos (Input/Select/Textarea/Button[size=field]). Não use h-8/h-9/h-10/h-11 fixo. Ver docs/forms-standardization-plan.md.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: [
      // Project-scope forms (docs/forms-standardization-plan.md §2)
      "src/components/story-hierarchy/story-sheet.tsx",
      "src/components/story-hierarchy/task-sheet.tsx",
      "src/components/story-hierarchy/dialogs.tsx",
      "src/components/story-hierarchy/task-clone-dialog.tsx",
      "src/components/story-hierarchy/task-duplicate-dialog.tsx",
      "src/components/story-hierarchy/dependencies-block.tsx",
      "src/components/sprint-dialog.tsx",
      "src/app/(dashboard)/projects/page.tsx",
    ],
    rules: {
      "no-restricted-syntax": ["error", FORM_HEIGHT_RESTRICT],
    },
  },
]);

export default eslintConfig;
