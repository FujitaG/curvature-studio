import { useSyncExternalStore } from 'react';
import { getPanelLayout, setPanelLayout, subscribePanelLayout } from '../state/viewMemory';
import { shortcut } from '../shortcuts';
import { focusGraphCanvas } from './navigation';
import { useFloatingPanel } from './useFloatingPanel';
import { t } from '../i18n';
import { useStudioStore } from '../state/store';

export function InteractionGuide(): JSX.Element {
  const layout = useSyncExternalStore(subscribePanelLayout, getPanelLayout);
  const shortcuts = useStudioStore(state => state.panels.legend);
  const floating = useFloatingPanel(layout.guide.position ?? null, position => setPanelLayout({ ...getPanelLayout(), guide: { collapsed: getPanelLayout().guide.collapsed, ...(position ? { position } : {}) } }));
  const tool = useStudioStore((state) => state.tool);
  const view = useStudioStore((state) => state.view);
  const descriptions = {
    select: view === '2d' ? 'Select: click an item; drag vertices to move them. Wheel to zoom, right-drag to pan.' : 'Select: drag vertices to move them. Drag empty space to rotate.',
    bond: view === '2d' ? 'Bond: drag to draw a contact edge. Click an existing edge to convert it.' : 'Bond: drag between existing vertices to connect them. Add new vertices in 2D.',
    brace: view === '2d' ? 'Brace: drag to tie vertices into one rigid unit. Click an edge to convert it.' : 'Brace: drag between existing vertices to make one rigid unit.',
    erase: 'Erase: click an item to delete it. Deleting a vertex also removes its edges.'
  };
  const brief = {
    select: view === '2d' ? 'Select: click items; drag vertices to move.' : 'Select: drag vertices to move; empty space to rotate.',
    bond: 'Bond: drag to connect vertices.',
    brace: 'Brace: drag to join one rigid unit.',
    erase: 'Erase: click an item to delete it.'
  };
  const keys = view === '2d'
    ? [['B', 'Bond'], ['V', 'Select'], ['F', 'Fit view'], [shortcut('z'), 'Undo']]
    : [['Drag blank', 'Rotate'], ['Wheel', 'Zoom'], ['F', 'Fit view'], [shortcut('z'), 'Undo']];
  return <div ref={floating.ref} className={`interaction-guide panel ${layout.guide.collapsed ? 'collapsed' : ''} ${floating.dragging ? 'panel-dragging' : ''}`} style={floating.style} role="region" aria-label="Interaction guide">
    <div className="floating-panel-title" aria-label="Move interaction guide" {...floating.titleProps}>
      <span>Interaction guide</span>
      <span className="panel-actions">
        <button className="icon-button" aria-label={layout.guide.collapsed ? 'Expand interaction guide' : 'Collapse interaction guide'} aria-expanded={!layout.guide.collapsed} onClick={() => setPanelLayout({ ...layout, guide: { ...layout.guide, collapsed: !layout.guide.collapsed } })}>{layout.guide.collapsed ? '+' : '−'}</button>
        <button className="icon-button" aria-label="Hide interaction guide" title="Restore from Panels" onClick={() => { useStudioStore.getState().setPanelVisible('hints', false); focusGraphCanvas(); }}>×</button>
      </span>
    </div>
    {!layout.guide.collapsed ? <div className="interaction-guide-body">
      <p role="status"><span className="guide-description">{t(descriptions[tool])}</span><span className="guide-description-brief">{brief[tool]}</span></p>
      {shortcuts ? <div className="guide-shortcuts" role="group" aria-label="Quick shortcuts">
        {keys.map(([key, action]) => <span key={key}><kbd>{key}</kbd> {action}</span>)}
      </div> : null}
      <button className="mini-button guide-more" aria-label="Open full guide" onClick={() => useStudioStore.getState().setShortcutSheetOpen(true)}>Full guide &amp; shortcuts <kbd>?</kbd></button>
    </div> : null}
  </div>;
}
