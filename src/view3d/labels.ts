import * as THREE from 'three';
import type { SelectionItem } from '../state/types';
import { tokens } from '../design/tokens';

export interface LabelInput {
  edgeId: number;
  text: string;
  color: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
}
interface LabelRecord extends LabelInput { sprite: THREE.Sprite | null; textureKey: string }
interface LabelView {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  width: number;
  height: number;
  enabled: boolean;
  focusOnly: boolean;
  hoverKey: string | null;
  selection: SelectionItem[];
  scale: number;
}

/** Keep a small pool of recently hidden glyphs; active labels own their textures. */
export class SceneLabels {
  private records = new Map<number, LabelRecord>();
  private visible = new Set<LabelRecord>();
  private seen = new Set<LabelRecord>();
  private focused = new Set<number>();
  private textures = new Map<string, THREE.CanvasTexture>();
  private projected = new WeakMap<THREE.Vector3, { frame: number; point: THREE.Vector3 }>();
  private midpoint = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private frame = 0;
  readonly stats = { visited: 0, projections: 0, visible: 0, textures: 0 };

  constructor(private group: THREE.Group) {}
  get count(): number { return this.records.size; }

  setRecords(inputs: LabelInput[]): void {
    const next = new Map<number, LabelRecord>();
    for (const input of inputs) {
      const record = this.records.get(input.edgeId) ?? { ...input, sprite: null, textureKey: '' };
      Object.assign(record, input);
      next.set(input.edgeId, record);
    }
    for (const [id, record] of this.records) if (!next.has(id)) this.hide(record);
    this.records = next;
    this.prune();
  }

  private hide(record: LabelRecord): void {
    if (record.sprite) {
      this.group.remove(record.sprite);
      record.sprite.material.dispose();
      record.sprite = null;
    }
    this.visible.delete(record);
  }

  private texture(key: string, text: string, color: string, scale: number): THREE.CanvasTexture {
    const cached = this.textures.get(key);
    if (cached) { this.textures.delete(key); this.textures.set(key, cached); return cached; }
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create label texture');
    const fontSize = 42 * scale;
    context.font = `${fontSize}px Inter, -apple-system, system-ui, sans-serif`;
    canvas.width = Math.ceil(context.measureText(text).width + 32 * scale);
    canvas.height = Math.ceil(72 * scale);
    context.font = `${fontSize}px Inter, -apple-system, system-ui, sans-serif`;
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.lineJoin = 'round';
    context.strokeStyle = tokens.white; context.lineWidth = 10 * scale;
    context.strokeText(text, canvas.width / 2, canvas.height / 2);
    context.fillStyle = color; context.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.set(key, texture);
    return texture;
  }

  private project(point: THREE.Vector3, camera: THREE.Camera): THREE.Vector3 {
    let cached = this.projected.get(point);
    if (!cached) { cached = { frame: -1, point: new THREE.Vector3() }; this.projected.set(point, cached); }
    if (cached.frame !== this.frame) {
      cached.point.copy(point).project(camera); cached.frame = this.frame; this.stats.projections++;
    }
    return cached.point;
  }

  update(view: LabelView): void {
    this.frame++;
    this.stats.visited = 0; this.stats.projections = 0;
    this.seen.clear(); this.focused.clear();
    for (const item of view.selection) if (item.kind === 'edge') this.focused.add(item.id);
    if (view.hoverKey?.startsWith('edge:')) this.focused.add(Number(view.hoverKey.slice(5)));
    // Dense/interaction views look up only selected/hovered edges, before projection.
    const candidates = !view.enabled ? [] : view.focusOnly
      ? [...this.focused].flatMap(id => { const record = this.records.get(id); return record ? [record] : []; })
      : this.records.values();
    const height = Math.max(1, view.height), width = Math.max(1, view.width);
    const perspective = view.camera instanceof THREE.PerspectiveCamera;
    const heightFactor = view.camera instanceof THREE.PerspectiveCamera
      ? 2 * Math.tan(THREE.MathUtils.degToRad(view.camera.fov) / 2) * (15 * view.scale / height)
      : ((view.camera.top - view.camera.bottom) / view.camera.zoom) * (15 * view.scale / height);
    const textureScale = Math.max(1, 15 * view.scale * 2 / 72);
    let changed = false;
    for (const record of candidates) {
      this.stats.visited++;
      const start = this.project(record.a, view.camera), end = this.project(record.b, view.camera);
      const dx = (end.x - start.x) * width, dy = (end.y - start.y) * height;
      if (!this.focused.has(record.edgeId) && Math.hypot(dx, dy) * 0.5 < 46 * view.scale) continue;
      const key = `${record.text}:${record.color}:${textureScale}`;
      if (!record.sprite || record.textureKey !== key) {
        const texture = this.texture(key, record.text, record.color, textureScale);
        if (!record.sprite) {
          record.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
          this.group.add(record.sprite);
        } else record.sprite.material.map = texture;
        record.textureKey = key;
        changed = true;
      }
      this.seen.add(record);
      this.midpoint.copy(record.a).add(record.b).multiplyScalar(0.5);
      this.offset.copy(view.camera.position).sub(this.midpoint).normalize().multiplyScalar(0.03);
      record.sprite.position.copy(this.midpoint).add(this.offset);
      const worldHeight = heightFactor * (perspective ? view.camera.position.distanceTo(record.sprite.position) : 1);
      const image = record.sprite.material.map!.image as HTMLCanvasElement;
      record.sprite.scale.set(worldHeight * image.width / image.height, worldHeight, 1);
      let angle = Math.atan2(dy, dx);
      if (angle > Math.PI / 2 || angle <= -Math.PI / 2) angle += Math.PI;
      record.sprite.material.rotation = angle;
    }
    for (const record of this.visible) if (!this.seen.has(record)) { this.hide(record); changed = true; }
    const previous = this.visible; this.visible = this.seen; this.seen = previous;
    if (changed) this.prune();
    this.stats.visible = this.visible.size;
    this.stats.textures = this.textures.size;
  }

  private prune(): void {
    const active = new Set([...this.visible].map(record => record.textureKey));
    let count = 0, pixels = 0;
    for (const [key, texture] of this.textures) if (!active.has(key)) {
      const image = texture.image as HTMLCanvasElement;
      count++; pixels += image.width * image.height;
    }
    for (const [key, texture] of this.textures) {
      if (count <= 128 && pixels <= 1_048_576) break;
      if (active.has(key)) continue;
      const image = texture.image as HTMLCanvasElement;
      count--; pixels -= image.width * image.height;
      texture.dispose(); this.textures.delete(key);
    }
  }

  invalidateFonts(): void {
    for (const record of this.visible) this.hide(record);
    this.textures.forEach(texture => texture.dispose()); this.textures.clear();
  }
  clearRecords(): void { this.setRecords([]); }
  dispose(): void { this.clearRecords(); this.invalidateFonts(); }
}
