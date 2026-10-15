import { t } from '../i18n';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { labelColor, metricColor, metricLabel, neutralizedRigidColor, tokens } from '../design/tokens';
import { CANCEL_DRAG_EVENT } from '../state/dragController';
import { canvasDocument } from '../state/documentView';
import { edgeArray, isolatedVertexIds, selectedVertexIds, vertexArray } from '../state/history';
import { modelToScreen, screenToModel, getActiveStudioStore, type StudioStore, useStudioStore } from '../state/store';
import { styleForView } from '../state/style';
import type { Camera2d, Edge, SelectionItem, Vertex, VertexId } from '../state/types';

type DragState =
  | null
  | {
      kind: 'draw';
      edgeKind: 'bond' | 'brace';
      startScreen: { x: number; y: number };
      currentScreen: { x: number; y: number };
      startModel: { x: number; y: number };
      startVertex?: VertexId;
    }
  | { kind: 'pan'; startScreen: { x: number; y: number }; startCamera: { tx: number; ty: number; scale: number } }
  | { kind: 'move'; startScreen: { x: number; y: number }; currentScreen: { x: number; y: number }; vertexIds: VertexId[] }
  | { kind: 'box'; startScreen: { x: number; y: number }; currentScreen: { x: number; y: number }; additive: boolean }
  | { kind: 'erase'; items: SelectionItem[] };

