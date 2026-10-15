import { useComparison } from '../comparison/store';
import { sceneApis, installSceneApis } from './sceneApis';
import { consumePaneFit, eventForStore, storeInstanceKey } from '../comparison/panes';
import { drawingUnit, frameEdge, framePoints, setCameraViewport, updateClipping } from './framing';
import { compactViewport, GRAPH_VIEWPORT_CHANGED, readGraphViewport } from '../state/viewport';
import { usableGraphViewport } from '../state/camera2d';
import { createCamera } from './camera';
import { createRenderScheduler, screenPixelRatio } from './renderScheduler';
import { SceneGeometry, positionCylinder } from './geometry';
import { SceneBatches, instancesFor, selectionForHit, type GeometryInstance } from './batches';
import { SceneLabels, type LabelInput } from './labels';
import { InteractionQuality } from './interactionQuality';
import { t } from '../i18n';
import { getSavedCamera3d, setSavedCamera3d, WORKSPACE_CHANGED } from '../state/viewMemory';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { labelColor, metricColor, metricLabel, neutralizedRigidColor, tokens } from '../design/tokens';
import type { MetricResult } from '../math';
import { CANCEL_DRAG_EVENT } from '../state/dragController';
import { edgeArray, isolatedVertexIds, vertexArray } from '../state/history';
import { styleForView, type SavedGradient, type ViewStyle } from '../state/style';
import { getActiveStudioStore, type StudioStore } from '../state/store';
import type { Doc, EdgeId, ProjectionMode, SelectionItem, Vertex } from '../state/types';

type Capture3dWindow = Window & {
  __curvatureStudioCapture3d?: () => string | null;
  __curvatureStudioSvg3d?: () => string | null;
  __curvatureStudioRenderStats?: (includeProjection?: boolean) => Record<string, unknown>;
};

interface ThreeState {
  store: StudioStore;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  contentGroup: THREE.Group;
  controls: OrbitControls;
  geometry: SceneGeometry;
  batches: SceneBatches;
  bondColors: Map<number, THREE.Color>;
  invalidate: () => void;
  onNavigationStart: () => void;
  onNavigationEnd: () => void;
  edgeMeshes: Map<EdgeId, Array<{ mesh: GeometryInstance; from: number; to: number; offset: number }>>;
  vertexMeshes: Map<number, GeometryInstance[]>;
  ghostGroup: THREE.Group;
  hoverGroup: THREE.Group;
  labels: SceneLabels;
  quality: InteractionQuality;
  geometryStyleKey: string;
  intraKey: string;
  materials: Partial<Record<'vertex' | 'outline' | 'brace' | 'intra' | 'casing', THREE.MeshBasicMaterial | THREE.MeshLambertMaterial>>;
  stats: { frames: number; raycasts: number; rebuilds: number; appearanceUpdates: number; simplifiedMeshes: number };
  overlayGroup: THREE.Group;
  pickables: THREE.Object3D[];
  detailMeshes: THREE.Object3D[];
  positions: Map<number, THREE.Vector3>;
  bounds: THREE.Sphere;
  unitScale: number;
  fitIds: 'all' | number[] | null;
  projection: ProjectionMode;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  tween: {
    start: number;
    fromPosition: THREE.Vector3;
    toPosition: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null;
  warningGroup: THREE.Group;
}

interface MoveDrag {
  ids: number[];
  original: Map<number, THREE.Vector3>;
  plane: THREE.Plane;
  lastPoint: THREE.Vector3;
}

function isPerspectiveCamera(camera: THREE.Camera): camera is THREE.PerspectiveCamera {
  return camera instanceof THREE.PerspectiveCamera;
}


function configureControls(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, domElement: HTMLElement, target?: THREE.Vector3, onChange?: () => void, onStart?: () => void, onEnd?: () => void): OrbitControls {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };
  if (target) controls.target.copy(target);
  if (onChange) controls.addEventListener('change', onChange);
  if (onStart) controls.addEventListener('start', onStart);
  if (onEnd) controls.addEventListener('end', onEnd);
  return controls;
}

function resizeCamera(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, width: number, height: number): void {
  const aspect = width / Math.max(1, height);
  if (isPerspectiveCamera(camera)) {
    camera.aspect = aspect;
  } else {
    const halfHeight = (camera.top - camera.bottom) / 2;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
  }
  camera.updateProjectionMatrix();
}

function viewDepth(camera: THREE.Camera, point: THREE.Vector3): number {
  return -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
}

function vertexPosition(vertex: Vertex): THREE.Vector3 {
  if (vertex.p3) return new THREE.Vector3(vertex.p3[0], vertex.p3[1], vertex.p3[2]);
  const jitter = 0.01 * (((vertex.id * 2654435761) % 1000) - 500) / 500;
  return new THREE.Vector3(vertex.x / 64, -vertex.y / 64, jitter);
}

function offsetForEdge(a: THREE.Vector3, b: THREE.Vector3, amount: number): THREE.Vector3 {
  const delta = new THREE.Vector3().subVectors(b, a).normalize();
  const basis = Math.abs(delta.dot(new THREE.Vector3(0, 0, 1))) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3().crossVectors(delta, basis).normalize().multiplyScalar(amount);
}

function addCylinderWithUserData(state: ThreeState, a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material, userData: SelectionItem, from = 0, to = 1, offset = 0): void {
  const mesh = state.batches.add(state.geometry.cylinderGeometry, material, userData, material.userData.curvature ? state.bondColors.get(userData.id) : undefined);
  mesh.scale.set(radius, 1, radius);
  positionCylinder(mesh, a, b);
  const records = state.edgeMeshes.get(userData.id) ?? [];
  records.push({ mesh, from, to, offset });
  state.edgeMeshes.set(userData.id, records);
}

function disposeObject(object: THREE.Object3D): void {
  if (object instanceof THREE.InstancedMesh) object.dispose();
  if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
    if (!object.geometry.userData.shared) object.geometry.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material.dispose();
  } else if (object instanceof THREE.Sprite) {
    object.material.dispose();
  }
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    child.traverse(disposeObject);
    group.remove(child);
  }
}

function selectionKey(item: SelectionItem): string {
  return `${item.kind}:${item.id}`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}

function compact(value: number): string {
  return String(Number(value.toFixed(2)));
}

function dashPattern(width: number): string {
  return `${compact(3 * width)} ${compact(1.5 * width)}`;
}

function bondRadius(style: ViewStyle): number {
  return 0.012 * (style.bondWidth / 2);
}

function braceRadius(style: ViewStyle): number {
  return 0.026 * (style.bondWidth / 2);
}

function selectedRadius(kind: 'bond' | 'brace', style: ViewStyle): number {
  return (kind === 'brace' ? 0.032 : 0.018) * (style.bondWidth / 2);
}

function vertexRadius(style: ViewStyle): number {
  return 0.045 * (style.vertexSize / 4.5);
}

function vertexOverlayRadius(style: ViewStyle): number {
  return 0.057 * (style.vertexSize / 4.5);
}

function vertexWarningRadius(style: ViewStyle): number {
  return 0.072 * (style.vertexSize / 4.5);
}

function addSegmentedCylinders(
  state: ThreeState,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  userData: SelectionItem,
  style: ViewStyle
): void {
  const delta = new THREE.Vector3().subVectors(b, a);
  const length = Math.max(1e-6, delta.length());
  const segmentCount = Math.max(3, Math.min(18, Math.ceil(length / (state.unitScale * Math.max(0.14, 0.22 * (style.bondWidth / 2))))));
  for (let index = 0; index < segmentCount; index += 1) {
    const start = index / segmentCount;
    const end = Math.min(1, start + (2 / 3) / segmentCount);
    const p0 = a.clone().lerp(b, start);
    const p1 = a.clone().lerp(b, end);
    addCylinderWithUserData(state, p0, p1, radius, material, userData, start, end);
  }
}

function addLineStyleCylinders(
  state: ThreeState,
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
  userData: SelectionItem,
  style: ViewStyle,
  lineStyle: 'single' | 'double' | 'dashed',
  extraRadius = 0
): void {
  if (lineStyle === 'double') {
    const offset = offsetForEdge(a, b, 0.035 * (style.bondWidth / 2) * state.unitScale);
    for (const direction of [-1, 1]) {
      addCylinderWithUserData(
        state,
        a.clone().addScaledVector(offset, direction),
        b.clone().addScaledVector(offset, direction),
        radius * 0.75 + extraRadius,
        material,
        userData, 0, 1, direction * 0.035 * (style.bondWidth / 2) * state.unitScale
      );
    }
    return;
  }
  if (lineStyle === 'dashed') {
    addSegmentedCylinders(state, a, b, radius + extraRadius, material, userData, style);
    return;
  }
  addCylinderWithUserData(state, a, b, radius + extraRadius, material, userData);
}

