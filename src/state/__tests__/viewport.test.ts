import { expect, it } from 'vitest';
import { availableRectangle } from '../viewport';
import { usableGraphViewport } from '../camera2d';
import { createStudioStore } from '../store';

it('uses the full available area when panels are hidden', () => {
  const bounds = { x: 16, y: 120, width: 358, height: 708 };
  expect(availableRectangle(bounds, [])).toEqual(bounds);
});

it.each(['fit', 'manual'] as const)('retains the last useful %s camera when panels leave no usable area', mode => {
  const store = createStudioStore();
  store.setState({ camera2dMode: mode, camera2d: { scale: 2, tx: 300, ty: 200 } });
  const before = store.getState();
  for (const blocked of [{ x: 16, y: 16, width: 1, height: 1 }, { x: 16, y: 16, width: 20, height: 600 }]) {
    expect(usableGraphViewport(blocked)).toBe(false);
    store.getState().resizeViewport2d(blocked);
    expect(store.getState().camera2d).toEqual(before.camera2d);
    expect(store.getState().viewport2d).toEqual(before.viewport2d);
  }
});
it('finds a useful rectangle when a histogram is dragged into the middle', () => {
  const bounds = { x: 16, y: 120, width: 1248, height: 764 };
  const obstacle = { x: 480, y: 300, width: 264, height: 216 };
  const rect = availableRectangle(bounds, [obstacle]);
  expect(rect.width * rect.height).toBeGreaterThan(300000);
  expect(rect.x >= obstacle.x + obstacle.width || rect.x + rect.width <= obstacle.x || rect.y >= obstacle.y + obstacle.height || rect.y + rect.height <= obstacle.y).toBe(true);
});
