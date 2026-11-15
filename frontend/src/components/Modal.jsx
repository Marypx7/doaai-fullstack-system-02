import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import './Modal.css';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  closeOnEscape = true,
  closeOnOverlay = true,
  labelledBy,
  className = ''
}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const generatedId = useId();
  const titleId = labelledBy || `${generatedId}-title`;
  const descriptionId = description ? `${generatedId}-description` : undefined;
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const focusable = dialog?.querySelectorAll(FOCUSABLE_SELECTOR);
    (focusable?.[0] || dialog)?.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape' && closeOnEscape) {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab' || !dialog) return;
      const currentFocusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)];
      if (currentFocusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      const activeIndex = currentFocusable.indexOf(document.activeElement);
      if (event.shiftKey && (activeIndex <= 0 || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeIndex === currentFocusable.length - 1 || activeIndex === -1)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open, closeOnEscape]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) onCloseRef.current?.();
      }}
    >
      <section
        ref={dialogRef}
        className={`modal ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <div className="modal__heading">
          <div className="modal__titles">
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button
            className="modal__close"
            type="button"
            aria-label="Fechar janela"
            onClick={() => onCloseRef.current?.()}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="modal__content">{children}</div>
      </section>
    </div>,
    document.body
  );
}
