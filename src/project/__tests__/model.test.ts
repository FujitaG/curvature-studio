import { expect, it } from 'vitest';
import cube from '../../../examples/cube-study.curvature.json';
import comparison from '../../../examples/cube-comparison.curvature-workspace.json';
import { templates, cycleTemplate, prismTemplate, antiprismTemplate } from '../../data/templates';
import { computationKey } from '../../math/graph';
import { DEFAULT_FIGURE } from '../../export/figure';
import { parseWorkspace } from '../../comparison/format';
import { parseProjectJson, projectToJson } from '../format';
import { modelToProject, projectToModel, modelToWorkspace, workspaceToModel } from '../model';

const canonical = (v: unknown) => projectToJson(parseProjectJson(v, 'Wrapped once', false));
it('preserves canonical examples and independent hidden/native/shared comparison presentation', () => {
  const a = canonical(cube);
  expect(modelToProject(projectToModel(a))).toEqual(a);
  const w = parseWorkspace(comparison);
  w.mode = 'single'; w.activeId = w.documents[0].id;
  w.documents[0].project.session.style.view2d.bondWidth = 3;
  w.documents[1].project.session.style.shared.metricGradients.keff = { type: 'threshold', threshold: .3, width: .2, lowColor: '#000000', highColor: '#FFFFFF' };
  w.documents[1].project.metadata.notes = 'Hidden B 日本語';
  w.colors.metricGradients.keff = { type: 'threshold', threshold: .7, width: .1, lowColor: '#FF0000', highColor: '#00FF00' };
  w.extensions = { 'org.example': { reserved: true } };
  expect(modelToWorkspace(workspaceToModel(w))).toEqual(w);
});
it.each([...templates.filter(t => t.vertices3d.length), cycleTemplate(12), prismTemplate(12), antiprismTemplate(12)])('round-trips template $id without layout affecting input identity', template => {
  const p = canonical(cube);
  p.session.doc.vertices = template.layout2d.map(([x,y], i) => ({ id: i + 1, x, y, p3: template.vertices3d[i], baked3d: i % 2 === 0 }));
  p.session.doc.edges = template.edges.map(([a,b],i) => ({ id:i+1,a:a+1,b:b+1,kind:template.braceEdges?.some(([u,v]) => (u===a && v===b) || (u===b && v===a)) ? 'brace' : 'bond',weight:1 }));
  const c = canonical(p), m = projectToModel(c);
  expect(modelToProject(m)).toEqual(c);
  const key = computationKey(m.graph.vertices, m.graph.edges);
  m.layout2d.forEach(v => { v.x += 100; v.y -= 20; });
  m.layout3d.forEach(v => { if (v.p3) v.p3[2] += 5; });
  m.presentation.style.view2d.bondWidth = 9;
  m.figure = { ...DEFAULT_FIGURE, background: 'transparent' };
  const modified = modelToProject(m);
  expect(computationKey(modified.session.doc.vertices, modified.session.doc.edges as never)).toBe(key);
});
it('preserves absent p3 and false pins, large IDs and large unknown extensions without aliasing', () => {
  const p = canonical(cube);
  p.session.doc.vertices = [{ id: Number.MAX_SAFE_INTEGER - 1, x: 1e6, y: -1e6, baked3d: false }, { id: 2, x:0, y:0 }];
  p.session.doc.edges = [];
  p.extensions = { 'org.example.future': { data: Array(1000000).fill(0), note: '任意😀' } };
  const m = projectToModel(p), restored = modelToProject(m);
  expect(restored).toEqual(canonical(p));
  expect(restored.session.doc.vertices.every(v => !('p3' in v))).toBe(true);
  m.presentation.camera2d.tx++;
  expect(p.session.camera2d.tx).not.toBe(m.presentation.camera2d.tx);
});
it('wraps legacy inputs once, then preserves their IDs through repeated conversion', () => {
  for (const legacy of [cube.session.doc, cube.session, { ...cube.session, version: 1 }]) {
    const p = canonical(legacy);
    expect(modelToProject(projectToModel(modelToProject(projectToModel(p))))).toEqual(p);
  }
});
it('requires legacy wrapping before the adapter and never repairs comparison cameras', () => {
  expect(()=>projectToModel(cube.session.doc as never)).toThrow(/Wrap/);
  expect(()=>projectToModel(cube.session as never)).toThrow(/Wrap/);
  for(const side of [0,1]) { const w=parseWorkspace(comparison); w.documents[side].project=cube.session.doc as never; expect(()=>workspaceToModel(w)).toThrow(/Wrap/); }
  const w=parseWorkspace(comparison);w.documents[1].project.session.camera2d.tx=1e300;
  expect(()=>workspaceToModel(w)).toThrow(/camera/);
});
it('rejects missing, duplicate and orphan layout references before producing a project', () => {
  for (const mutate of [
    (m: ReturnType<typeof projectToModel>) => m.layout2d.pop(),
    (m: ReturnType<typeof projectToModel>) => m.layout2d.push(m.layout2d[0]),
    (m: ReturnType<typeof projectToModel>) => m.layout3d.push({ id:999, p3:[0,0,0] }),
    (m: ReturnType<typeof projectToModel>) => m.graph.vertices.push(m.graph.vertices[0])
  ]) { const m=projectToModel(canonical(cube)); mutate(m); expect(()=>modelToProject(m)).toThrow(); }
});
