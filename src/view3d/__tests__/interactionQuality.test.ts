import { expect, it } from 'vitest';
import { InteractionQuality } from '../interactionQuality';

it('keeps full resolution for smooth navigation and an isolated slow frame', () => {
  const quality = new InteractionQuality();
  for (let time = 0; time < 1000; time += 16) quality.update(time, true, true);
  quality.update(1100, true, true); quality.update(1116, true, true);
  expect(quality.pixelRatio(2)).toBe(2);
  expect(quality.preview).toBe(true);
});

it('reduces only sustained slow navigation, restores at rest, and respects the full-resolution cap', () => {
  const quality = new InteractionQuality();
  for (let time = 0; time <= 128; time += 32) quality.update(time, true, true);
  expect(quality.pixelRatio(2)).toBe(1.5);
  for (let time = 160; time <= 256; time += 32) quality.update(time, true, true);
  expect(quality.pixelRatio(2)).toBe(1.25);
  expect(quality.pixelRatio(0.7)).toBe(0.7);
  quality.update(272, false, false); expect(quality.needsFrame).toBe(true);
  quality.update(392, false, false);
  expect(quality.pixelRatio(2)).toBe(2); expect(quality.preview).toBe(false); expect(quality.needsFrame).toBe(false);
  quality.update(10000, true, true); expect(quality.level).toBe(0);
});

it('bounds frame diagnostics and resets navigation on tab suspension', () => {
  const quality = new InteractionQuality();
  for (let time = 0; time < 10000; time += 32) quality.update(time, true, true);
  expect(quality.frameIntervals()).toHaveLength(120);
  quality.reset(); expect(quality.level).toBe(0); expect(quality.needsFrame).toBe(false);
});

it('does not combine slow frames across pauses while the pointer is still held', () => {
  const quality = new InteractionQuality();
  for (let time = 0; time <= 96; time += 32) quality.update(time, true, true);
  quality.update(128, false, true);
  quality.update(500, true, true); quality.update(532, true, true);
  expect(quality.level).toBe(0);
  quality.update(1564, true, true);
  quality.update(1596, true, true);
  expect(quality.level).toBe(0);
});
