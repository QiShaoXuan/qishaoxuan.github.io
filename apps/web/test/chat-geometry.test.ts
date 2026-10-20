import assert from 'node:assert/strict';
import test from 'node:test';
import { clampPosition, dockTarget, floatingSize, initialPosition, passedDragThreshold } from '../src/chat/geometry.ts';

test('浮窗初始位置和拖动边界保持整个窗口可见', () => {
  assert.deepEqual(initialPosition({ width: 1440, height: 900 }), { x: 1016, y: 296 });
  assert.deepEqual(clampPosition({ x: -200, y: 9999 }, { width: 1024, height: 768 }), { x: 8, y: 180 });
});
test('缩小视口后浮窗仍可达，窄视口不产生负尺寸', () => {
  assert.deepEqual(clampPosition({ x: 1000, y: 400 }, { width: 390, height: 400 }), { x: 8, y: 8 });
  assert.deepEqual(floatingSize({ width: 10, height: 10 }), { width: 0, height: 0 });
});
test('左右边缘仅桌面视口可吸附', () => {
  assert.equal(dockTarget(64, 1024), 'left');
  assert.equal(dockTarget(960, 1024), 'right');
  assert.equal(dockTarget(512, 1024), null);
  assert.equal(dockTarget(0, 767), null);
});

test('标题点击和轻微手抖不触发拖动，超过4px才开始', () => {
  assert.equal(passedDragThreshold({ x: 10, y: 10 }, { x: 10, y: 10 }), false);
  assert.equal(passedDragThreshold({ x: 10, y: 10 }, { x: 14, y: 10 }), false);
  assert.equal(passedDragThreshold({ x: 10, y: 10 }, { x: 13, y: 13 }), true);
});
