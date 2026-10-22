import { useEffect, useRef, useState } from "react";

/** The validated command drawer. Business mutations stay with the caller,
 * which owns CSRF, idempotency, If-Match, busy/error and revision refresh. */
export type Field = {
  name: string;
  label: string;
  type?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
};
export type Values = Record<string, string>;
export type Dialog = {
  title: string;
  fields: Field[];
  values?: Values;
  notice?: string;
  submit: (values: Values) => Promise<void>;
};

export function FormDialog({
  dialog,
  busy,
  error,
  close,
  submit,
  registerDismiss,
}: {
  dialog: Dialog;
  busy: boolean;
  error: string;
  close: () => void;
  submit: (v: Values) => void;
  registerDismiss?: (callback: (() => void) | null) => void;
}) {
  const [values, setValues] = useState<Values>(dialog.values || {});
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const root = useRef<HTMLFormElement>(null);
  const dirty = dialog.fields.some(
    (field) => (values[field.name] || "") !== (dialog.values?.[field.name] || ""),
  );
  const dismiss = () => {
    if (busy) return;
    if (dirty) setConfirmDiscard(true);
    else close();
  };
  useEffect(() => {
    registerDismiss?.(dismiss);
    return () => registerDismiss?.(null);
  }, [registerDismiss, dirty, busy, close]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current
      ?.querySelector<HTMLElement>("input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)")
      ?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-cover"
      onClick={dismiss}
    >
      <form
        ref={root}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            dismiss();
          }
          if (e.key === "Tab") {
            const controls = Array.from(
              root.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input,textarea,select",
              ) || [],
            );
            const first = controls[0],
              last = controls[controls.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
        onSubmit={(e) => {
          e.preventDefault();
          submit(values);
        }}
      >
        <div className="modal-top">
          <h2>{dialog.title}</h2>
          <button
            type="button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={dismiss}
          >
            ×
          </button>
        </div>
        {dialog.notice && <p>{dialog.notice}</p>}
        {confirmDiscard && (
          <div className="modal-discard-warning" role="alert">
            <p>Есть несохранённые изменения. Удалить введённый текст?</p>
            <div className="actions wrap">
              <button type="button" onClick={() => setConfirmDiscard(false)}>
                Продолжить редактирование
              </button>
              <button type="button" className="outline" onClick={close}>
                Удалить черновик
              </button>
            </div>
          </div>
        )}
        {dialog.fields.map((field) => (
          <label key={field.name}>
            {field.label}
            {field.options ? (
              <select
                required={field.required}
                value={values[field.name] || ""}
                onChange={(e) =>
                  setValues({ ...values, [field.name]: e.target.value })
                }
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                maxLength={field.name === "reason" ? 2000 : 5000}
                value={values[field.name] || ""}
                onChange={(e) =>
                  setValues({ ...values, [field.name]: e.target.value })
                }
              />
            ) : (
              <input
                type={field.type || "text"}
                required={field.required}
                min={field.type === "number" ? 1 : undefined}
                maxLength={
                  field.name === "title"
                    ? 180
                    : field.name === "name"
                      ? 120
                      : 5000
                }
                value={values[field.name] || ""}
                onChange={(e) =>
                  setValues({ ...values, [field.name]: e.target.value })
                }
              />
            )}
          </label>
        ))}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button disabled={busy} className="primary">
          {busy ? "Сохранение…" : "Подтвердить"}
        </button>
      </form>
    </div>
  );
}