function applyViewport(state: ThreeState): void {
  const { clientWidth: width, clientHeight: height } = state.renderer.domElement;
  const area = readGraphViewport(width, height, state.store);
  if (usableGraphViewport(area)) setCameraViewport(state.camera, width, height, area);
}

function frameContent(state: ThreeState, points: THREE.Vector3[], animated: boolean): void {
  if (!points.length) return;
  const { clientWidth: width, clientHeight: height } = state.renderer.domElement;
  const area = readGraphViewport(width, height, state.store);
  if (!usableGraphViewport(area)) return;
  const direction = state.camera.position.clone().sub(state.controls.target);
  const style = styleForView(state.store.getState().style, '3d');
  const padding = Math.max(vertexWarningRadius(style), braceRadius(style), 0.08) * state.unitScale;
  const frame = Array.isArray(state.fitIds) ? frameEdge : framePoints;
  const { target, position } = frame(state.camera, points, direction, width, height, area, padding);
  if (animated) {
    state.tween = { start: performance.now(), fromPosition: state.camera.position.clone(), toPosition: position,
      fromTarget: state.controls.target.clone(), toTarget: target };
  } else {
    state.tween = null;
    state.controls.target.copy(target); state.camera.position.copy(position);
    state.controls.update(); state.camera.updateMatrixWorld();
  }
  updateClipping(state.camera, state.bounds, padding);
  state.invalidate();
}

function fitToContent(state: ThreeState, animated: boolean): void {
  state.fitIds = 'all';
  frameContent(state, [...state.positions.values()], animated);
}

function locateEdge(state: ThreeState, doc: Doc, edgeId: EdgeId): void {
  const edge = doc.edges.get(edgeId), a = edge ? state.positions.get(edge.a) : undefined, b = edge ? state.positions.get(edge.b) : undefined;
  if (!a || !b || !edge) return;
  state.fitIds = [edge.a, edge.b];
  frameContent(state, [a, b], true);
}

function switchProjection(state: ThreeState, projection: ProjectionMode): void {
  if (state.projection === projection) return;
  const oldCamera = state.camera;
  const oldControls = state.controls;
  const target = oldControls.target.clone();
  const aspect = state.renderer.domElement.clientWidth / Math.max(1, state.renderer.domElement.clientHeight);
  const near = oldCamera.near;
  const far = oldCamera.far;
  const nextCamera =
    projection === 'orthographic'
      ? (() => {
          const fov = isPerspectiveCamera(oldCamera) ? oldCamera.fov : 45;
          const d = oldCamera.position.distanceTo(target);
          const halfHeight = Math.max(0.5, d * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
          return new THREE.OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, near, far);
        })()
      : new THREE.PerspectiveCamera(45, aspect, near, far);

  nextCamera.position.copy(oldCamera.position);
  nextCamera.quaternion.copy(oldCamera.quaternion);
  nextCamera.up.copy(oldCamera.up);
  nextCamera.updateProjectionMatrix();
  oldControls.removeEventListener('change', state.invalidate);
  oldControls.removeEventListener('start', state.onNavigationStart);
  oldControls.removeEventListener('end', state.onNavigationEnd);
  oldControls.dispose();
  state.camera = nextCamera;
  applyViewport(state);
  state.onNavigationEnd();
  state.controls = configureControls(nextCamera, state.renderer.domElement, target, state.invalidate, state.onNavigationStart, state.onNavigationEnd);
  state.controls.update();
  state.projection = projection;
  state.tween = null;
  state.invalidate();
}

function rebuildContent(
  state: ThreeState,
  doc: Doc,
  results: MetricResult | null,
  metric: 'ollivier' | 'keff',
  colorblindSafe: boolean,
  labelsVisible: boolean,
  style: ViewStyle,
  customGradients: SavedGradient[]
): void {
  state.labels.clearRecords();
  clearGroup(state.contentGroup);
  state.stats.rebuilds++;
  state.batches = new SceneBatches();
  state.bondColors.clear();
  state.edgeMeshes.clear();
  state.vertexMeshes.clear();
  state.pickables = [];

  const vertices = vertexArray(doc);
  const edges = edgeArray(doc);
  state.positions = new Map(vertices.map((vertex) => [vertex.id, vertexPosition(vertex)]));
  state.bounds = new THREE.Box3().setFromPoints([...state.positions.values()]).getBoundingSphere(new THREE.Sphere());
  state.unitScale = drawingUnit(state.positions, edges);

  const vertexOpacity = style.verticesHidden || !style.vertexFill.enabled ? 0 : 1;
  const intraColor = style.braceColor === tokens.ink800 ? tokens.neutral400 : neutralizedRigidColor(style.braceColor);
  const bondMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  bondMaterial.userData.curvature = true;
  const vertexMaterial = new THREE.MeshLambertMaterial({ color: style.vertexFill.color, transparent: vertexOpacity < 1, opacity: vertexOpacity });
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: style.vertexOutline.color, side: THREE.BackSide });
  const braceMaterial = new THREE.MeshLambertMaterial({ color: style.braceColor });
  const intraMaterial = new THREE.MeshBasicMaterial({ color: intraColor, transparent: true, opacity: 0.5 });
  const casingMaterial = style.bondCasing.enabled ? new THREE.MeshBasicMaterial({ color: style.bondCasing.color }) : null;

  for (const edge of edges) {
    const a = state.positions.get(edge.a);
    const b = state.positions.get(edge.b);
    if (!a || !b) continue;
    const mapped = results?.bondMap.get(edge.id);
    const value = typeof mapped === 'number' ? results?.values[mapped] : undefined;
    const metricValue = value ? (metric === 'keff' ? value.kEff : value.ollivier) : Number.NaN;
    const material =
      edge.kind === 'brace'
        ? braceMaterial
        : mapped === 'intra'
          ? intraMaterial
          : bondMaterial;
    if (material === bondMaterial) state.bondColors.set(edge.id, new THREE.Color(metricColor(metric, metricValue, colorblindSafe, style, customGradients)));
    const userData: SelectionItem = { kind: 'edge', id: edge.id };
    const lineStyle = edge.kind === 'brace' ? style.braceStyle : mapped === 'intra' ? 'dashed' : style.bondStyle;
    const radius = edge.kind === 'brace' ? braceRadius(style) * state.unitScale : bondRadius(style) * state.unitScale;
    if (edge.kind === 'bond' && mapped !== 'intra' && casingMaterial) {
      addLineStyleCylinders(state, a, b, radius, casingMaterial, userData, style, lineStyle, 0.006 * style.bondCasingWidth * state.unitScale);
    }
    addLineStyleCylinders(state, a, b, radius, material, userData, style, lineStyle);


  }

  const outlineVisible = !style.verticesHidden && style.vertexOutline.enabled && style.vertexOutlineWidth > 0;
  for (const vertex of vertices) {
    const position = state.positions.get(vertex.id) ?? new THREE.Vector3();
    const meshes: GeometryInstance[] = [];
    if (outlineVisible) {
      const outline = state.batches.add(state.geometry.sphereGeometry, outlineMaterial, null);
      outline.scale.setScalar(vertexRadius(style) * state.unitScale * (1 + 0.1 * style.vertexOutlineWidth));
      outline.position.copy(position);
      meshes.push(outline);
    }
    const mesh = state.batches.add(state.geometry.sphereGeometry, vertexMaterial, { kind: 'vertex', id: vertex.id });
    mesh.scale.setScalar(vertexRadius(style) * state.unitScale);
    mesh.position.copy(position);
    meshes.push(mesh);
    state.vertexMeshes.set(vertex.id, meshes);
  }
  state.pickables = state.batches.finish(state.contentGroup);
  state.materials = { vertex: vertexMaterial, outline: outlineMaterial, brace: braceMaterial, intra: intraMaterial, ...(casingMaterial ? { casing: casingMaterial } : {}) };
  state.geometryStyleKey = geometryStyleKey(style);
  state.intraKey = intraKey(doc, results);
  refreshAppearance(state, doc, results, metric, colorblindSafe, labelsVisible, style, customGradients);
  refreshDetailMeshes(state);
  // Materials with no instances were never registered with the renderer.
  for (const material of [bondMaterial, vertexMaterial, outlineMaterial, braceMaterial, intraMaterial, casingMaterial]) {
    if (material && !state.contentGroup.children.some(child => child instanceof THREE.Mesh && child.material === material)) material.dispose();
  }
  state.invalidate();
}

