import { afterEach, expect, it, vi } from 'vitest';
import { acceptWorkerReply, createComputeMessage, validateComputeMessage, type WorkerOut } from '../protocol';
import { assertSupportedModel, CURRENT_MODEL } from '../model';
import { computeMetrics } from '../index';
import { effectiveEvidence, valueEvidence } from '../../results/evidence';
import { resultRows, completeResult, displayNumber } from '../../results/model';
import { docFromArrays } from '../../state/persistence';
import { resultsToJson } from '../../export/results';
import { renderValuesCsv, VALUES_CSV_HEADER } from '../../export/csv';
import { newMetadata } from '../../project/format';
import { computationKeyForDoc } from '../graph';
import { reverseConnection, periodicConnectionKey, validatePeriodicConnections, directedIncidences, changeRepresentatives, reverseCopyAddress, finiteRigidOffsets, isPeriodicIntraUnit, createPeriodicOperator, type PlannedPeriodicGraph, type PeriodicConnection } from '../future/periodic';
import { verifyInteriorSupport, generateAperiodicPatch } from '../future/interiorPatch';
import { certifyVarianceTail } from '../future/tail';

const vertices = [{ id:1, x:0, y:0 }, { id:2, x:10, y:0 }];
const edges = [{ id:1, a:1, b:2, kind:'bond' as const, weight:1 as const }];
const request = () => createComputeMessage(7,vertices,edges);
afterEach(()=>vi.unstubAllGlobals());
it('has one executable capability; rejects unknown semantics and mismatched inputs', () => {
  expect(()=>assertSupportedModel(CURRENT_MODEL)).not.toThrow();
  for (const kind of ['weighted','periodic','aperiodic']) expect(()=>assertSupportedModel({...CURRENT_MODEL,kind})).toThrow(/Unsupported/);
  expect(()=>assertSupportedModel({...CURRENT_MODEL,required:['periodic']})).toThrow();
  const m=request(); expect(validateComputeMessage(m)).toBe(m.inputKey);
  vertices[0].x=500; expect(request().inputKey).toBe(m.inputKey);
  expect(()=>validateComputeMessage({...m,inputKey:'wrong'})).toThrow(/identity/);
  expect(()=>validateComputeMessage({...m,edges:[{...edges[0],id:2}]})).toThrow(/identity/);
  expect(()=>validateComputeMessage({...m,jobId:0})).toThrow(/identity/);
  expect(()=>validateComputeMessage({...m,model:'periodic' as never})).toThrow(/Unsupported/);
});
it('rejects an invalid request in the real Worker entry before any partial result', async () => {
  vi.resetModules(); const postMessage=vi.fn(); const scope={postMessage,onmessage: null as null | ((e:MessageEvent)=>void)};
  vi.stubGlobal('self',scope); await import('../worker');
  for(const m of [{...request(),inputKey:'wrong'},{...request(),model:'periodic'},{...request(),calculation:{...CURRENT_MODEL.calculation,laziness:.25}}]) {
    postMessage.mockClear(); scope.onmessage!(new MessageEvent('message',{data:m}));
    expect(postMessage).toHaveBeenCalledTimes(1); expect(postMessage.mock.calls[0][0]).toMatchObject({type:'error',jobId:7,inputKey:m.inputKey});
  }
});
it('treats foreign IDs on a dedicated current Worker as corruption, including progress and error', () => {
  for (const type of ['progress','error','result','ollivier'] as const) {
    const m={type,jobId:7,inputKey:request().inputKey,result:{key:request().inputKey},fraction:.5,message:'failed'} as WorkerOut;
    expect(acceptWorkerReply(m,7,request().inputKey)).toBe(true);
    expect(()=>acceptWorkerReply({...m,jobId:6,inputKey:'old'},7,request().inputKey)).toThrow(/job identity/);
    expect(()=>acceptWorkerReply({...m,inputKey:'wrong'},7,request().inputKey)).toThrow(/different input/);
  }
  expect(()=>acceptWorkerReply({type:'result',jobId:7,inputKey:request().inputKey,result:{key:'wrong'}} as WorkerOut,7,request().inputKey)).toThrow();
});
it('rejects unknown required semantics in requests, vertices and edges', () => {
  const m=request();
  for(const bad of [{...m,domain:'periodic'}, {...m,edges:[{...m.edges[0],shift:[1,0]}]}, {...m,vertices:[{id:1,orbit:2},{id:2}]}]) {
    expect(()=>validateComputeMessage(bad)).toThrow(/fields/);
  }
  expect(()=>createComputeMessage(1,vertices,[{...edges[0],shift:[1,0]}] as never)).toThrow(/fields/);
  expect(()=>validateComputeMessage({...m,edges:[{...edges[0],kind:'weighted' as never}]})).toThrow(/finite/);
});
it('uses the same key for the immutable editor snapshot and normalized Worker inputs', () => {
  const doc=docFromArrays([{id:7,x:1,y:2},{id:3,x:0,y:0},{id:1,x:0,y:0}],
    [{id:9,a:7,b:3,kind:'brace'},{id:2,a:1,b:7,kind:'bond'}]);
  const message=createComputeMessage(1,[...doc.vertices.values()],[...doc.edges.values()].map(({weight:_weight,...edge})=>edge));
  expect(computationKeyForDoc(doc)).toBe(message.inputKey);
  expect(validateComputeMessage(message)).toBe(message.inputKey);
});
it('describes raw finite values without adding a tail or claiming certified curvature accuracy', () => {
  const result=computeMetrics(vertices,edges), value=result.values[0];
  expect(value.kEff).toBe(1); expect(value.vInf).toBe(2);
  expect(valueEvidence(value)).toMatchObject({ollivier:{kind:'exact-rational'},effective:{kind:'truncated-sum',variance:{boundInExactArithmetic:'lower'},curvature:{boundInExactArithmetic:'upper'},certified:false,rounding:'unverified-floating-point',termination:'estimated-tail-tolerance',stoppingTolerance:{quantity:'estimated-variance-tail',value:1e-10}}});
  expect(effectiveEvidence({...value,converged:false})).toMatchObject({termination:'iteration-limit'});
  const doc=docFromArrays(vertices,edges), pending={...result,values:[{...value,iterations:0,converged:false}]};
  expect(completeResult(doc,pending)).toBe(false);
  expect(resultRows(doc,pending)[0].status).toBe('pending');
  expect(displayNumber(resultRows(doc,pending)[0].value?.kEff,2)).toBe('—');
  expect(displayNumber(resultRows(doc,pending)[0].value?.ollivier,2)).toBe('1.00');
  expect(effectiveEvidence(pending.values[0])).toEqual({kind:'pending'});
  expect(resultsToJson(doc,result,newMetadata()).quotientBonds[0].evidence.effective.kind).toBe('truncated-sum');
});
it('retains first 12 CSV columns, with matching evidence columns for every row including intra/Brace', () => {
  const doc=docFromArrays([...vertices,{id:3,x:0,y:10}],[...edges,{id:2,a:2,b:3,kind:'brace'},{id:3,a:1,b:3,kind:'brace'}]);
  for(const graph of [doc,docFromArrays(vertices,edges)]) {
    const result=computeMetrics([...graph.vertices.values()],[...graph.edges.values()]);
    const lines=renderValuesCsv(graph,result).slice(0,-1).split('\n');
    expect(lines[0].split(', ').slice(0,12)).toEqual(['edge_id','vertex_a','vertex_b','kind','quotient_edge','ollivier_num','ollivier_den','ollivier','v_inf','k_eff','converged','iterations']);
    expect(lines.every(line=>line.split(', ').length===VALUES_CSV_HEADER.split(', ').length)).toBe(true);
  }
});
const bond=(id:number,a:number,b:number,shift:number[]):PeriodicConnection=>({id,a,b,shift,kind:'bond'});
const periodic=(connections:PeriodicConnection[],vertices=[1,2]):PlannedPeriodicGraph=>({status:'reserved-not-implemented',dimension:2,vertexOrbitIds:vertices,connections});
it('preserves hcb translations and self-orbit incidences while canonicalizing reversal', () => {
  const edges=[bond(1,1,2,[0,0]),bond(2,1,2,[1,0]),bond(3,1,2,[0,1])];
  expect(()=>validatePeriodicConnections(periodic(edges))).not.toThrow();
  expect(new Set(edges.map(e=>periodicConnectionKey(e,2))).size).toBe(3);
  for(const e of [...edges,bond(4,1,1,[1,0]),bond(5,1,1,[-1,1])]) expect(periodicConnectionKey(e,2)).toBe(periodicConnectionKey(reverseConnection(e),2));
  expect(directedIncidences(bond(1,1,1,[1,0])).map(e=>e.shift)).toEqual([[1,0],[-1,0]]);
  expect(()=>validatePeriodicConnections(periodic([edges[0],{...reverseConnection(edges[0]),id:2}]))).toThrow(/Duplicate/);
  expect(()=>periodicConnectionKey(bond(1,1,1,[0,0]),2)).toThrow(/self-loop/);
  expect(()=>periodicConnectionKey(bond(1,1,2,[.5,0]),2)).toThrow(/integers/);
  expect(()=>periodicConnectionKey(bond(1,1,2,[1]),2)).toThrow(/dimension/);
});
it('preserves cell copy addresses and tests representative changes and rigid winding', () => {
  const e=bond(1,1,2,[1,-1]);
  expect(reverseCopyAddress(e,[2,3],2)).toEqual({edgeOrbitId:1,sourceCell:[3,2]});
  expect(changeRepresentatives(e,[2,0],[-1,3],2).shift).toEqual([4,-4]);
  expect(changeRepresentatives(bond(2,1,1,[1,0]),[2,3],[2,3],2).shift).toEqual([1,0]);
  const brace={...e,kind:'brace' as const}, g=periodic([brace]);
  const offsets=finiteRigidOffsets(g);
  expect(isPeriodicIntraUnit(e,offsets)).toBe(true);
  expect(isPeriodicIntraUnit({...e,shift:[2,-1]},offsets)).toBe(false);
  const cycle=periodic([brace,{...bond(2,2,3,[0,0]),kind:'brace'},{...bond(3,3,1,[0,0]),kind:'brace'}],[1,2,3]);
  expect(()=>finiteRigidOffsets(cycle)).toThrow(/winding/);
  cycle.connections[2].shift=[-1,1];
  expect(()=>finiteRigidOffsets(cycle)).not.toThrow();
  expect(()=>changeRepresentatives(e,[Number.MAX_SAFE_INTEGER,0],[0,0],2)).toThrow(/integers/);
});
it('cannot manufacture an infinite calculation or certificate from boundary declarations', () => {
  expect(()=>createPeriodicOperator(periodic([]))).toThrow(/reserved/);
  expect(()=>verifyInteriorSupport({status:'reserved-not-implemented',ambient:{kind:'aperiodic',definitionId:'Penrose',definitionVersion:1,inputIdentity:'x'},coreEdgeIds:[],supportVertexIds:[],requestedSteps:10,boundary:{kind:'declared-only',radius:1000}})).toThrow(/reserved/);
  expect(()=>generateAperiodicPatch({status:'reserved-not-implemented',generatorId:'Penrose',generatorVersion:1,parameters:{},addressing:'exact-algebraic',hullSampling:'edge-frequency'})).toThrow(/reserved/);
  expect(()=>certifyVarianceTail({inputIdentity:'x',definitionIdentity:'y',partialVariance:2,steps:10,noise:'ordinary-counting-l2-on-quotient'})).toThrow(/reserved/);
});
