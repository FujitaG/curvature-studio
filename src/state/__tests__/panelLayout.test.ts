import { describe, expect, it } from 'vitest';
import { parsePanelLayout } from '../panelLayout';
import { captureProject, applyProject } from '../../project/workspace';
import { parseProjectJson } from '../../project/format';
import { getPanelLayout, setPanelLayout } from '../viewMemory';

describe('floating panel workspace settings', () => {
  it('defaults missing settings to an open guide and closed threshold controls', () => {
    const project = captureProject(); delete project.session.panelLayout;
    applyProject(parseProjectJson(project), false);
    expect(getPanelLayout()).toEqual({ guide: { collapsed: false }, thresholdExpanded: false });
  });
  it.each([false, true])('preserves positions and explicit collapsed=%s on project round trips', collapsed => {
    const layout = { guide: { collapsed, position: { x: 200, y: 240 } }, thresholdExpanded: true };
    setPanelLayout(layout);
    const first = captureProject();
    setPanelLayout(parsePanelLayout(undefined));
    applyProject(parseProjectJson(JSON.parse(JSON.stringify(first))), false);
    expect(captureProject().session.panelLayout).toEqual(layout);
    expect(captureProject().session.doc).toEqual(first.session.doc);
  });
  it.each([null, [], {}, { guide: { collapsed: 'false' }, thresholdExpanded: true }, { guide: { collapsed: false, position: { x: Infinity, y: 0 } }, thresholdExpanded: true }])('rejects invalid layout before any project state is applied: %j', raw => {
    const before = captureProject();
    expect(() => parseProjectJson({ ...before, session: { ...before.session, panelLayout: raw } })).toThrow(/panel|guide/i);
    expect(captureProject()).toEqual(before);
  });
});