function geometryStyleKey(style: ViewStyle): string {
  return JSON.stringify([style.vertexFill.enabled, style.vertexOutline.enabled, style.vertexSize, style.vertexOutlineWidth,
    style.verticesHidden, style.bondStyle, style.bondCasing.enabled, style.bondCasingWidth, style.braceStyle, style.bondWidth]);
}

function refreshDetailMeshes(state: ThreeState): void {
  state.detailMeshes = [state.contentGroup, state.overlayGroup, state.warningGroup].flatMap(group => group.children.filter(object => object instanceof THREE.InstancedMesh));
}

function intraKey(doc: Doc, results: MetricResult | null): string {
  return [...doc.edges.values()].filter(edge => edge.kind === 'bond' && results?.bondMap.get(edge.id) === 'intra').map(edge => edge.id).join(',');
}

/** Values and paint do not require new instance buffers or a new picking structure. */
function refreshAppearance(state: ThreeState, doc: Doc, results: MetricResult | null, metric: 'ollivier' | 'keff', colorblindSafe: boolean,
  labelsVisible: boolean, style: ViewStyle, customGradients: SavedGradient[]): void {
  state.stats.appearanceUpdates++;
  state.materials.vertex?.color.set(style.vertexFill.color);
  state.materials.outline?.color.set(style.vertexOutline.color);
  state.materials.brace?.color.set(style.braceColor);
  state.materials.intra?.color.set(style.braceColor === tokens.ink800 ? tokens.neutral400 : neutralizedRigidColor(style.braceColor));
  state.materials.casing?.color.set(style.bondCasing.color);
  const labels: LabelInput[] = [];
  for (const edge of doc.edges.values()) {
    if (edge.kind !== 'bond') continue;
    const mapped = results?.bondMap.get(edge.id);
    if (mapped === 'intra') continue;
    const value = typeof mapped === 'number' ? results?.values[mapped] : undefined;
    const color = metricColor(metric, value ? metric === 'keff' ? value.kEff : value.ollivier : Number.NaN, colorblindSafe, style, customGradients);
    const instanceColor = state.bondColors.get(edge.id) ?? new THREE.Color();
    instanceColor.set(color); state.bondColors.set(edge.id, instanceColor);
    for (const { mesh } of state.edgeMeshes.get(edge.id) ?? []) {
      const material = mesh.mesh.material as THREE.Material;
      if (!material.userData.curvature) continue;
      mesh.mesh.setColorAt(mesh.index, instanceColor);
      mesh.mesh.instanceColor!.needsUpdate = true;
    }
    if (labelsVisible && value) labels.push({ edgeId: edge.id, a: state.positions.get(edge.a)!, b: state.positions.get(edge.b)!,
      text: metricLabel(metric, metric === 'keff' ? value.kEff : value.ollivier), color: labelColor(color) });
  }
  state.labels.setRecords(labels);
  state.invalidate();
}

function rebuildSelectionOverlay(state: ThreeState, doc: Doc, selection: SelectionItem[], style: ViewStyle): void {
  clearGroup(state.overlayGroup);
  const batches = new SceneBatches();
  // Draw the back of an enlarged shell: the actual edge occludes its centre,
  // leaving a selection outline without covering the curvature/threshold color.
  const selectedMaterial = new THREE.MeshBasicMaterial({ color: tokens.accent, side: THREE.BackSide });
  const selectedVertexMaterial = new THREE.MeshBasicMaterial({ color: tokens.accent, wireframe: true, transparent: true, opacity: 0.85, depthTest: false });
  const selected = new Set(selection.map(selectionKey));
  for (const edge of doc.edges.values()) {
    if (!selected.has(`edge:${edge.id}`)) continue;
    const a = state.positions.get(edge.a);
    const b = state.positions.get(edge.b);
    if (!a || !b) continue;
    const overlay = batches.add(state.geometry.cylinderGeometry, selectedMaterial, { kind: 'edge', id: edge.id });
    overlay.scale.set(selectedRadius(edge.kind, style) * state.unitScale, 1, selectedRadius(edge.kind, style) * state.unitScale);
    positionCylinder(overlay, a, b);
  }
  for (const vertex of doc.vertices.values()) {
    if (!selected.has(`vertex:${vertex.id}`)) continue;
    const p = state.positions.get(vertex.id);
    if (!p) continue;
    const overlay = batches.add(state.geometry.sphereGeometry, selectedVertexMaterial, { kind: 'vertex', id: vertex.id });
    overlay.scale.setScalar(vertexOverlayRadius(style) * state.unitScale);
    overlay.position.copy(p);
  }
  batches.finish(state.overlayGroup);
  refreshDetailMeshes(state);
  if (!selection.some(item => item.kind === 'edge')) selectedMaterial.dispose();
  if (!selection.some(item => item.kind === 'vertex')) selectedVertexMaterial.dispose();
  state.invalidate();
}

function rebuildWarningOverlay(state: ThreeState, doc: Doc, style: ViewStyle): void {
  clearGroup(state.warningGroup);
  const batches = new SceneBatches();
  const warningMaterial = new THREE.MeshBasicMaterial({ color: tokens.warning, wireframe: true, transparent: true, opacity: 0.9, depthTest: false });
  for (const id of isolatedVertexIds(doc)) {
    const p = state.positions.get(id);
    if (!p) continue;
    const overlay = batches.add(state.geometry.sphereGeometry, warningMaterial, { kind: 'vertex', id });
    overlay.scale.setScalar(vertexWarningRadius(style) * state.unitScale);
    overlay.position.copy(p);
  }
  batches.finish(state.warningGroup);
  refreshDetailMeshes(state);
  if (!state.warningGroup.children.length) warningMaterial.dispose();
  state.invalidate();
}

/** Moving vertices changes transforms only; buffers, materials and labels stay alive. */
function updateMovedGeometry(state: ThreeState, doc: Doc, ids: number[]): void {
  const moved = new Set(ids);
  for (const id of moved) {
    const position = state.positions.get(id)!;
    for (const mesh of state.vertexMeshes.get(id) ?? []) { mesh.position.copy(position); mesh.write(); }
  }
  for (const edge of doc.edges.values()) {
    if (!moved.has(edge.a) && !moved.has(edge.b)) continue;
    const a = state.positions.get(edge.a)!, b = state.positions.get(edge.b)!;
    for (const { mesh, from, to, offset } of state.edgeMeshes.get(edge.id) ?? []) {
      const shift = offset ? offsetForEdge(a, b, offset) : new THREE.Vector3();
      positionCylinder(mesh, a.clone().lerp(b, from).add(shift), a.clone().lerp(b, to).add(shift));
      mesh.write();
    }
  }
  for (const group of [state.overlayGroup, state.warningGroup]) {
    for (const object of group.children) for (const instance of instancesFor(object)) {
      const item = instance.userData;
      if (item?.kind === 'vertex' && moved.has(item.id)) { instance.position.copy(state.positions.get(item.id)!); instance.write(); }
      if (item?.kind === 'edge') {
        const edge = doc.edges.get(item.id);
        if (edge && (moved.has(edge.a) || moved.has(edge.b))) {
          positionCylinder(instance, state.positions.get(edge.a)!, state.positions.get(edge.b)!);
          instance.write();
        }
      }
    }
  }
}

function updateLabelSprites(state: ThreeState, labelsVisible: boolean, dense: boolean, hoverKey: string | null, selection: SelectionItem[], labelScale: number, preview = false): void {
  state.labels.update({
    camera: state.camera, width: state.renderer.domElement.clientWidth, height: state.renderer.domElement.clientHeight,
    enabled: labelsVisible, focusOnly: dense || preview && state.labels.count > 150, hoverKey, selection, scale: labelScale
  });
}

