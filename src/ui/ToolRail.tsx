import { t } from '../i18n';
import { Icon } from './icons';
import { useStudioStore } from '../state/store';
import type { ToolMode } from '../state/types';
import { Tooltip } from './Tooltip';

const tools: Array<[ToolMode, string]> = [
  ['select', 'Select — V'],
  ['bond', 'Bond — B'],
  ['brace', 'Brace — S'],
  ['erase', 'Erase — E']
];

export function ToolRail(): JSX.Element {
  const active = useStudioStore((state) => state.tool);
  const setTool = useStudioStore((state) => state.setTool);
  return (
    <div className="tool-rail" role="toolbar" aria-label={t("Drawing tools")}>
      {tools.map(([tool, label]) => (
        <Tooltip key={tool} content={t(label)} placement="right">
          <button className={`tool-button ${active === tool ? 'active' : ''}`} aria-label={t(label)} aria-pressed={active === tool} onClick={() => setTool(tool)}>
            <Icon name={tool} />
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
