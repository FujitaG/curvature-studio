import { t } from '../i18n';
import { useStudioStore } from '../state/store';

export function Toasts(): JSX.Element {
  const toasts = useStudioStore((state) => state.toasts);
  return (
    <div className="toast-stack" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast panel">
          {t(toast.message)}
        </div>
      ))}
    </div>
  );
}
