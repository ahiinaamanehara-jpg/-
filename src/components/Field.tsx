import { useId, type InputHTMLAttributes } from "react";
export function Field({
  label,
  hint,
  id: suppliedId,
  "aria-describedby": describedBy,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const description =
    [hint ? `${id}-hint` : undefined, describedBy].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p id={`${id}-hint`}>{hint}</p>}
      <input {...props} id={id} aria-describedby={description} />
    </div>
  );
}
