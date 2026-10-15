import { t } from '../i18n';
import { useEffect, useRef, type ReactNode } from 'react';

export function Dialog({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return (
    <dialog ref={ref} className={`studio-dialog panel ${className}`} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href], [tabindex="0"]')]
        .filter((element) => !element.hasAttribute('disabled') && element.offsetParent !== null);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="dialog-title"><h2>{title}</h2><button className="button" onClick={onClose} aria-label={t('Close {title}', { title })}>{t("Close")}</button></div>
      {children}
    </dialog>
  );
}
