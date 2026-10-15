import { useStudioStore } from '../state/store';
import { Dialog } from './Dialog';
import { t } from '../i18n';
import { shortcut } from '../shortcuts';
import { theoryTemplates as templates } from '../data/templateCore';
import { stampTemplate } from '../data/templateActions';

const rows: Array<[string, string]> = [
  ['V / B / S / E', 'select / bond / brace / erase tool'],
  ['T', 'toggle 2D / 3D'],
  ['M', 'cycle metric'],
  ['F or double-click empty', 'fit view (select tool)'],
  ['L', 'toggle edge labels'],
  [shortcut('k'), 'templates'],
  [`${shortcut('s')} / ${shortcut('o')}`, 'save / open project'],
  [`${shortcut('z')} / ${shortcut('shift+z')}`, 'undo, redo'],
  [shortcut('a'), 'select all'],
  ['Delete / Backspace', 'delete selection'],
  ['Esc', 'cancel drag / clear selection'],
  ['wheel', 'zoom (2D) / dolly (3D)'],
  ['right-drag, middle-drag, Space+drag', 'pan (2D)'],
  ['left-drag / right-drag or Shift+drag', 'orbit / pan (3D)']
];

export function ShortcutSheet(): JSX.Element | null {
  const open = useStudioStore((state) => state.shortcutSheetOpen);
  const setOpen = useStudioStore((state) => state.setShortcutSheetOpen);
  if (!open) return null;
  return (
    <Dialog title={t("Quick guide")} onClose={() => setOpen(false)}>
        <ol className="guide-steps">
          <li><strong>{t("Start with a shape.")}</strong>{' '}{t("Choose Cube or K₄ on the empty canvas, or open Templates for more graphs.")}</li>
          <li><strong>{t("Edit the graph.")}</strong>{' '}{t("Bond draws contacts; Brace ties vertices into one rigid unit. Use Select to move items. Undo and Redo are next to the project name.")}</li>
          <li><strong>{t("Read the results.")}</strong>{' '}{t("Switch between the two curvature measures. Open Results to find an edge, see exact Ollivier fractions, or check convergence. Click its edge number to locate it.")}</li>
          <li><strong>{t("Keep your work.")}</strong>{' '}{t("Name the project, add notes, then Save project. Open project restores the complete workspace. Legacy document and session files are also supported.")}</li>
        </ol>
        <p className="muted">{t("All graph calculations and file reads happen in your browser. Autosave belongs to this browser and site address. A downloaded project is your portable copy.")}</p>
        <h3>Move to another browser or site address</h3>
        <p>On the old address, use Save project, or Save comparison (A + B) if you used Compare. On the new address, use Open project. The comparison file keeps both structures even in Single view. Browser autosave does not sync between addresses or devices.</p>
        <h3>{t('Bond and Brace')}</h3>
        <dl className="term-glossary">
          <dt>{t('Bond (contact)')}</dt><dd>{t('An edge whose curvature is calculated between rigid units.')}</dd>
          <dt>{t('Brace (rigid tie)')}</dt><dd>{t('Joins its endpoints into the same unit. It has no curvature value of its own.')}</dd>
          <dt>{t('Quotient bond')}</dt><dd>{t('A connection after merging rigid units. Several drawn bonds may count as one connection.')}</dd>
          <dt>{t('Converged')}</dt><dd>{t('The calculation reached its numerical stopping tolerance. This does not certify a mathematical proof.')}</dd>
        </dl>
        <button className="button" onClick={() => {
          const example = templates.find((entry) => entry.id === 'bond-brace-example')!;
          if (stampTemplate(example)) { setOpen(false); useStudioStore.getState().pushToast(t('Example added: one Bond and one Brace. The Brace joins two vertices into one unit.')); }
        }}>{t('Add Bond / Brace example')}</button>
        <h3>{t("Choose the right export")}</h3>
        <p><strong>{t("Project:")}</strong>{' '}{t("resume editing.")}{' '}<strong>{t("CSV:")}</strong>{' '}{t("analyze drawn-edge values in a spreadsheet.")}{' '}<strong>{t("Results JSON:")}</strong>{' '}{t("archive inputs and numerical provenance.")}{' '}<strong>{t("SVG / PNG:")}</strong>{' '}{t("share a figure.")}</p>
        <h3>{t("Shortcuts")}</h3>
        {rows.map(([key, action]) => (
          <div className="shortcut-row" key={key}>
            <div>{t(key)}</div>
            <div>{t(action)}</div>
          </div>
        ))}
    </Dialog>
  );
}
