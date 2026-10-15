import { t } from '../i18n';
import { isolatedVertexIds } from '../state/history';
import { useStudioStore } from '../state/store';

export function IsolatedVertexChip(): JSX.Element | null {
  const doc = useStudioStore((state) => state.doc);
  const computing = useStudioStore((state) => state.computing);
  const count = isolatedVertexIds(doc).length;

  if (count === 0) return null;

  return (
    <div className={`isolated-chip panel ${computing ? 'stacked' : ''}`} aria-live="polite">
      {t(count === 1 ? '{count} isolated vertex — curvature not defined there' : '{count} isolated vertices — curvature not defined there', { count })}
    </div>
  );
}
