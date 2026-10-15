// Independently implemented geometric constructions, not coordinate tables.
// Derivations, conventions and references: docs/template-construction.md.
// This module has no filesystem, network or baked-catalog dependency.
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const reflect = (x, n) => x.map((v, i) => v - 2 * dot(x, n) * n[i]);

function mirrors(p) {
  // Coxeter diagram [p,3]: n0.n1=-cos(pi/p), n1.n2=-1/2, n0.n2=0.
  const c = Math.cos(Math.PI / p), s = Math.sin(Math.PI / p);
  return [[1, 0, 0], [-c, s, 0], [0, -0.5 / s, Math.sqrt(1 - 0.25 / (s * s))]];
}

function fromMirrorDistances(normals, u) {
  const x = u[0];
  const y = (u[1] - normals[1][0] * x) / normals[1][1];
  return [x, y, (u[2] - normals[2][1] * y) / normals[2][2]];
}

function orbit(seed, generators, limit) {
  const points = [seed];
  for (let i = 0; i < points.length; i += 1) {
    for (const transform of generators) {
      const next = transform(points[i]);
      // At most 120 points: a distance check avoids decimal-bin boundary errors.
      if (!points.some(point => Math.hypot(...point.map((v, j) => v - next[j])) < 1e-8)) {
        points.push(next);
        if (points.length > limit) throw new Error('Reflection orbit failed to close');
      }
    }
  }
  return points;
}

export function wythoff(p, active) {
  if (![3, 4, 5].includes(p) || !active.length || active.some(i => ![0, 1, 2].includes(i))) {
    throw new Error('Unsupported Wythoff construction');
  }
  const normals = mirrors(p);
  const seed = fromMirrorDistances(normals, normals.map((_, i) => active.includes(i) ? 1 : 0));
  return orbit(seed, normals.map(n => x => reflect(x, n)), { 3: 24, 4: 48, 5: 120 }[p]);
}

export function snub(p) {
  if (![4, 5].includes(p)) throw new Error('Unsupported snub construction');
  const normals = mirrors(p), c = Math.cos(Math.PI / p);
  // Put u1=1, u2=t, u0=sqrt(1+t). Equal distances to r0r1*x,
  // r1r2*x and r0r2*x reduce to (t-1)^2(t+1)=4*cos(pi/p)^2.
  // The left side is strictly increasing on (1,3), bracketing one root.
  let lo = 1, hi = 3;
  for (let i = 0; i < 60; i += 1) {
    const t = (lo + hi) / 2;
    if ((t - 1) ** 2 * (t + 1) < 4 * c * c) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  const seed = fromMirrorDistances(normals, [Math.sqrt(1 + t), 1, t]);
  const rotations = [[0, 1], [1, 2], [0, 2]].map(([i, j]) => x => reflect(reflect(x, normals[j]), normals[i]));
  const points = orbit(seed, rotations, p === 4 ? 24 : 60);
  if (points.length !== (p === 4 ? 24 : 60)) throw new Error('Incomplete snub orbit');
  return points;
}

export function elongatedSquareGyrobicupola() {
  // Unit-edge octagonal prism, capped by two square cupolae. The top
  // square is rotated pi/4 relative to the bottom (the J37 gyro choice).
  const points = [], r8 = 1 / (2 * Math.sin(Math.PI / 8)), r4 = 1 / Math.sqrt(2);
  for (const z of [-0.5, 0.5]) {
    for (let k = 0; k < 8; k += 1) {
      const a = Math.PI / 8 + k * Math.PI / 4;
      points.push([r8 * Math.cos(a), r8 * Math.sin(a), z]);
    }
  }
  for (const sign of [-1, 1]) {
    for (let k = 0; k < 4; k += 1) {
      const a = k * Math.PI / 2 + (sign === -1 ? Math.PI / 4 : 0);
      points.push([r4 * Math.cos(a), r4 * Math.sin(a), sign * (0.5 + r4)]);
    }
  }
  return points;
}

// Stable template IDs; vertex IDs are local to each newly placed template.
// Existing saved projects contain their own vertices and are never regenerated.
export const generatedSolids = [
  ['truncated-tetrahedron', 'Truncated tetrahedron', () => wythoff(3, [0, 1]), 12, 18, 3],
  ['cuboctahedron', 'Cuboctahedron', () => wythoff(4, [1]), 12, 24, 4],
  ['truncated-cube', 'Truncated cube', () => wythoff(4, [0, 1]), 24, 36, 3],
  ['truncated-octahedron', 'Truncated octahedron', () => wythoff(4, [1, 2]), 24, 36, 3],
  ['rhombicuboctahedron', 'Rhombicuboctahedron', () => wythoff(4, [0, 2]), 24, 48, 4],
  ['pseudo-rhombicuboctahedron-j37', 'Pseudo-rhombicuboctahedron (J37)', elongatedSquareGyrobicupola, 24, 48, 4],
  ['truncated-cuboctahedron', 'Truncated cuboctahedron', () => wythoff(4, [0, 1, 2]), 48, 72, 3],
  ['snub-cube', 'Snub cube', () => snub(4), 24, 60, 5],
  ['icosidodecahedron', 'Icosidodecahedron', () => wythoff(5, [1]), 30, 60, 4],
  ['truncated-dodecahedron', 'Truncated dodecahedron', () => wythoff(5, [0, 1]), 60, 90, 3],
  ['truncated-icosahedron', 'Truncated icosahedron', () => wythoff(5, [1, 2]), 60, 90, 3],
  ['rhombicosidodecahedron', 'Rhombicosidodecahedron', () => wythoff(5, [0, 2]), 60, 120, 4],
  ['truncated-icosidodecahedron', 'Truncated icosidodecahedron', () => wythoff(5, [0, 1, 2]), 120, 180, 3],
  ['snub-dodecahedron', 'Snub dodecahedron', () => snub(5), 60, 150, 5]
];

// atan2 can put a branch-cut vertex at either -pi or +pi across engines.
// A face is an oriented cycle: canonicalize its start, never its winding.
export function canonicalFaces(faces) {
  return faces.map(face => {
    const start = face.indexOf(Math.min(...face));
    return [...face.slice(start), ...face.slice(0, start)];
  }).sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
}
