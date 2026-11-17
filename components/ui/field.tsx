"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type ControlProps = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
  "aria-required"?: boolean | "true" | "false";
};

export interface FieldProps {
  /** The visible label. It names the control, so a placeholder never has to. */
  label: React.ReactNode;
  /** One line under the control, read with it. Hidden while there is an error. */
  hint?: React.ReactNode;
  /** The error under the control: read with it, announced, and marks it invalid. */
  error?: React.ReactNode;
  /** Draws the asterisk and sets aria-required on the control. */
  required?: boolean;
  /** Keep the label for screen readers only (a field whose look already says what it is). */
  hideLabel?: boolean;
  className?: string;
  labelClassName?: string;
  /** The one control (Input, select, textarea, ...). */
  children: React.ReactElement<ControlProps>;
}

/**
 * A labelled form field: label above, control, hint or error below (the
 * plugin kit's Field, for the app). The control gets an id when it has none,
 * the label points at it, and the hint or error is tied to it with
 * aria-describedby, so a screen reader reads all three together.
 *
 * ```tsx
 * <Field label={t("title")} error={titleError}>
 *   <Input value={title} onChange={...} />
 * </Field>
 * ```
 */
export function Field({ label, hint, error, required = false, hideLabel = false, className, labelClassName, children }: FieldProps) {
  const autoId = React.useId();
  const controlId = children.props.id ?? `${autoId}-control`;
  const noteId = `${autoId}-note`;
  const note = error || hint;
  const control = React.cloneElement(children, {
    id: controlId,
    "aria-describedby": [children.props["aria-describedby"], note ? noteId : null].filter(Boolean).join(" ") || undefined,
    ...(error ? { "aria-invalid": true } : {}),
    ...(required ? { "aria-required": true } : {}),
  });
  return (
    <div className={className}>
      <label
        htmlFor={controlId}
        className={cn(hideLabel ? "sr-only" : "block text-sm font-medium text-foreground mb-1.5", labelClassName)}
      >
        {label}
        {required && <span className="text-destructive" aria-hidden="true"> *</span>}
      </label>
      {control}
      {error ? (
        <p id={noteId} role="alert" className="mt-1 text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p id={noteId} className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
