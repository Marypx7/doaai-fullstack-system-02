import './Button.css';

export default function Button({
  children,
  as = 'button',
  variant = 'primary',
  type = 'button',
  loading = false,
  disabled = false,
  className = '',
  ...props
}) {
  const isDisabled = disabled || loading;
  const Component = as;

  return (
    <Component
      {...props}
      className={`button button--${variant} ${className}`.trim()}
      {...(Component === 'button' ? { type, disabled: isDisabled } : {})}
      aria-busy={loading || undefined}
    >
      {loading && <span className="button__spinner" aria-hidden="true" />}
      <span>{children}</span>
    </Component>
  );
}
