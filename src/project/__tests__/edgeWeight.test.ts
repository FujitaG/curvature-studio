import { beforeEach, expect, it } from 'vitest';
import { docFromArrays, docToJson, parseDocJson } from '../../state/persistence';
import type { Edge } from '../../state/types';
import { unitEdgeWeight } from '../../state/edgeWeight';
import { computationKeyForDoc } from '../../math/graph';
import { computeMetrics } from '../../math';
import { parseProjectJson, projectToJson, serializeProject } from '../format';
import { applyProject, captureProject } from '../workspace';
import { createStudioStore, selectStudioStore } from '../../state/store';
import { createProjectStore, selectProjectStore } from '../store';
import { parseWorkspace } from '../../comparison/format';
import { serializeWorkspace } from '../../comparison/serialization';
import cube from '../../../examples/cube-study.curvature.json';
import pair from '../../../examples/cube-comparison.curvature-workspace.json';

beforeEach(() => { selectStudioStore(createStudioStore()); selectProjectStore(createProjectStore()); });
const graph = () => docFromArrays([{id:1,x:0,y:0},{id:2,x:10,y:0},{id:3,x:20,y:0}], [{id:1,a:1,b:2,kind:'bond'},{id:2,a:2,b:3,kind:'brace'}]);
it('writes explicit unit weights for Bonds and Braces, including in-memory omissions', () => {
  expect(docToJson(graph()).edges.map(e=>e.weight)).toEqual([1,1]);
  expect(unitEdgeWeight({})).toBe(1);
});
it('canonicalizes legacy project omissions on every write without changing extensions', () => {
  const old=structuredClone(cube) as any;
  old.session.doc.edges.forEach((e:any)=>delete e.weight);
  old.extensions={'org.example.future':{weight:2,meaning:'optional note, not a calculation input'}};
  const output=JSON.parse(serializeProject(old));
  expect(output.session.doc.edges.every((e:Edge)=>e.weight===1)).toBe(true);
  expect(output.extensions).toEqual(old.extensions);
  expect(projectToJson(parseProjectJson(output))).toEqual(output);
});
it('preserves current computation identity and curvature for omitted and explicit weights', () => {
  const explicit=docToJson(graph());
  const legacy=structuredClone(explicit);legacy.edges.forEach(e=>delete e.weight);
  const a=parseDocJson(legacy),b=parseDocJson(explicit);
  expect(computationKeyForDoc(a)).toBe(computationKeyForDoc(b));
  expect(computeMetrics([...a.vertices.values()],[...a.edges.values()])).toEqual(computeMetrics([...b.vertices.values()],[...b.edges.values()]));
});
it.each([0,-1,2,1+Number.EPSILON,'1',null,true,NaN,Infinity,{},[]])('rejects unsupported weight %j on either structural role', weight => {
  for(const kind of ['bond','brace']) {
    const input=docToJson(graph());Object.assign(input.edges[0],{kind,weight});
    expect(()=>parseDocJson(input)).toThrow(/edge weight/i);
  }
});
it('rejects unsupported live weights instead of silently serializing them as one', () => {
  const doc=graph();Object.assign(doc.edges.get(1)!,{weight:2});
  expect(()=>docToJson(doc)).toThrow(/edge weight/i);
});
it('rejects a weighted project before replacing the current work', () => {
  applyProject(parseProjectJson(cube));const before=captureProject();
  const invalid=structuredClone(cube);invalid.session.doc.edges[0].weight=2;
  expect(()=>applyProject(parseProjectJson(invalid))).toThrow(/edge weight/i);
  expect(captureProject()).toEqual(before);
});
it('validates both comparison documents and writes explicit weights in the hidden side', () => {
  const old=structuredClone(pair) as any;old.mode='single';old.documents.forEach((d:any)=>d.project.session.doc.edges.forEach((e:any)=>delete e.weight));
  const restored=JSON.parse(serializeWorkspace(parseWorkspace(old)));
  expect(restored.documents.every((d:any)=>d.project.session.doc.edges.every((e:Edge)=>e.weight===1))).toBe(true);
  restored.documents[1].project.session.doc.edges[0].weight=0.5;
  expect(()=>parseWorkspace(restored)).toThrow(/edge weight/i);
  expect(()=>serializeWorkspace(restored)).toThrow(/edge weight/i);
});