function renderProjectedSvg3d(
  state: ThreeState,
  doc: Doc,
  results: MetricResult | null,
  metric: 'ollivier' | 'keff',
  colorblindSafe: boolean,
  labelsVisible: boolean,
  dense: boolean,
  hoverKey: string | null,
  selection: SelectionItem[],
  style: ViewStyle,
  customGradients: SavedGradient[]
): string {
  const viewportWidth = Math.max(1, state.renderer.domElement.clientWidth);
  const viewportHeight = Math.max(1, state.renderer.domElement.clientHeight);
  const selected = new Set(selection.map(selectionKey));
  const projected = new Map<number, { x: number; y: number; depth: number }>();
  const bounds = { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY };
  const include = (x: number, y: number) => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  };

  for (const vertex of doc.vertices.values()) {
    const p = state.positions.get(vertex.id);
    if (!p) continue;
    const ndc = p.clone().project(state.camera);
    const x = ((ndc.x + 1) / 2) * viewportWidth;
    const y = ((1 - ndc.y) / 2) * viewportHeight;
    projected.set(vertex.id, { x, y, depth: viewDepth(state.camera, p) });
    include(x - style.vertexSize, y - style.vertexSize);
    include(x + style.vertexSize, y + style.vertexSize);
  }

  if (projected.size === 0 || !Number.isFinite(bounds.minX)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect width="240" height="160" fill="${tokens.white}"/></svg>`;
  }

  const lines: Array<{ depth: number; svg: (dx: number, dy: number) => string }> = [];
  const labels: Array<{ x: number; y: number; angle: number; text: string; color: string }> = [];
  const intraColor = style.braceColor === tokens.ink800 ? tokens.neutral400 : neutralizedRigidColor(style.braceColor);
  for (const edge of doc.edges.values()) {
    const a = projected.get(edge.a);
    const b = projected.get(edge.b);
    const pa = state.positions.get(edge.a);
    const pb = state.positions.get(edge.b);
    if (!a || !b || !pa || !pb) continue;
    const mapped = results?.bondMap.get(edge.id);
    const value = typeof mapped === 'number' ? results?.values[mapped] : undefined;
    const metricValue = value ? (metric === 'keff' ? value.kEff : value.ollivier) : Number.NaN;
    const color = edge.kind === 'brace' ? style.braceColor : mapped === 'intra' ? intraColor : metricColor(metric, metricValue, colorblindSafe, style, customGradients);
    const depth = viewDepth(state.camera, pa.clone().add(pb).multiplyScalar(0.5));
    if (edge.kind === 'brace') {
      if (style.braceStyle === 'single' || style.braceStyle === 'dashed') {
        lines.push({
          depth,
          svg: (ox, oy) =>
            `<line x1="${(a.x + ox).toFixed(2)}" y1="${(a.y + oy).toFixed(2)}" x2="${(b.x + ox).toFixed(2)}" y2="${(b.y + oy).toFixed(2)}" stroke="${color}" stroke-width="${compact(style.bondWidth)}" stroke-linecap="round"${style.braceStyle === 'dashed' ? ` stroke-dasharray="${dashPattern(style.bondWidth)}"` : ''}/>`
        });
      } else {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const gap = (style.bondWidth / 2) * 2.2;
        const nx = (-dy / len) * gap;
        const ny = (dx / len) * gap;
        include(a.x + nx, a.y + ny);
        include(b.x + nx, b.y + ny);
        include(a.x - nx, a.y - ny);
        include(b.x - nx, b.y - ny);
        lines.push({
          depth,
          svg: (ox, oy) =>
            `<line x1="${(a.x + nx + ox).toFixed(2)}" y1="${(a.y + ny + oy).toFixed(2)}" x2="${(b.x + nx + ox).toFixed(2)}" y2="${(b.y + ny + oy).toFixed(2)}" stroke="${color}" stroke-width="${compact(style.bondWidth * 0.75)}" stroke-linecap="round"/><line x1="${(a.x - nx + ox).toFixed(2)}" y1="${(a.y - ny + oy).toFixed(2)}" x2="${(b.x - nx + ox).toFixed(2)}" y2="${(b.y - ny + oy).toFixed(2)}" stroke="${color}" stroke-width="${compact(style.bondWidth * 0.75)}" stroke-linecap="round"/>`
        });
      }
    } else {
      const dash = mapped === 'intra' || style.bondStyle === 'dashed' ? ` stroke-dasharray="${dashPattern(style.bondWidth)}"` : '';
      if (style.bondStyle === 'double' && mapped !== 'intra') {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const gap = (style.bondWidth / 2) * 2.2;
        const nx = (-dy / len) * gap;
        const ny = (dx / len) * gap;
        include(a.x + nx, a.y + ny);
        include(b.x + nx, b.y + ny);
        include(a.x - nx, a.y - ny);
        include(b.x - nx, b.y - ny);
        const lineWidth = style.bondWidth * 0.75;
        if (style.bondCasing.enabled) {
          const casingWidth = compact(lineWidth + style.bondCasingWidth * 2);
          lines.push({
            depth: depth + 0.0001,
            svg: (ox, oy) =>
              `<line x1="${(a.x + nx + ox).toFixed(2)}" y1="${(a.y + ny + oy).toFixed(2)}" x2="${(b.x + nx + ox).toFixed(2)}" y2="${(b.y + ny + oy).toFixed(2)}" stroke="${style.bondCasing.color}" stroke-width="${casingWidth}" stroke-linecap="round"/><line x1="${(a.x - nx + ox).toFixed(2)}" y1="${(a.y - ny + oy).toFixed(2)}" x2="${(b.x - nx + ox).toFixed(2)}" y2="${(b.y - ny + oy).toFixed(2)}" stroke="${style.bondCasing.color}" stroke-width="${casingWidth}" stroke-linecap="round"/>`
          });
        }
        lines.push({
          depth,
          svg: (ox, oy) =>
            `<line x1="${(a.x + nx + ox).toFixed(2)}" y1="${(a.y + ny + oy).toFixed(2)}" x2="${(b.x + nx + ox).toFixed(2)}" y2="${(b.y + ny + oy).toFixed(2)}" stroke="${color}" stroke-width="${compact(lineWidth)}" stroke-linecap="round"/><line x1="${(a.x - nx + ox).toFixed(2)}" y1="${(a.y - ny + oy).toFixed(2)}" x2="${(b.x - nx + ox).toFixed(2)}" y2="${(b.y - ny + oy).toFixed(2)}" stroke="${color}" stroke-width="${compact(lineWidth)}" stroke-linecap="round"/>`
        });
      } else {
        if (style.bondCasing.enabled && mapped !== 'intra') {
          lines.push({
            depth: depth + 0.0001,
            svg: (ox, oy) =>
              `<line x1="${(a.x + ox).toFixed(2)}" y1="${(a.y + oy).toFixed(2)}" x2="${(b.x + ox).toFixed(2)}" y2="${(b.y + oy).toFixed(2)}" stroke="${style.bondCasing.color}" stroke-width="${compact(style.bondWidth + style.bondCasingWidth * 2)}" stroke-linecap="round"${dash}/>`
          });
        }
        lines.push({
          depth,
          svg: (ox, oy) =>
            `<line x1="${(a.x + ox).toFixed(2)}" y1="${(a.y + oy).toFixed(2)}" x2="${(b.x + ox).toFixed(2)}" y2="${(b.y + oy).toFixed(2)}" stroke="${color}" stroke-width="${compact(style.bondWidth)}" stroke-linecap="round"${dash}/>`
        });
      }
      const projectedLength = Math.hypot(b.x - a.x, b.y - a.y);
      const linkedToHover = hoverKey === `edge:${edge.id}`;
      const linkedToSelection = selected.has(`edge:${edge.id}`);
      if (value && labelsVisible && (dense ? linkedToHover || linkedToSelection : projectedLength >= 46 * style.labelScale || linkedToHover || linkedToSelection)) {
        let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        if (angle > 90 || angle <= -90) angle += 180;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len;
        let ny = dx / len;
        if (ny > 0) {
          nx = -nx;
          ny = -ny;
        }
        const x = (a.x + b.x) / 2 + nx * 9 * style.labelScale;
        const y = (a.y + b.y) / 2 + ny * 9 * style.labelScale;
        include(x - 24 * style.labelScale, y - 10 * style.labelScale);
        include(x + 24 * style.labelScale, y + 10 * style.labelScale);
        labels.push({ x, y, angle, text: metricLabel(metric, metricValue), color: labelColor(color) });
      }
    }
  }

  const margin = 24;
  const width = Math.max(1, bounds.maxX - bounds.minX + margin * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + margin * 2);
  const ox = margin - bounds.minX;
  const oy = margin - bounds.minY;
  const body: string[] = [`<rect width="${width.toFixed(2)}" height="${height.toFixed(2)}" fill="${tokens.white}"/>`];
  for (const item of lines.sort((a, b) => b.depth - a.depth)) body.push(item.svg(ox, oy));
  if (!style.verticesHidden) {
    for (const vertex of doc.vertices.values()) {
      const p = projected.get(vertex.id);
      if (!p) continue;
      const fill = style.vertexFill.enabled ? style.vertexFill.color : 'none';
      const outlineVisible = style.vertexOutline.enabled && style.vertexOutlineWidth > 0;
      const stroke = outlineVisible ? style.vertexOutline.color : 'none';
      const strokeWidth = outlineVisible ? compact(style.vertexOutlineWidth) : '0';
      body.push(`<circle cx="${(p.x + ox).toFixed(2)}" cy="${(p.y + oy).toFixed(2)}" r="${compact(style.vertexSize)}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`);
    }
  }
  for (const label of labels) {
    const x = label.x + ox;
    const y = label.y + oy;
    body.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" dominant-baseline="central" transform="rotate(${label.angle.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})" fill="${label.color}" stroke="${tokens.white}" stroke-width="3" paint-order="stroke" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="${compact(15 * style.labelScale)}" font-variant-numeric="tabular-nums">${escapeXml(label.text)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(2)}" height="${height.toFixed(2)}" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}">${body.join('')}</svg>`;
}

