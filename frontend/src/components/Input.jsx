import { useId } from 'react';
import './Input.css';

export default function Input({
  label,
  type = 'text',
  as = 'input',
  id,
  error,
  hint,
  className = '',
  ...props
}) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const Component = as === 'textarea' ? 'textarea' : 'input';
  const describedBy = [
    hint ? hintId : null,
    error ? errorId : null
  ].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`field ${className}`.trim()}>
      {label && <label className="field__label" htmlFor={fieldId}>{label}</label>}
      <Component
        {...props}
        id={fieldId}
        type={Component === 'input' ? type : undefined}
        className={`field__control${error ? ' field__control--error' : ''}`}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
      />
      {hint && !error && <span className="field__hint" id={hintId}>{hint}</span>}
      {error && <span className="field__error" id={errorId} role="alert">{error}</span>}
    </div>
  );
}
