"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldContextValue = {
  id: string;
  hintId: string;
  errorId: string;
  required: boolean;
  invalid: boolean;
  describedBy: string | undefined;
};

const FieldCtx = React.createContext<FieldContextValue | null>(null);

function useField(): FieldContextValue {
  const ctx = React.useContext(FieldCtx);
  if (!ctx) throw new Error("Field.* must be used inside <Field>");
  return ctx;
}

type FieldProps = {
  name?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
};

function Field({ name, required = false, error, children, className }: FieldProps) {
  const reactId = React.useId();
  const id = name ? `field-${name}-${reactId}` : `field-${reactId}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = Boolean(error);
  const describedBy = invalid ? errorId : undefined;

  const ctxValue = React.useMemo<FieldContextValue>(
    () => ({ id, hintId, errorId, required, invalid, describedBy }),
    [id, hintId, errorId, required, invalid, describedBy],
  );

  return (
    <FieldCtx.Provider value={ctxValue}>
      <div
        data-slot="field"
        data-invalid={invalid || undefined}
        className={cn("flex min-w-0 flex-col gap-(--field-gap)", className)}
      >
        {children}
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    </FieldCtx.Provider>
  );
}

type FieldLabelProps = {
  children: React.ReactNode;
  addon?: React.ReactNode;
  /** `"start"` (default) keeps addon next to label. `"end"` pushes it to the row's right edge — use for counters like "0/200". */
  addonAlign?: "start" | "end";
  className?: string;
};

function FieldLabel({ children, addon, addonAlign = "start", className }: FieldLabelProps) {
  const { id, required } = useField();
  return (
    <div
      className={cn(
        "flex items-center gap-1.5",
        addonAlign === "end" && "justify-between",
        className,
      )}
    >
      <Label
        htmlFor={id}
        className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {children}
        {required ? (
          <span aria-hidden className="text-destructive">
            *
          </span>
        ) : null}
      </Label>
      {addon}
    </div>
  );
}

type FieldControlProps = {
  children: React.ReactElement;
  className?: string;
};

/**
 * FieldControl injects `id`, `aria-describedby`, `aria-invalid`, `aria-required`
 * into the single child via React.cloneElement. Child must accept these props
 * (any native input/textarea/select/button does, plus our primitives that pass
 * `...props` through to base-ui).
 */
function FieldControl({ children, className }: FieldControlProps) {
  const { id, describedBy, invalid, required } = useField();

  if (!React.isValidElement(children)) {
    throw new Error("Field.Control expects a single React element child");
  }

  const child = children as React.ReactElement<Record<string, unknown>>;
  const childProps = child.props;
  const childClassName = typeof childProps.className === "string" ? childProps.className : undefined;

  // Two render paths:
  //  - leaf controls (Input, Textarea, native button) accept id/aria/className
  //    directly via cloneElement.
  //  - composite controls (Select wraps SelectTrigger; DropdownMenu wraps
  //    DropdownMenuTrigger) — base-ui Root has no DOM, so we wrap in a div
  //    that forces width on common trigger slots.
  const slot = typeof childProps["data-slot"] === "string" ? childProps["data-slot"] : undefined;
  const isLeaf =
    slot === "input" ||
    slot === "textarea" ||
    slot === "button" ||
    typeof child.type === "string";

  if (isLeaf) {
    return React.cloneElement(child, {
      id,
      "aria-describedby": describedBy,
      "aria-invalid": invalid || undefined,
      "aria-required": required || undefined,
      className: cn(childClassName, "w-full", className),
    });
  }

  return (
    <div
      className={cn(
        "w-full",
        "[&>[data-slot=select-trigger]]:w-full",
        "[&>[data-slot=dropdown-menu-trigger]]:w-full",
        className,
      )}
    >
      {children}
    </div>
  );
}

type FieldHintProps = {
  children: React.ReactNode;
  tone?: "default" | "warning";
};

function FieldHint({ children, tone = "default" }: FieldHintProps) {
  const { hintId } = useField();
  return (
    <p
      id={hintId}
      className={cn(
        "text-(length:--field-hint-size) leading-tight",
        tone === "default" && "text-muted-foreground",
        tone === "warning" && "text-amber-600 dark:text-amber-400",
      )}
    >
      {children}
    </p>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  const { errorId } = useField();
  return (
    <p
      id={errorId}
      role="alert"
      aria-live="polite"
      className="text-(length:--field-hint-size) leading-tight text-destructive"
    >
      {children}
    </p>
  );
}

type FieldRowProps = {
  cols?: 2 | 3;
  className?: string;
  children: React.ReactNode;
};

function FieldRow({ cols = 2, className, children }: FieldRowProps) {
  return (
    <div
      data-slot="field-row"
      className={cn(
        "grid items-start gap-(--field-col-gap)",
        cols === 2 && "grid-cols-2",
        cols === 3 && "grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

type FormBodyProps = {
  density?: "comfortable" | "compact";
  className?: string;
  children: React.ReactNode;
};

function FormBody({ density = "comfortable", className, children }: FormBodyProps) {
  return (
    <div
      data-slot="form-body"
      data-density={density}
      className={cn("flex flex-col gap-(--field-row-gap)", className)}
    >
      {children}
    </div>
  );
}

const FieldNamespace = Object.assign(Field, {
  Label: FieldLabel,
  Control: FieldControl,
  Hint: FieldHint,
  Error: FieldError,
  Row: FieldRow,
});

export { FieldNamespace as Field, FormBody };
