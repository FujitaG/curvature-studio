import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { useStudioStore } from '../state/store';
import { useProjectStore } from '../project/store';

export function ComputingChip(): JSX.Element | null {
  const computing = useStudioStore((state) => state.computing);
  const progress = useStudioStore((state) => state.progress);
  const error = useStudioStore((state) => state.computationError);
  const paused = useStudioStore((state) => state.computationPaused);
  const arranging = useStudioStore((state) => state.relax3dRunning);
  const layoutProgress = useStudioStore((state) => state.relax3dProgress);
  const layoutError = useStudioStore((state) => state.relax3dError);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!computing && !arranging) {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(() => setVisible(true), 250);
    return () => window.clearTimeout(timer);
  }, [computing, arranging]);

  if (arranging) return !visible ? null : <div className="computing-chip panel" role="status">
    <span className="spinner" aria-hidden="true" />
    <span>{t('Arranging 3D…')} {Math.round(layoutProgress * 100)}%</span>
    <button className="button" onClick={() => useStudioStore.getState().stopRelax3dLayout()}>{t('Stop')}</button>
  </div>;
  if (layoutError) return <div className="computing-chip panel" role="status">
    <span>{t(layoutError)}</span>
    <button className="button" onClick={() => useStudioStore.getState().relax3dLayout()}>{t('Retry')}</button>
    <button className="button" onClick={() => useStudioStore.getState().stopRelax3dLayout()}>{t('Dismiss')}</button>
  </div>;

  if (error || paused) return <div className="computing-chip panel" role="status"><span>{t(paused ? 'Calculation stopped' : 'Calculation failed')}</span><button className="button" onClick={() => useStudioStore.getState().retryComputation()}>{t("Retry")}</button><button className="button" onClick={() => useProjectStore.getState().setResultsOpen(true)}>{t("Details")}</button></div>;
  if (!computing || !visible) return null;

  const percent = progress > 0 ? ` ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` : '';
  return (
    <div className="computing-chip panel" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{t("computing curvatures…")}{percent}</span>
      <button className="button" onClick={() => useStudioStore.getState().stopComputation()}>{t("Stop")}</button>
    </div>
  );
}