function pointFromEvent(event: React.PointerEvent<SVGSVGElement> | React.WheelEvent<SVGSVGElement> | React.MouseEvent<SVGSVGElement>): { x: number; y: number } {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function selectionKey(item: SelectionItem): string {
  return `${item.kind}:${item.id}`;
}

function toggled(selection: SelectionItem[], item: SelectionItem): SelectionItem[] {
  const key = selectionKey(item);
  return selection.some((entry) => selectionKey(entry) === key) ? selection.filter((entry) => selectionKey(entry) !== key) : [...selection, item];
}

function dashPattern(width: number): string {
  return `${3 * width} ${1.5 * width}`;
}

export function Canvas2D({ store = getActiveStudioStore() }: { store?: StudioStore } = {}): JSX.Element {
  const useStudioStore = store;
  const doc = useStudioStore((state) => canvasDocument(state.doc));
  const tool = useStudioStore((state) => state.tool);
  const metric = useStudioStore((state) => state.metric);
  const setCamera = useStudioStore((state) => state.setCamera2d);
  const selection = useStudioStore((state) => state.selection);
  const setSelection = useStudioStore((state) => state.setSelection);
  const clearSelection = useStudioStore((state) => state.clearSelection);
  const addVertex = useStudioStore((state) => state.addVertex);
  const createOrConvertEdge = useStudioStore((state) => state.createOrConvertEdge);
  const createVertexAndEdge = useStudioStore((state) => state.createVertexAndEdge);
  const createEdgeBetweenNewVertices = useStudioStore((state) => state.createEdgeBetweenNewVertices);
  const convertEdge = useStudioStore((state) => state.convertEdge);
  const deleteSelection = useStudioStore((state) => state.deleteSelection);
  const beginEraseGesture = useStudioStore((state) => state.beginEraseGesture);
  const scrubEraseItem = useStudioStore((state) => state.scrubEraseItem);
  const endEraseGesture = useStudioStore((state) => state.endEraseGesture);
  const moveVertices = useStudioStore((state) => state.moveVertices);
  const fit2d = useStudioStore((state) => state.fit2d);
  const labelsVisible = useStudioStore((state) => state.labelsVisible);
  const results = useStudioStore((state) => state.results);
  const colorblindSafe = useStudioStore((state) => state.colorblindSafe);
  const studioStyle = useStudioStore((state) => state.style);
  const style = useMemo(() => styleForView(studioStyle, '2d'), [studioStyle]);
  const customGradients = useStudioStore((state) => state.customGradients);
  const histogramHoverBin = useStudioStore((state) => state.histogramHoverBin);
  const setHistogramHoverBin = useStudioStore((state) => state.setHistogramHoverBin);
  const computing = useStudioStore((state) => state.computing);
  const [drag, setDrag] = useState<DragState>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [hover, setHover] = useState<SelectionItem | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const dragRef = useRef<DragState>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const graphLayerRef = useRef<SVGGElement>(null);
  const labelLayerRef = useRef<SVGGElement>(null);
  const liveCameraRef = useRef<Camera2d>(useStudioStore.getState().camera2d);
  const paintedCameraRef = useRef<Camera2d>(liveCameraRef.current);
  const refreshCoordinates = useRef(true);
  const rafRef = useRef<number | null>(null);
  const domIndex = useRef({ vertices: new Map<number, SVGCircleElement[]>(), edges: new Map<number, SVGLineElement[]>(), labels: new Map<number, SVGTextElement>() });
  const pointerFrame = useRef<number | null>(null);
  const pointerPoint = useRef<{ x: number; y: number } | null>(null);
  const pointerMove = useRef<(point: { x: number; y: number }) => void>(() => {});
  const tooltipTimer = useRef<number | undefined>(undefined);
  const renderCountRef = useRef(0);
  const erasedKeysRef = useRef(new Set<string>());
  const linkedBinKeyRef = useRef<string | null>(null);
  const vertexFill = style.vertexFill;
  const vertexOutline = style.vertexOutline;
  const verticesHidden = style.verticesHidden;
  const braceColor = style.braceColor;
  const braceStyle = style.braceStyle;
  const bondStyle = style.bondStyle;
  const bondCasing = style.bondCasing;
  const intraColor = braceColor === tokens.ink800 ? tokens.neutral400 : neutralizedRigidColor(braceColor);
  const bondWidth = style.bondWidth;
  const vertexSize = style.vertexSize;
  const vertexOutlineWidth = style.vertexOutlineWidth;
  const casingWidth = style.bondCasingWidth;
  const labelScale = style.labelScale;
  const labelThreshold = 34 * labelScale;
  const labelOffset = 7 * labelScale;
  const vertexPickRadius = Math.max(12, vertexSize + 7.5);
  const vertexSnapRadius = Math.max(14, vertexSize + 9.5);

  renderCountRef.current += 1;
  dragRef.current = drag;
  if (typeof window !== 'undefined') {
    (window as typeof window & { __curvatureStudio2dRenderCount?: number }).__curvatureStudio2dRenderCount = renderCountRef.current;
  }

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceDown(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    const cancel = (event: Event) => {
      if (dragRef.current) event.preventDefault();
      setDrag((current) => {
        if (current?.kind === 'erase') endEraseGesture();
        return null;
      });
    };
    window.addEventListener(CANCEL_DRAG_EVENT, cancel);
    return () => window.removeEventListener(CANCEL_DRAG_EVENT, cancel);
  }, [endEraseGesture]);

  const vertices = useMemo(() => vertexArray(doc), [doc]);
  const edges = useMemo(() => edgeArray(doc), [doc.edges]);
  const isolatedIds = useMemo(() => new Set(isolatedVertexIds(doc)), [doc]);
  const selectedKeys = useMemo(() => new Set(selection.map(selectionKey)), [selection]);
  const moveOffset =
    drag?.kind === 'move'
      ? {
          x: (drag.currentScreen.x - drag.startScreen.x) / liveCameraRef.current.scale,
          y: (drag.currentScreen.y - drag.startScreen.y) / liveCameraRef.current.scale
        }
      : { x: 0, y: 0 };

  const vertexModel = (vertex: Vertex): { x: number; y: number } => {
    if (drag?.kind === 'move' && drag.vertexIds.includes(vertex.id)) return { x: vertex.x + moveOffset.x, y: vertex.y + moveOffset.y };
    return vertex;
  };

  const vertexScreen = (vertex: Vertex, cam = liveCameraRef.current): { x: number; y: number } => modelToScreen(vertexModel(vertex), cam);
  const getVertex = (id: VertexId): Vertex | undefined => doc.vertices.get(id);

  const scheduleDomUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const svg = svgRef.current;
      if (!svg) return;
      const cam = liveCameraRef.current;
      const painted = paintedCameraRef.current;
      if (!refreshCoordinates.current && dragRef.current?.kind !== 'move' && cam.scale === painted.scale) {
        graphLayerRef.current?.setAttribute('transform', `translate(${cam.tx - painted.tx} ${cam.ty - painted.ty})`);
        return;
      }
      refreshCoordinates.current = false;
      graphLayerRef.current?.removeAttribute('transform');
      paintedCameraRef.current = cam;
      const points = new Map<number, { x: number; y: number }>();
      const active = dragRef.current;
      const moving = new Set(active?.kind === 'move' ? active.vertexIds : []);
      const dx = active?.kind === 'move' ? active.currentScreen.x - active.startScreen.x : 0;
      const dy = active?.kind === 'move' ? active.currentScreen.y - active.startScreen.y : 0;
      for (const vertex of vertices) {
        const p = modelToScreen(vertex, cam);
        if (moving.has(vertex.id)) { p.x += dx; p.y += dy; }
        points.set(vertex.id, p);
        for (const circle of domIndex.current.vertices.get(vertex.id) ?? []) {
          circle.setAttribute('cx', String(p.x));
          circle.setAttribute('cy', String(p.y));
        }
      }
      for (const edge of edges) {
        const a = points.get(edge.a), b = points.get(edge.b);
        if (!a || !b) continue;
        const lines = domIndex.current.edges.get(edge.id) ?? [];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        const gap = (bondWidth / 2) * 1.6;
        const nx = (-dy / len) * gap;
        const ny = (dx / len) * gap;
        lines.forEach((line) => {
          const offset = Number(line.dataset.edgeOffset ?? 0);
          line.setAttribute('x1', String(a.x + nx * offset));
          line.setAttribute('y1', String(a.y + ny * offset));
          line.setAttribute('x2', String(b.x + nx * offset));
          line.setAttribute('y2', String(b.y + ny * offset));
        });
        const label = domIndex.current.labels.get(edge.id);
        if (label) {
          let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (angle > 90 || angle <= -90) angle += 180;
          let lnx = -dy / len;
          let lny = dx / len;
          if (lny > 0) {
            lnx = -lnx;
            lny = -lny;
          }
          const x = (a.x + b.x) / 2 + lnx * labelOffset;
          const y = (a.y + b.y) / 2 + lny * labelOffset;
          label.setAttribute('x', String(x));
          label.setAttribute('y', String(y));
          label.setAttribute('transform', `rotate(${angle} ${x} ${y})`);
          const force = selectedKeys.has(`edge:${edge.id}`) || hover?.kind === 'edge' && hover.id === edge.id;
          label.style.display = labelsVisible && (force || Math.hypot(dx, dy) >= labelThreshold) ? '' : 'none';
        }
      }
      if (labelLayerRef.current) {
        labelLayerRef.current.style.display = drag?.kind === 'pan' && edges.length > 400 ? 'none' : '';
      }
    });
  }, [bondWidth, drag?.kind, edges, hover, labelOffset, labelsVisible, labelThreshold, selectedKeys, vertices]);

  // Re-index only after React changes the SVG. Camera frames use direct references.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const index = { vertices: new Map<number, SVGCircleElement[]>(), edges: new Map<number, SVGLineElement[]>(), labels: new Map<number, SVGTextElement>() };
    for (const circle of svg.querySelectorAll<SVGCircleElement>('[data-vertex-id], [data-isolated-vertex-id], [data-vertex-selection-halo], [data-vertex-hover]')) {
      const id = Number(circle.dataset.vertexId ?? circle.dataset.isolatedVertexId ?? circle.dataset.vertexSelectionHalo ?? circle.dataset.vertexHover);
      const circles = index.vertices.get(id) ?? [];
      circles.push(circle); index.vertices.set(id, circles);
    }
    for (const group of svg.querySelectorAll<SVGGElement>('[data-edge-id]')) index.edges.set(Number(group.dataset.edgeId), [...group.querySelectorAll<SVGLineElement>('line[data-edge-line]')]);
    for (const label of svg.querySelectorAll<SVGTextElement>('[data-label-id]')) index.labels.set(Number(label.dataset.labelId), label);
    domIndex.current = index;
    // React may have changed only some coordinate attributes; normalize once before paint.
    refreshCoordinates.current = true;
    scheduleDomUpdate();
  });

  useLayoutEffect(() => {
    const update = () => { liveCameraRef.current = useStudioStore.getState().camera2d; scheduleDomUpdate(); };
    update();
    const unsubscribe = useStudioStore.subscribe((next, before) => { if (next.camera2d !== before.camera2d) update(); });
    return () => { unsubscribe(); if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [scheduleDomUpdate]);

  const cancelPointerFrame = () => {
    if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = null; pointerPoint.current = null;
    clearTimeout(tooltipTimer.current);
  };
  useEffect(() => () => cancelPointerFrame(), []);

  const pickVertex = (point: { x: number; y: number }, radius = vertexPickRadius): Vertex | undefined => {
    let best: Vertex | undefined;
    let bestDistance = radius;
    for (const vertex of vertices) {
      const d = dist(point, vertexScreen(vertex));
      if (d <= bestDistance) {
        bestDistance = d;
        best = vertex;
      }
    }
    return best;
  };

  const pickEdge = (point: { x: number; y: number }, radius = 8): Edge | undefined => {
    let best: Edge | undefined;
    let bestDistance = radius;
    for (const edge of edges) {
      const a = getVertex(edge.a);
      const b = getVertex(edge.b);
      if (!a || !b) continue;
      const d = distanceToSegment(point, vertexScreen(a), vertexScreen(b));
      if (d <= bestDistance) {
        bestDistance = d;
        best = edge;
      }
    }
    return best;
  };

  const snapVertex = (point: { x: number; y: number }, exclude?: VertexId): Vertex | undefined => {
    const vertex = pickVertex(point, vertexSnapRadius);
    return vertex?.id === exclude ? undefined : vertex;
  };

  const itemAt = (point: { x: number; y: number }): SelectionItem | null => {
    const vertex = pickVertex(point);
    if (vertex) return { kind: 'vertex', id: vertex.id };
    const edge = pickEdge(point);
    if (edge) return { kind: 'edge', id: edge.id };
    return null;
  };

  const tooltipText = (item: SelectionItem): string | null => {
    if (item.kind === 'vertex') return null;
    const edge = doc.edges.get(item.id);
    if (!edge) return null;
    if (edge.kind === 'brace') return t('rigid tie');
    const mapped = results?.bondMap.get(edge.id);
    if (mapped === 'intra') return t('inert');
    const value = typeof mapped === 'number' ? results?.values[mapped] : undefined;
    if (!value) return null;
    return `${t('Ollivier–Ricci curvature')} ${metricLabel('ollivier', value.ollivier)} · ${t('Effective curvature κ_eff')} ${metricLabel('keff', value.kEff)}`;
  };

  const linkedHistogramBin = (item: SelectionItem | null): { min: number; max: number } | null => {
    if (!item || item.kind !== 'edge' || !results) return null;
    const edge = doc.edges.get(item.id);
    if (!edge || edge.kind !== 'bond') return null;
    const mapped = results.bondMap.get(edge.id);
    const value = typeof mapped === 'number' ? results.values[mapped] : undefined;
    if (!value) return null;
    const metricValue = metric === 'keff' ? value.kEff : value.ollivier;
    if (!Number.isFinite(metricValue)) return null;
    const binCount = 25;
    const domainMin = metric === 'keff' ? 0 : -1;
    const domainMax = 1;
    const t = Math.max(0, Math.min(0.999999, (metricValue - domainMin) / (domainMax - domainMin)));
    const index = Math.floor(t * binCount);
    return {
      min: domainMin + (index / binCount) * (domainMax - domainMin),
      max: domainMin + ((index + 1) / binCount) * (domainMax - domainMin)
    };
  };

  const setLinkedHistogramBin = (bin: { min: number; max: number } | null) => {
    const key = bin ? `${bin.min}:${bin.max}` : null;
    if (key === linkedBinKeyRef.current) return;
    linkedBinKeyRef.current = key;
    setHistogramHoverBin(bin);
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    // Editing/selection must not move under the pointer when an inspector appears.
    useStudioStore.setState({ camera2dMode: 'manual' });
    cancelPointerFrame();
    clearTimeout(tooltipTimer.current);
    setTooltip(null);
    setHover(null);
    setLinkedHistogramBin(null);
    const point = pointFromEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.button === 1 || event.button === 2 || spaceDown) {
      setDrag({ kind: 'pan', startScreen: point, startCamera: liveCameraRef.current });
      return;
    }
    if (tool === 'bond' || tool === 'brace') {
      const vertex = pickVertex(point);
      const edge = vertex ? undefined : pickEdge(point);
      if (edge) {
        convertEdge(edge.id, tool);
        return;
      }
      setDrag({ kind: 'draw', edgeKind: tool, startScreen: point, currentScreen: point, startModel: screenToModel(point, liveCameraRef.current), startVertex: vertex?.id });
      return;
    }
    if (tool === 'erase') {
      const item = itemAt(point);
      beginEraseGesture();
      erasedKeysRef.current = new Set();
      if (item) {
        erasedKeysRef.current.add(selectionKey(item));
        scrubEraseItem(item);
      }
      setDrag({ kind: 'erase', items: item ? [item] : [] });
      return;
    }
    const item = itemAt(point);
    if (!item) {
      if (!event.shiftKey) clearSelection();
      setDrag({ kind: 'box', startScreen: point, currentScreen: point, additive: event.shiftKey });
      return;
    }
    const nextSelection = event.shiftKey ? toggled(selection, item) : selectedKeys.has(selectionKey(item)) ? selection : [item];
    setSelection(nextSelection);
    if (item.kind === 'vertex') {
      const moving = selectedVertexIds(doc, nextSelection).filter((id) => doc.vertices.has(id));
      setDrag({ kind: 'move', startScreen: point, currentScreen: point, vertexIds: moving.length ? moving : [item.id] });
    }
  };

  pointerMove.current = (point) => {
    const drag = dragRef.current;
    clearTimeout(tooltipTimer.current);
    if (!drag) {
        const item = itemAt(point);
        setHover(item);
        setLinkedHistogramBin(linkedHistogramBin(item));
        const text = item ? tooltipText(item) : null;
        if (!item || !text) {
          setTooltip(null);
          return;
        }
        const tooltipItem = item;
        tooltipTimer.current = window.setTimeout(() => {
          const current = itemAt(point);
          if (!dragRef.current && current && selectionKey(current) === selectionKey(tooltipItem)) setTooltip({ x: point.x + 14, y: point.y + 14, text });
        }, 350);
      return;
    }
    if (drag.kind === 'pan') {
      liveCameraRef.current = { ...drag.startCamera, tx: drag.startCamera.tx + point.x - drag.startScreen.x, ty: drag.startCamera.ty + point.y - drag.startScreen.y };
      setCamera(liveCameraRef.current);
      scheduleDomUpdate();
    } else if (drag.kind === 'draw') {
      setDrag({ ...drag, currentScreen: point });
    } else if (drag.kind === 'move') {
      setDrag({ ...drag, currentScreen: point });
    } else if (drag.kind === 'box') {
      setDrag({ ...drag, currentScreen: point });
    } else if (drag.kind === 'erase') {
      const item = itemAt(point);
      if (item && !erasedKeysRef.current.has(selectionKey(item))) {
        erasedKeysRef.current.add(selectionKey(item));
        scrubEraseItem(item);
        setDrag({ ...drag, items: [...drag.items, item] });
      }
    }
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    if (dragRef.current?.kind === 'pan' || dragRef.current?.kind === 'erase') { pointerMove.current(point); return; }
    pointerPoint.current = point;
    if (pointerFrame.current !== null) return;
    pointerFrame.current = requestAnimationFrame(() => {
      pointerFrame.current = null;
      const latest = pointerPoint.current;
      pointerPoint.current = null;
      if (latest) pointerMove.current(latest);
    });
  };

  const onPointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    cancelPointerFrame();
    let drag = dragRef.current;
    if (!drag) return;
    const point = pointFromEvent(event);
    if (drag.kind === 'draw' || drag.kind === 'move' || drag.kind === 'box') drag = { ...drag, currentScreen: point };
    if (drag.kind === 'draw') {
      const moved = dist(point, drag.startScreen) > 3;
      const target = snapVertex(point, drag.startVertex);
      if (!moved && drag.startVertex === undefined) {
        const model = screenToModel(point, liveCameraRef.current);
        addVertex(model.x, model.y);
      } else if (!moved && drag.startVertex !== undefined) {
        // Existing-vertex click with a draw tool is explicitly a no-op.
      } else if (drag.startVertex !== undefined) {
        const releasedOnStart = pickVertex(point, 14)?.id === drag.startVertex;
        if (releasedOnStart) {
          // Releasing on the drag's own start vertex cancels; no self-loop.
        } else if (target) createOrConvertEdge(drag.startVertex, target.id, drag.edgeKind);
        else {
          const model = screenToModel(point, liveCameraRef.current);
          createVertexAndEdge(drag.startVertex, model.x, model.y, drag.edgeKind);
        }
      } else if (moved) {
        if (target) createVertexAndEdge(target.id, drag.startModel.x, drag.startModel.y, drag.edgeKind);
        else {
          const end = screenToModel(point, liveCameraRef.current);
          createEdgeBetweenNewVertices(drag.startModel.x, drag.startModel.y, end.x, end.y, drag.edgeKind);
        }
      }
    } else if (drag.kind === 'move') {
      const dx = (drag.currentScreen.x - drag.startScreen.x) / liveCameraRef.current.scale;
      const dy = (drag.currentScreen.y - drag.startScreen.y) / liveCameraRef.current.scale;
      moveVertices(drag.vertexIds, dx, dy);
    } else if (drag.kind === 'box') {
      const x1 = Math.min(drag.startScreen.x, drag.currentScreen.x);
      const x2 = Math.max(drag.startScreen.x, drag.currentScreen.x);
      const y1 = Math.min(drag.startScreen.y, drag.currentScreen.y);
      const y2 = Math.max(drag.startScreen.y, drag.currentScreen.y);
      const inside = (p: { x: number; y: number }) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
      const boxSelection: SelectionItem[] = [];
      for (const vertex of vertices) if (inside(vertexScreen(vertex))) boxSelection.push({ kind: 'vertex', id: vertex.id });
      for (const edge of edges) {
        const a = getVertex(edge.a);
        const b = getVertex(edge.b);
        if (a && b && inside(vertexScreen(a)) && inside(vertexScreen(b))) boxSelection.push({ kind: 'edge', id: edge.id });
      }
      setSelection(drag.additive ? [...selection, ...boxSelection] : boxSelection);
    } else if (drag.kind === 'erase') {
      endEraseGesture();
    } else if (drag.kind === 'pan') {
      setCamera(liveCameraRef.current);
    }
    setDrag(null);
  };

  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const point = pointFromEvent(event);
    const before = screenToModel(point, liveCameraRef.current);
    const scale = Math.max(0.05, Math.min(40, liveCameraRef.current.scale * Math.exp(-event.deltaY * 0.0015)));
    liveCameraRef.current = { scale, tx: point.x - before.x * scale, ty: point.y - before.y * scale };
    scheduleDomUpdate();
    // Commit immediately: resize, project saves and switching views must see the live zoom.
    setCamera(liveCameraRef.current);
  };

  const renderBrace = (edge: Edge, a: { x: number; y: number }, b: { x: number; y: number }, selected: boolean, dimmed: boolean) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const gap = (bondWidth / 2) * 1.6;
    const nx = (-dy / len) * gap;
    const ny = (dx / len) * gap;
    return (
      <g key={edge.id} data-edge-id={edge.id}>
        {selected ? <line data-edge-line="halo" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={tokens.accent} strokeWidth="5" strokeLinecap="round" opacity="0.35" /> : null}
        {braceStyle === 'single' || braceStyle === 'dashed' ? (
          <line data-edge-line="brace" data-edge-offset="0" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={braceColor} strokeWidth={bondWidth} strokeLinecap="round" strokeDasharray={braceStyle === 'dashed' ? dashPattern(bondWidth) : undefined} opacity={dimmed ? 0.25 : 1} />
        ) : (
          <>
            <line data-edge-line="brace-a" data-edge-offset="1" x1={a.x + nx} y1={a.y + ny} x2={b.x + nx} y2={b.y + ny} stroke={braceColor} strokeWidth={bondWidth * 0.75} strokeLinecap="round" opacity={dimmed ? 0.25 : 1} />
            <line data-edge-line="brace-b" data-edge-offset="-1" x1={a.x - nx} y1={a.y - ny} x2={b.x - nx} y2={b.y - ny} stroke={braceColor} strokeWidth={bondWidth * 0.75} strokeLinecap="round" opacity={dimmed ? 0.25 : 1} />
          </>
        )}
      </g>
    );
  };

  const labels: JSX.Element[] = [];
  const edgeNodes = edges.map((edge) => {
    const va = getVertex(edge.a);
    const vb = getVertex(edge.b);
    if (!va || !vb) return null;
    const a = vertexScreen(va);
    const b = vertexScreen(vb);
    const selected = selectedKeys.has(`edge:${edge.id}`);
    const mapped = results?.bondMap.get(edge.id);
    const value = typeof mapped === 'number' ? results?.values[mapped] : undefined;
    const metricValue = value ? (metric === 'keff' ? value.kEff : value.ollivier) : Number.NaN;
    const color = edge.kind === 'bond' && mapped !== 'intra' ? metricColor(metric, metricValue, colorblindSafe, style, customGradients) : intraColor;
    const outsideHistogramBin =
      histogramHoverBin && (!Number.isFinite(metricValue) || metricValue < histogramHoverBin.min || metricValue >= histogramHoverBin.max);
    const length = dist(a, b);
    const hovered = hover?.kind === 'edge' && hover.id === edge.id;
    const lineWidth = selected || hovered ? bondWidth * 1.5 : bondWidth;
    const doubleLineWidth = lineWidth * 0.75;
    const bondDash = mapped === 'intra' || bondStyle === 'dashed' ? dashPattern(bondWidth) : undefined;
    if (edge.kind === 'bond' && value && labelsVisible && (length >= labelThreshold || selected || hovered)) {
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
      labels.push(
        <text
          data-label-id={edge.id}
          key={edge.id}
          className="edge-label"
          x={(a.x + b.x) / 2 + nx * labelOffset}
          y={(a.y + b.y) / 2 + ny * labelOffset}
          textAnchor="middle"
          dominantBaseline="central"
          fill={labelColor(color)}
          transform={`rotate(${angle} ${(a.x + b.x) / 2 + nx * labelOffset} ${(a.y + b.y) / 2 + ny * labelOffset})`}
          style={{ fontSize: `${10.5 * labelScale}px` }}
        >
          {metricLabel(metric, metricValue)}
        </text>
      );
    }
    if (edge.kind === 'brace') return renderBrace(edge, a, b, selected, Boolean(outsideHistogramBin));
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const gap = (bondWidth / 2) * 1.6;
    const nx = (-dy / len) * gap;
    const ny = (dx / len) * gap;
    const opacity = outsideHistogramBin ? 0.25 : computing ? 0.58 : 1;
    const casingStrokeWidth = (bondStyle === 'double' && mapped !== 'intra' ? doubleLineWidth : lineWidth) + casingWidth * 2;
    return (
      <g key={edge.id} data-edge-id={edge.id}>
        {selected ? <line data-edge-line="halo" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={tokens.accent} strokeWidth="5" strokeLinecap="round" opacity="0.35" /> : null}
        {bondStyle === 'double' && mapped !== 'intra' ? (
          <>
            {bondCasing.enabled ? <line data-edge-line="bond-casing-a" data-edge-offset="1" x1={a.x + nx} y1={a.y + ny} x2={b.x + nx} y2={b.y + ny} stroke={bondCasing.color} strokeWidth={casingStrokeWidth} strokeLinecap="round" opacity={opacity} /> : null}
            {bondCasing.enabled ? <line data-edge-line="bond-casing-b" data-edge-offset="-1" x1={a.x - nx} y1={a.y - ny} x2={b.x - nx} y2={b.y - ny} stroke={bondCasing.color} strokeWidth={casingStrokeWidth} strokeLinecap="round" opacity={opacity} /> : null}
            <line data-edge-line="bond-a" data-edge-offset="1" x1={a.x + nx} y1={a.y + ny} x2={b.x + nx} y2={b.y + ny} stroke={color} strokeWidth={doubleLineWidth} strokeLinecap="round" opacity={opacity} />
            <line data-edge-line="bond-b" data-edge-offset="-1" x1={a.x - nx} y1={a.y - ny} x2={b.x - nx} y2={b.y - ny} stroke={color} strokeWidth={doubleLineWidth} strokeLinecap="round" opacity={opacity} />
          </>
        ) : (
          <>
            {bondCasing.enabled && mapped !== 'intra' ? <line data-edge-line="bond-casing" data-edge-offset="0" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={bondCasing.color} strokeWidth={casingStrokeWidth} strokeLinecap="round" strokeDasharray={bondDash} opacity={opacity} /> : null}
            <line data-edge-line="bond" data-edge-offset="0" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={lineWidth} strokeLinecap="round" strokeDasharray={bondDash} opacity={opacity} />
          </>
        )}
      </g>
    );
  });

  const vertexNodes = vertices.map((vertex) => {
    const point = vertexScreen(vertex);
    const selected = selectedKeys.has(`vertex:${vertex.id}`);
    const hovered = hover?.kind === 'vertex' && hover.id === vertex.id;
    const fill = verticesHidden || !vertexFill.enabled ? 'transparent' : vertexFill.color;
    const outlineVisible = !verticesHidden && vertexOutline.enabled && vertexOutlineWidth > 0;
    const stroke = outlineVisible ? vertexOutline.color : 'transparent';
    const strokeWidth = outlineVisible ? vertexOutlineWidth : 0;
    return (
      <g key={vertex.id}>
        {isolatedIds.has(vertex.id) ? <circle data-isolated-vertex-id={vertex.id} cx={point.x} cy={point.y} r={vertexSize + 4.5} fill="none" stroke={tokens.warning} strokeWidth="1.5" strokeDasharray="3 2" /> : null}
        {selected ? <circle data-vertex-selection-halo={vertex.id} cx={point.x} cy={point.y} r={vertexSize + 3} fill="none" stroke={tokens.accent} strokeWidth="2.5" opacity="0.45" /> : null}
        {hovered ? <circle data-vertex-hover={vertex.id} cx={point.x} cy={point.y} r={vertexSize + 3.5} fill="none" stroke={tokens.accent} strokeWidth="2" /> : null}
        <circle data-vertex-id={vertex.id} cx={point.x} cy={point.y} r={vertexSize} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      </g>
    );
  });

  const ghost =
    drag?.kind === 'draw' ? (
      <g>
        <line
          x1={drag.startScreen.x}
          y1={drag.startScreen.y}
          x2={drag.currentScreen.x}
          y2={drag.currentScreen.y}
          stroke={tokens.accent}
          strokeWidth="1.75"
          strokeDasharray="4 3"
          opacity="0.7"
          strokeLinecap="round"
        />
      </g>
    ) : null;

  const snap = drag?.kind === 'draw' ? snapVertex(drag.currentScreen, drag.startVertex) : undefined;
  const snapPoint = snap ? vertexScreen(snap) : undefined;
  const box =
    drag?.kind === 'box' ? (
      <rect
        className="rubber-band"
        x={Math.min(drag.startScreen.x, drag.currentScreen.x)}
        y={Math.min(drag.startScreen.y, drag.currentScreen.y)}
        width={Math.abs(drag.currentScreen.x - drag.startScreen.x)}
        height={Math.abs(drag.currentScreen.y - drag.startScreen.y)}
      />
    ) : null;

  return (
    <svg
      ref={svgRef}
      data-graph-canvas
      tabIndex={0}
      aria-label="2D graph canvas"
      className={`svg-canvas ${tool}`}
      style={{ cursor: drag?.kind === 'pan' || drag?.kind === 'move' ? 'grabbing' : spaceDown ? 'grab' : tool === 'select' && hover ? 'move' : undefined }}
      data-dragging={drag?.kind === 'pan' || drag?.kind === 'move' ? 'true' : undefined}
      data-space={spaceDown ? 'true' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        cancelPointerFrame();
        if (drag?.kind === 'erase') endEraseGesture();
        setDrag(null);
      }}
      onPointerLeave={() => {
        cancelPointerFrame();
        setHover(null);
        setLinkedHistogramBin(null);
        setTooltip(null);
      }}
      onWheel={onWheel}
      onContextMenu={(event) => event.preventDefault()}
      onDoubleClick={(event) => {
        if (tool === 'select' && !itemAt(pointFromEvent(event))) fit2d();
      }}
    >
      <g ref={graphLayerRef} data-graph-layer>
        {edgeNodes}
        <g ref={labelLayerRef}>{labels}</g>
        {vertexNodes}
      </g>
      {ghost}
      {snapPoint ? <circle cx={snapPoint.x} cy={snapPoint.y} r="8" fill="none" stroke={tokens.accent} strokeWidth="2" /> : null}
      {box}
      {tooltip ? (
        <g pointerEvents="none">
          <rect x={tooltip.x - 8} y={tooltip.y - 18} width={Array.from(tooltip.text).reduce((width, char) => width + (/[^\x00-\xff]/.test(char) ? 12 : 6.6), 16)} height="24" rx="8" fill={tokens.panel} stroke={tokens.border} />
          <text x={tooltip.x} y={tooltip.y - 6} fill={tokens.ink700} fontSize="12" dominantBaseline="central">
            {tooltip.text}
          </text>
        </g>
      ) : null}
    </svg>
  );
}
