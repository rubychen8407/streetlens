import { useEffect, useRef } from 'react';

/** Non-modal map panels keep keyboard access to the map and restore the opener. */
export function usePanelFocus(open: boolean, onClose: () => void, dismissible = true) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  closeRef.current = onClose;
  dismissibleRef.current = dismissible;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? panelRef.current)?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissibleRef.current && panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        closeRef.current();
        const target = (opener?.isConnected && opener !== document.body)
          ? opener
          : document.querySelector<HTMLElement>('button[aria-label="CLS 評估"]');
        target?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('keydown', escape);
      const target = (opener?.isConnected && opener !== document.body)
        ? opener
        : document.querySelector<HTMLElement>('button[aria-label="CLS 評估"]');
      target?.focus({ preventScroll: true });
      if (document.activeElement !== target) {
        target?.focus();
      }
    };
  }, [open]);
  return panelRef;
}
