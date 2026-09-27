import { AlertCircle } from "lucide-react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  /** Путь поля для прокрутки к ошибке: data-field="specs.payload_kg". */
  name?: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, required, hint, error, name, aside, className, children }: FieldProps) {
  return (
    <div className={cx("field", error && "field--error", className)} data-field={name}>
      <div className="field__head">
        <label className="field__label" htmlFor={htmlFor}>
          {label}
          {required && (
            <span className="field__required" aria-label="обязательное поле">
              *
            </span>
          )}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p className="field__error" role="alert">
          <AlertCircle size={14} aria-hidden="true" />
          {error}
        </p>
      ) : (
        hint && <p className="field__hint">{hint}</p>
      )}
    </div>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  unit?: ReactNode;
  invalid?: boolean;
  icon?: ReactNode;
}

export function Input({ unit, invalid, icon, className, ...props }: InputProps) {
  return (
    <div className={cx("input", invalid && "input--invalid", props.disabled && "input--disabled", className)}>
      {icon && <span className="input__icon">{icon}</span>}
      <input {...props} aria-invalid={invalid || undefined} />
      {unit && <span className="input__unit">{unit}</span>}
    </div>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function TextArea({ invalid, className, ...props }: TextAreaProps) {
  return (
    <textarea
      className={cx("textarea", invalid && "textarea--invalid", className)}
      aria-invalid={invalid || undefined}
      rows={3}
      {...props}
    />
  );
}
