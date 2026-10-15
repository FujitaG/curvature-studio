import { useProjectStore } from '../project/store';
import { useEffect, useId, useRef, useState } from 'react';
import { PanelOptions } from './ViewMenu';
import { usePopoverDismiss } from './usePopoverDismiss';

/** Always-visible entry point; shares preferences with the overflow menu. */
export function PanelsButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), popup = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, () => setOpen(false), [popup, trigger]);
  useEffect(() => { if (open) popup.current?.querySelector<HTMLInputElement>('input')?.focus(); }, [open]);
  return <div className="panels-control" onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} className={`button panels-trigger ${open ? 'active' : ''}`} aria-expanded={open} aria-controls={id} aria-haspopup="dialog" onClick={() => setOpen(!open)}>Panels</button>
    {open ? <div ref={popup} id={id} className="panels-popover panel" role="dialog" aria-label="Panels">
      <div className="panels-heading"><strong>Panels & views</strong><button className="button" aria-label="Close Panels" onClick={() => { setOpen(false); trigger.current?.focus(); }}>Close</button></div>
      <PanelOptions onOpenDetails={() => { setOpen(false); trigger.current?.focus(); useProjectStore.getState().setCalculationDetailsOpen(true); }} />
    </div> : null}
  </div>;
}