export function View3D({ store = getActiveStudioStore() }: { store?: StudioStore } = {}): JSX.Element {
  // All refs, listeners, renderer resources and saved cameras belong to one store.
  // Also protect callers outside ComparisonView when their store prop changes.
  return <SceneView key={storeInstanceKey(store)} store={store} />;
}

function SceneView({ store }: { store: StudioStore }): JSX.Element {
  const useStudioStore = store;
  const mountRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<ThreeState | null>(null);
  const dragVertexRef = useRef<number | null>(null);
  const moveDragRef = useRef<MoveDrag | null>(null);
  const renderedDocRef = useRef<Doc | null>(null);
  const emptyMissRef = useRef<{ x: number; y: number } | null>(null);
  const hoverKeyRef = useRef<string | null>(null);
  const forceInitialFit = useRef(consumePaneFit(store));
  const cameraInitializedRef = useRef(!forceInitialFit.current && getSavedCamera3d(store) !== null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const doc = useStudioStore((state) => state.doc);
  const projection = useStudioStore((state) => state.projection);
  const results = useStudioStore((state) => state.results);
  const metric = useStudioStore((state) => state.metric);
  const colorblindSafe = useStudioStore((state) => state.colorblindSafe);
  const labelsVisible = useStudioStore((state) => state.labelsVisible);
  const studioStyle = useStudioStore((state) => state.style);
  const style = useMemo(() => styleForView(studioStyle, '3d'), [studioStyle]);
  const customGradients = useStudioStore((state) => state.customGradients);
  const tool = useStudioStore((state) => state.tool);
  const selection = useStudioStore((state) => state.selection);
  const setSelection = useStudioStore((state) => state.setSelection);
  const createOrConvertEdge = useStudioStore((state) => state.createOrConvertEdge);
  const convertEdge = useStudioStore((state) => state.convertEdge);
  const deleteEntity = useStudioStore((state) => state.deleteEntity);
  const moveVertices3d = useStudioStore((state) => state.moveVertices3d);
  const denseLabels = labelsVisible && doc.edges.size > 600;
  const refs = useRef({ doc, tool, selection, labelsVisible, denseLabels, style, customGradients, setSelection, createOrConvertEdge, convertEdge, deleteEntity, moveVertices3d });

  refs.current = { doc, tool, selection, labelsVisible, denseLabels, style, customGradients, setSelection, createOrConvertEdge, convertEdge, deleteEntity, moveVertices3d };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(tokens.canvas);
    const initialProjection = useStudioStore.getState().projection;
    const camera = createCamera(initialProjection, mount.clientWidth / Math.max(1, mount.clientHeight));
    const contentGroup = new THREE.Group();
    const overlayGroup = new THREE.Group();
    const warningGroup = new THREE.Group();
    const hoverGroup = new THREE.Group();
    const ghostGroup = new THREE.Group();
    let renderer: THREE.WebGLRenderer;

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch (error) {
      setWebglError(error instanceof Error ? error.message : 'WebGL could not be initialized');
      return;
    }

    setWebglError(null);
    renderer.setPixelRatio(screenPixelRatio(mount.clientWidth, mount.clientHeight, window.devicePixelRatio));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);
    renderer.domElement.dataset.graphCanvas = '';
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute('aria-label', '3D graph canvas');

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d4ca, 2.2));
    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(3, 5, 6);
    scene.add(directional);
    // Graph inspection must remain visible regardless of coordinate units. No distance fog.
    scene.add(contentGroup, warningGroup, overlayGroup, hoverGroup, ghostGroup);

    let requestFrame = () => {};
    const invalidate = () => requestFrame();
    let navigationActive = false, linkingNavigation = false;
    let linkSnapshot: { quaternion: THREE.Quaternion; distance: number; zoom: number } | null = null;
    const snapshotNavigation = () => {
      const current = threeRef.current;
      if (!current) return null;
      return { quaternion: current.camera.quaternion.clone(), distance: current.camera.position.distanceTo(current.controls.target), zoom: current.camera.zoom };
    };
    let hoverDeferred = false;
    let lastPointerMove: PointerEvent | null = null;
    const onNavigationStart = () => { if (threeRef.current) threeRef.current.fitIds = null; navigationActive = true; linkingNavigation = true; linkSnapshot = snapshotNavigation(); hoverDeferred = true; clearHover(); invalidate(); };
    const onNavigationEnd = () => { navigationActive = false; invalidate(); };
    const controls = configureControls(camera, renderer.domElement, undefined, invalidate, onNavigationStart, onNavigationEnd);

    const savedCamera3d = getSavedCamera3d(store);
    if (savedCamera3d) {
      camera.position.fromArray(savedCamera3d.position);
      controls.target.fromArray(savedCamera3d.target);
      if (!isPerspectiveCamera(camera) && savedCamera3d.orthographic) {
        camera.left = savedCamera3d.orthographic.left;
        camera.right = savedCamera3d.orthographic.right;
        camera.top = savedCamera3d.orthographic.top;
        camera.bottom = savedCamera3d.orthographic.bottom;
        camera.zoom = savedCamera3d.orthographic.zoom;
        camera.updateProjectionMatrix();
      }
    }

    const state: ThreeState = {
      store,
      camera,
      contentGroup,
      controls,
      geometry: new SceneGeometry(),
      batches: new SceneBatches(),
      bondColors: new Map(),
      invalidate,
      onNavigationStart,
      onNavigationEnd,
      edgeMeshes: new Map(),
      vertexMeshes: new Map(),
      ghostGroup,
      hoverGroup,
      labels: new SceneLabels(contentGroup),
      quality: new InteractionQuality(),
      geometryStyleKey: '',
      intraKey: '',
      materials: {},
      stats: { frames: 0, raycasts: 0, rebuilds: 0, appearanceUpdates: 0, simplifiedMeshes: 0 },
      overlayGroup,
      pickables: [],
      detailMeshes: [],
      positions: new Map(),
      bounds: new THREE.Sphere(new THREE.Vector3(), 1), unitScale: 1, fitIds: savedCamera3d && !forceInitialFit.current ? null : 'all',
      projection: initialProjection,
      renderer,
      scene,
      tween: null,
      warningGroup
    };
    threeRef.current = state;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const pick = (event: PointerEvent): { userData: SelectionItem } | null => {
      state.stats.raycasts++;
      state.camera.updateMatrixWorld();
      scene.updateMatrixWorld();
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, state.camera);
      const item = state.geometry.withFullDetail(state.pickables, () => selectionForHit(raycaster.intersectObjects(state.pickables, false)[0]));
      return item ? { userData: item } : null;
    };
    const clearHover = () => {
      if (hoverGroup.children.length || hoverKeyRef.current !== null) invalidate();
      clearGroup(hoverGroup);
      hoverKeyRef.current = null;
    };
    const showHover = (object: { userData: SelectionItem } | null) => {
      const item = object?.userData as Partial<SelectionItem> | undefined;
      const key = item?.kind && typeof item.id === 'number' ? `${item.kind}:${item.id}` : null;
      const selected = new Set(refs.current.selection.map(selectionKey));
      if (!key || selected.has(key)) {
        clearHover();
        return;
      }
      if (key === hoverKeyRef.current) return;
      clearHover();
      const material = new THREE.MeshBasicMaterial({ color: tokens.accent, transparent: true, opacity: 0.5 });
      if (item?.kind === 'edge' && typeof item.id === 'number') {
        const edge = refs.current.doc.edges.get(item.id);
        const a = edge ? state.positions.get(edge.a) : undefined;
        const b = edge ? state.positions.get(edge.b) : undefined;
        if (!edge || !a || !b) return;
        hoverGroup.add(state.geometry.cylinder(a, b, selectedRadius(edge.kind, refs.current.style) * state.unitScale, material));
      } else if (item?.kind === 'vertex' && typeof item.id === 'number') {
        const p = state.positions.get(item.id);
        if (!p) return;
        const overlay = state.geometry.sphere(vertexOverlayRadius(refs.current.style) * state.unitScale, material);
        overlay.position.copy(p);
        hoverGroup.add(overlay);
      }
      hoverKeyRef.current = key;
      invalidate();
    };
    const clearGhost = () => { if (ghostGroup.children.length) invalidate(); clearGroup(ghostGroup); };
    const pointOnDragPlane = (event: PointerEvent, start: THREE.Vector3): THREE.Vector3 => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, state.camera);
      const normal = state.camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start);
      return raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? start.clone();
    };
    const updateGhost = (event: PointerEvent) => {
      const startId = dragVertexRef.current;
      if (startId === null) return;
      const start = state.positions.get(startId);
      if (!start) return;
      const object = pick(event);
      const item = object?.userData as Partial<SelectionItem> | undefined;
      const snapTarget = item?.kind === 'vertex' && typeof item.id === 'number' && item.id !== startId ? state.positions.get(item.id) : undefined;
      const end = snapTarget ?? pointOnDragPlane(event, start);
      clearGhost();
      ghostGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([start, end]), new THREE.LineBasicMaterial({ color: tokens.accent, transparent: true, opacity: 0.7 })));
      if (snapTarget) {
        const overlay = state.geometry.sphere(vertexOverlayRadius(refs.current.style) * state.unitScale, new THREE.MeshBasicMaterial({ color: tokens.accent, transparent: true, opacity: 0.5 }));
        overlay.position.copy(snapTarget);
        ghostGroup.add(overlay);
      }
      invalidate();
    };
    const pointOnPlane = (event: PointerEvent, plane: THREE.Plane): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
      raycaster.setFromCamera(pointer, state.camera);
      return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    };
    const cancelMoveDrag = () => {
      if (!moveDragRef.current) return;
      moveDragRef.current = null;
      restoreMouseButtons();
      const current = useStudioStore.getState();
      const currentStyle = styleForView(current.style, '3d');
      rebuildContent(state, current.doc, current.results, current.metric, current.colorblindSafe, current.labelsVisible, currentStyle, current.customGradients);
      rebuildSelectionOverlay(state, current.doc, current.selection, currentStyle);
      rebuildWarningOverlay(state, current.doc, currentStyle);
    };

    const onPointerDownCapture = (event: PointerEvent) => {
      state.fitIds = null;
      state.tween = null;
      state.controls.mouseButtons.LEFT = event.shiftKey ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.shiftKey && event.button === 0) return;
      emptyMissRef.current = null;
      const object = pick(event);
      const current = refs.current;
      if (!object) {
        if (event.button === 0 && (current.tool === 'select' || current.tool === 'bond' || current.tool === 'brace' || current.tool === 'erase')) {
          emptyMissRef.current = { x: event.clientX, y: event.clientY };
        }
        return;
      }
      const item = object.userData as Partial<SelectionItem>;
      if (item.kind === 'vertex' && typeof item.id === 'number' && (current.tool === 'bond' || current.tool === 'brace')) {
        dragVertexRef.current = item.id;
        state.controls.enabled = false;
      } else if (item.kind === 'edge' && typeof item.id === 'number' && (current.tool === 'bond' || current.tool === 'brace')) {
        current.convertEdge(item.id, current.tool as 'bond' | 'brace');
      } else if (current.tool === 'erase') {
        if ((item.kind === 'vertex' || item.kind === 'edge') && typeof item.id === 'number') current.deleteEntity({ kind: item.kind, id: item.id });
      } else if (current.tool === 'select') {
        if (item.kind === 'vertex' && typeof item.id === 'number') {
          const selectedKeys = new Set(current.selection.map(selectionKey));
          const ids = selectedKeys.has(`vertex:${item.id}`)
            ? current.selection.filter((entry) => entry.kind === 'vertex').map((entry) => entry.id)
            : [item.id];
          current.setSelection(ids.length === 1 ? [{ kind: 'vertex', id: item.id }] : current.selection);
          const start = state.positions.get(item.id);
          if (!start) return;
          const normal = state.camera.getWorldDirection(new THREE.Vector3());
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, start);
          moveDragRef.current = {
            ids,
            original: new Map(ids.map((id) => [id, state.positions.get(id)?.clone() ?? new THREE.Vector3()])),
            plane,
            lastPoint: start.clone()
          };
          state.controls.enabled = false;
        } else if (item.kind === 'edge' && typeof item.id === 'number') current.setSelection([{ kind: item.kind, id: item.id }]);
      }
    };
    const processPointerMove = (event: PointerEvent) => {
      if (moveDragRef.current) {
        const hit = pointOnPlane(event, moveDragRef.current.plane);
        if (!hit) return;
        const delta = hit.clone().sub(moveDragRef.current.lastPoint);
        moveDragRef.current.lastPoint.copy(hit);
        for (const id of moveDragRef.current.ids) {
          const current = state.positions.get(id);
          if (current) current.add(delta);
        }
        const current = useStudioStore.getState();
        updateMovedGeometry(state, current.doc, moveDragRef.current.ids);
      } else if (dragVertexRef.current !== null) updateGhost(event);
      else if (navigationActive || state.quality.preview) { hoverDeferred = true; clearHover(); }
      else showHover(pick(event));
    };
    let pendingPointerMove: PointerEvent | null = null;
    const onPointerMove = (event: PointerEvent) => { lastPointerMove = event; pendingPointerMove = event; invalidate(); };
    const flushPointerMove = () => {
      const event = pendingPointerMove;
      pendingPointerMove = null;
      if (event) processPointerMove(event);
    };
    const restoreMouseButtons = () => {
      state.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      state.controls.enabled = true;
    };
    const onPointerCancel = () => {
      navigationActive = false; lastPointerMove = null; hoverDeferred = false;
      pendingPointerMove = null;
      cancelMoveDrag();
      dragVertexRef.current = null;
      clearGhost();
      emptyMissRef.current = null;
      restoreMouseButtons();
    };
    const onPointerUp = (event: PointerEvent) => {
      // A release may arrive before the queued frame: commit the final pointer position.
      if (moveDragRef.current) pendingPointerMove = event;
      flushPointerMove();
      const start = dragVertexRef.current;
      const moveDrag = moveDragRef.current;
      dragVertexRef.current = null;
      moveDragRef.current = null;
      restoreMouseButtons();
      clearGhost();
      const emptyMiss = emptyMissRef.current;
      emptyMissRef.current = null;
      if (emptyMiss && (refs.current.tool === 'select' || refs.current.tool === 'bond' || refs.current.tool === 'brace' || refs.current.tool === 'erase')) {
        if (Math.hypot(event.clientX - emptyMiss.x, event.clientY - emptyMiss.y) < 5) refs.current.setSelection([]);
        return;
      }
      if (moveDrag) {
        const positions = moveDrag.ids.map((id) => {
          const point = state.positions.get(id) ?? moveDrag.original.get(id)!;
          return { id, p3: [point.x, point.y, point.z] as [number, number, number] };
        });
        const before = useStudioStore.getState().doc;
        refs.current.moveVertices3d(positions);
        if (useStudioStore.getState().doc === before) {
          // A coordinate-limit rejection must also discard the transient drag preview.
          for (const id of moveDrag.ids) state.positions.get(id)!.copy(vertexPosition(before.vertices.get(id)!));
          updateMovedGeometry(state, before, moveDrag.ids);
          invalidate();
        }
        return;
      }
      const current = refs.current;
      if (start === null || (current.tool !== 'bond' && current.tool !== 'brace')) return;
      const object = pick(event);
      const item = object?.userData as Partial<SelectionItem> | undefined;
      if (item?.kind === 'vertex' && typeof item.id === 'number' && item.id !== start) current.createOrConvertEdge(start, item.id, current.tool);
    };
    const onPointerLeave = () => {
      navigationActive = false; lastPointerMove = null; hoverDeferred = false;
      pendingPointerMove = null;
      clearHover();
      clearGhost();
      dragVertexRef.current = null;
      emptyMissRef.current = null;
      cancelMoveDrag();
      restoreMouseButtons();
    };
    const resize = () => {
      if (mount.clientWidth <= 0 || mount.clientHeight <= 0) return;
      renderer.setPixelRatio(screenPixelRatio(mount.clientWidth, mount.clientHeight, window.devicePixelRatio));
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      resizeCamera(state.camera, mount.clientWidth, mount.clientHeight);
      if (!compactViewport(store) || !document.querySelector('#results-panel')) {
        applyViewport(state);
        if (state.fitIds) frameContent(state, state.fitIds === 'all' ? [...state.positions.values()] : state.fitIds.flatMap(id => state.positions.get(id) ?? []), false);
      }
      invalidate();
    };
    const requireRenderedScene = () => {
      if (threeRef.current !== state || !renderer.domElement.isConnected ||
          mount.clientWidth <= 0 || mount.clientHeight <= 0 ||
          renderer.getContext().isContextLost() || renderedDocRef.current !== store.getState().doc) {
        throw new Error('The 3D view is not ready. Wait for it to finish drawing, then export again. If needed, switch to 2D and back to 3D.', { cause: { sameScene: threeRef.current === state, connected: renderer.domElement.isConnected, width: mount.clientWidth, height: mount.clientHeight, contextLost: renderer.getContext().isContextLost(), currentDocument: renderedDocRef.current === store.getState().doc } });
      }
    };
    const capture3d = () => {
      requireRenderedScene();
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      const oldPixelRatio = renderer.getPixelRatio();
      const oldSize = renderer.getSize(new THREE.Vector2());
      const oldProjection = isPerspectiveCamera(state.camera)
        ? { kind: 'perspective' as const, aspect: state.camera.aspect }
        : {
            kind: 'orthographic' as const,
            left: state.camera.left,
            right: state.camera.right,
            top: state.camera.top,
            bottom: state.camera.bottom,
            zoom: state.camera.zoom
          };
      const oldStyleWidth = renderer.domElement.style.width;
      const oldStyleHeight = renderer.domElement.style.height;
      try {
        renderer.setPixelRatio(1);
        renderer.setSize(width * 2, height * 2, false);
        resizeCamera(state.camera, width, height);
        state.controls.update();
        state.camera.updateMatrixWorld();
        updateLabelSprites(state, refs.current.labelsVisible, refs.current.denseLabels, hoverKeyRef.current, refs.current.selection, refs.current.style.labelScale);
        return state.geometry.withFullDetail(state.detailMeshes, () => {
          renderer.render(scene, state.camera);
          return renderer.domElement.toDataURL('image/png');
        });
      } finally {
        renderer.setPixelRatio(oldPixelRatio);
        renderer.setSize(oldSize.x, oldSize.y, false);
        renderer.domElement.style.width = oldStyleWidth;
        renderer.domElement.style.height = oldStyleHeight;
        if (oldProjection.kind === 'perspective' && isPerspectiveCamera(state.camera)) {
          state.camera.aspect = oldProjection.aspect;
        } else if (oldProjection.kind === 'orthographic' && !isPerspectiveCamera(state.camera)) {
          state.camera.left = oldProjection.left;
          state.camera.right = oldProjection.right;
          state.camera.top = oldProjection.top;
          state.camera.bottom = oldProjection.bottom;
          state.camera.zoom = oldProjection.zoom;
        }
        state.camera.updateProjectionMatrix();
        updateLabelSprites(state, refs.current.labelsVisible, refs.current.denseLabels, hoverKeyRef.current, refs.current.selection, refs.current.style.labelScale, state.quality.preview);
        renderer.render(scene, state.camera);
        invalidate();
      }
    };
    const exportSvg3d = () => {
      requireRenderedScene();
      return renderProjectedSvg3d(
        state,
        refs.current.doc,
        useStudioStore.getState().results,
        useStudioStore.getState().metric,
        useStudioStore.getState().colorblindSafe,
        refs.current.labelsVisible,
        refs.current.denseLabels,
        hoverKeyRef.current,
        refs.current.selection,
        refs.current.style,
        refs.current.customGradients
      );
    };
    const onFit3d = (event: Event) => { if (eventForStore(event, store)) { consumePaneFit(store); linkingNavigation=false; fitToContent(state, true); } };
    const onLocate3d = (event: Event) => {
      if (!eventForStore(event, store)) return;
      linkingNavigation = false;
      const edgeId = (event as CustomEvent<{ edgeId?: number }>).detail?.edgeId;
      if (typeof edgeId === 'number') locateEdge(state, refs.current.doc, edgeId);
    };
    const onCancelDrag = (event: Event) => {
      const active = dragVertexRef.current !== null || moveDragRef.current !== null;
      if (active) event.preventDefault();
      cancelMoveDrag();
      dragVertexRef.current = null;
      emptyMissRef.current = null;
      clearGhost();
      restoreMouseButtons();
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDownCapture, true);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('resize', resize);
    const onViewportChanged = () => { if (state.fitIds) resize(); };
    window.addEventListener(GRAPH_VIEWPORT_CHANGED, onViewportChanged);
    window.addEventListener(CANCEL_DRAG_EVENT, onCancelDrag);
    const restoreCamera = (event: Event) => {
      if (!eventForStore(event, store)) return;
      const saved = getSavedCamera3d(store);
      state.fitIds = saved ? null : 'all';
      if (!saved) {
        state.tween = null; state.camera.position.set(4, 3, 6); state.controls.target.set(0, 0, 0);
        state.controls.update(); cameraInitializedRef.current = false; invalidate(); return;
      }
      switchProjection(state, saved.projection);
      state.camera.position.fromArray(saved.position);
      state.controls.target.fromArray(saved.target);
      if (!isPerspectiveCamera(state.camera) && saved.orthographic) Object.assign(state.camera, saved.orthographic);
      state.camera.updateProjectionMatrix();
      applyViewport(state);
      state.camera.lookAt(state.controls.target);
      state.tween = null;
      cameraInitializedRef.current = true;
      state.controls.update();
      invalidate();
    };
    window.addEventListener('curvature-studio:restore-camera', restoreCamera);
    window.addEventListener('curvature-studio:fit-3d', onFit3d);
    window.addEventListener('curvature-studio:locate-3d', onLocate3d);

    const renderStats = (includeProjection = false) => ({ ...state.stats, labels: { ...state.labels.stats }, quality: state.quality.level,
      pixelRatio: renderer.getPixelRatio(), preview: state.quality.preview, navigationFrameIntervals: state.quality.frameIntervals(),
      drawCalls: renderer.info?.render.calls ?? null, triangles: renderer.info?.render.triangles ?? null,
      ...(includeProjection ? { fog: scene.fog !== null, unitScale: state.unitScale, viewport: readGraphViewport(mount.clientWidth, mount.clientHeight, store),
        camera: { position: state.camera.position.toArray(), target: state.controls.target.toArray(), projection: state.projection,
          orthographic: isPerspectiveCamera(state.camera) ? undefined : { bottom: state.camera.bottom, left: state.camera.left, right: state.camera.right, top: state.camera.top, zoom: state.camera.zoom } },
        projectedVertices: [...state.positions].map(([id, point]) => { const p = point.clone().project(state.camera);
          return { id, x: (p.x + 1) * mount.clientWidth / 2, y: (1 - p.y) * mount.clientHeight / 2, z: p.z }; }) } : {}) });
    const sceneApi: NonNullable<ReturnType<typeof sceneApis.get>> = { capture: capture3d, svg: exportSvg3d, stats: renderStats, navigate: (rotation, zoom) => {
      linkingNavigation = false; state.tween = null; state.fitIds = null;
      const offset = state.camera.position.clone().sub(state.controls.target).applyQuaternion(new THREE.Quaternion().fromArray(rotation));
      if (isPerspectiveCamera(state.camera)) offset.multiplyScalar(zoom);
      else { state.camera.zoom = Math.max(1e-6, Math.min(1e6, state.camera.zoom / zoom)); state.camera.updateProjectionMatrix(); }
      state.camera.position.copy(state.controls.target).add(offset);
      state.camera.lookAt(state.controls.target); state.controls.update(); invalidate();
    } };
    sceneApis.set(store, sceneApi);
    installSceneApis();

    let cameraSignature = '';
    let refreshFonts = false;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const scheduler = createRenderScheduler((time) => {
      if (refreshFonts && !moveDragRef.current && dragVertexRef.current === null) {
        refreshFonts = false;
        state.labels.invalidateFonts();
      }
      if (state.tween) {
        const t = Math.min(1, (performance.now() - state.tween.start) / 300);
        const eased = ease(t);
        state.camera.position.lerpVectors(state.tween.fromPosition, state.tween.toPosition, eased);
        state.controls.target.lerpVectors(state.tween.fromTarget, state.tween.toTarget, eased);
        if (t >= 1) state.tween = null;
      }
      const cameraMoving = state.controls.update();
      state.camera.updateMatrixWorld();
      const nextNavigation = snapshotNavigation();
      const comparison = useComparison.getState();
      if (linkingNavigation && linkSnapshot && nextNavigation && comparison.mode === 'compare' && comparison.linked) {
        const rotation = nextNavigation.quaternion.clone().multiply(linkSnapshot.quaternion.clone().invert());
        const zoom = isPerspectiveCamera(state.camera) ? nextNavigation.distance / Math.max(1e-12, linkSnapshot.distance) : linkSnapshot.zoom / nextNavigation.zoom;
        if (rotation.angleTo(new THREE.Quaternion()) > 1e-8 || Math.abs(zoom - 1) > 1e-8) {
          for (const other of comparison.documents) if (other.studio !== store) {
            const api = sceneApis.get(other.studio);
            if (api) api.navigate(rotation.toArray(), zoom);
            else {
              const saved = getSavedCamera3d(other.studio);
              if (saved) {
                const target = new THREE.Vector3().fromArray(saved.target);
                const offset = new THREE.Vector3().fromArray(saved.position).sub(target).applyQuaternion(rotation);
                if (saved.orthographic) saved.orthographic.zoom = Math.max(1e-6,Math.min(1e6,saved.orthographic.zoom/zoom)); else offset.multiplyScalar(zoom);
                saved.position = offset.add(target).toArray(); setSavedCamera3d(saved,other.studio);
              }
            }
          }
        }
      }
      linkSnapshot = nextNavigation;
      if (!navigationActive && !cameraMoving) linkingNavigation = false;
      if (state.positions.size) updateClipping(state.camera, state.bounds, state.unitScale * 0.1);
      state.quality.update(time, cameraMoving || !!state.tween, navigationActive);
      flushPointerMove();
      if (hoverDeferred && !state.quality.preview && !navigationActive && !moveDragRef.current && dragVertexRef.current === null) {
        hoverDeferred = false;
        if (lastPointerMove) showHover(pick(lastPointerMove));
      }
      const pixelRatio = state.quality.pixelRatio(screenPixelRatio(mount.clientWidth, mount.clientHeight, window.devicePixelRatio));
      if (Math.abs(renderer.getPixelRatio() - pixelRatio) > 1e-6) renderer.setDrawingBufferSize(mount.clientWidth, mount.clientHeight, pixelRatio);
      state.stats.simplifiedMeshes = state.geometry.preview(state.detailMeshes, state.camera, mount.clientHeight, state.quality.preview);
      const saved = {
        position: state.camera.position.toArray(), projection: state.projection, target: state.controls.target.toArray(),
        orthographic: isPerspectiveCamera(state.camera) ? undefined : { bottom: state.camera.bottom, left: state.camera.left, right: state.camera.right, top: state.camera.top, zoom: state.camera.zoom }
      };
      updateLabelSprites(state, refs.current.labelsVisible, refs.current.denseLabels, hoverKeyRef.current, refs.current.selection, refs.current.style.labelScale, state.quality.preview);
      renderer.render(scene, state.camera);
      state.stats.frames++;
      const nextCameraSignature = JSON.stringify(saved);
      if (nextCameraSignature !== cameraSignature) {
        cameraSignature = nextCameraSignature;
        setSavedCamera3d(saved, store);
        window.dispatchEvent(new Event(WORKSPACE_CHANGED));
      }
      return !!state.tween || cameraMoving || state.quality.needsFrame;
    });
    requestFrame = scheduler.request;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { navigationActive = false; state.quality.reset(); lastPointerMove = null; hoverDeferred = false; }
      scheduler.setVisible(document.visibilityState !== 'hidden');
      if (document.visibilityState !== 'hidden') resize();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    document.addEventListener('visibilitychange', onVisibility);
    renderer.domElement.addEventListener('webglcontextrestored', invalidate);
    onVisibility();
    // Font arrival can change label metrics even when the graph is otherwise idle.
    let disposed = false;
    void document.fonts?.ready.then(() => {
      if (disposed) return;
      refreshFonts = true;
      invalidate();
    });

    return () => {
      disposed = true;
      scheduler.dispose();
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      renderer.domElement.removeEventListener('webglcontextrestored', invalidate);
      window.removeEventListener('resize', resize);
      window.removeEventListener(GRAPH_VIEWPORT_CHANGED, onViewportChanged);
      window.removeEventListener('curvature-studio:restore-camera', restoreCamera);
      window.removeEventListener(CANCEL_DRAG_EVENT, onCancelDrag);
      window.removeEventListener('curvature-studio:fit-3d', onFit3d);
      window.removeEventListener('curvature-studio:locate-3d', onLocate3d);
      renderer.domElement.removeEventListener('pointerdown', onPointerDownCapture, true);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      // A pane-to-single transition may already have registered its replacement.
      if (sceneApis.get(store) === sceneApi) sceneApis.delete(store);
      state.labels.dispose();
      clearGroup(contentGroup);
      clearGroup(overlayGroup);
      clearGroup(warningGroup);
      clearGroup(hoverGroup);
      clearGroup(ghostGroup);
      state.geometry.dispose();
      state.controls.removeEventListener('change', invalidate);
      state.controls.removeEventListener('start', onNavigationStart);
      state.controls.removeEventListener('end', onNavigationEnd);
      state.controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      threeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = threeRef.current;
    if (!state) return;
    switchProjection(state, projection);
    resizeCamera(state.camera, state.renderer.domElement.clientWidth, state.renderer.domElement.clientHeight);
    applyViewport(state);
    if (state.fitIds) frameContent(state, state.fitIds === 'all' ? [...state.positions.values()] : state.fitIds.flatMap(id => state.positions.get(id) ?? []), false);
    state.invalidate();
  }, [projection]);

  useEffect(() => {
    const state = threeRef.current;
    if (!state) return;
    const previousDoc = renderedDocRef.current;
    const reuseGeometry = previousDoc?.edges === doc.edges && previousDoc.vertices.size === doc.vertices.size &&
      state.geometryStyleKey === geometryStyleKey(style) && state.intraKey === intraKey(doc, results);
    const preserveGesture = previousDoc === doc && (moveDragRef.current !== null || dragVertexRef.current !== null);
    const moving = preserveGesture && moveDragRef.current ? moveDragRef.current.ids.map(id => ({ id, position: state.positions.get(id)!.clone() })) : [];
    if (reuseGeometry) {
      const changed: number[] = [];
      if (previousDoc !== doc) for (const vertex of doc.vertices.values()) {
        if (previousDoc.vertices.get(vertex.id) === vertex) continue;
        const position = vertexPosition(vertex), existing = state.positions.get(vertex.id)!;
        if (!existing.equals(position)) { existing.copy(position); changed.push(vertex.id); }
      }
      if (changed.length) updateMovedGeometry(state, doc, changed);
      refreshAppearance(state, doc, results, metric, colorblindSafe, labelsVisible, style, customGradients);
    } else {
      rebuildContent(state, doc, results, metric, colorblindSafe, labelsVisible, style, customGradients);
      for (const { id, position } of moving) state.positions.get(id)!.copy(position);
      if (moving.length) updateMovedGeometry(state, doc, moving.map(value => value.id));
      rebuildSelectionOverlay(state, doc, selection, style);
      rebuildWarningOverlay(state, doc, style);
    }
    state.bounds = new THREE.Box3().setFromPoints([...state.positions.values()]).getBoundingSphere(new THREE.Sphere());
    renderedDocRef.current = doc;
    if (!reuseGeometry || previousDoc !== doc) { clearGroup(state.hoverGroup); hoverKeyRef.current = null; }
    if (!preserveGesture) {
      clearGroup(state.ghostGroup);
      dragVertexRef.current = null;
      moveDragRef.current = null;
      state.controls.enabled = true;
    }
    if (doc.vertices.size === 0) {
      setSavedCamera3d(null, store);
      cameraInitializedRef.current = false;
    } else if (!cameraInitializedRef.current) {
      fitToContent(state, false);
      cameraInitializedRef.current = true;
    }
  }, [doc, results, metric, colorblindSafe, labelsVisible, style, customGradients]);

  useEffect(() => {
    const state = threeRef.current;
    if (!state) return;
    rebuildSelectionOverlay(state, doc, selection, style);
  }, [doc, selection, style]);

  return (
    <div ref={mountRef} className="canvas-layer">
      {webglError ? (
        <div className="empty-state panel webgl-fallback" style={{ padding: 16 }} role="status">
          <p>{t("3D view unavailable - WebGL could not be initialized on this machine.")}</p>
          <button className="button" onClick={() => useStudioStore.getState().setView('2d')}>{t("Continue in 2D")}</button>
        </div>
      ) : null}
      {denseLabels ? <div className="dense-label-chip panel">{t("labels: dense mode")}</div> : null}
    </div>
  );
}
