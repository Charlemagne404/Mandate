import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
export function Modal({ children }: { children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prior = document.activeElement;
    container.current
      ?.querySelector<HTMLElement>('button,select,input,textarea,summary')
      ?.focus();
    return () => {
      if (prior instanceof HTMLElement) prior.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      ref={container}
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return;
        const targets = [
          ...container.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),select,input:not([hidden]),textarea,summary,[tabindex="0"]',
          ),
        ];
        const first = targets[0];
        const last = targets.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      {children}
    </div>
  );
}
