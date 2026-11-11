import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compareRoutes } from '../routes.js';

function planWithGap() {
  const grid = Array.from({ length: 48 }, (_, y) => Array.from({ length: 48 }, (_, x) =>
    x === 0 || x === 47 || y === 0 || y === 47 || (x === 24 && (y < 22 || y > 26)) ? '1' : '0'));
  return grid.map(row => row.join(''));
}

const request = {
  mask: planWithGap(), start: [0.25, 0.5], end: [0.75, 0.5],
  roomWidthCm: 480, roomHeightCm: 480, passageCm: 20,
  furniture: { widthCm: 40, depthCm: 40, before: [0.5, 0.5], after: [0.75, 0.75] }
};

test('벽의 유일한 문을 가구가 막으면 이동 불가, 옮기면 경로가 열린다', () => {
  const result = compareRoutes(request);
  assert.equal(result.before.reachable, false);
  assert.equal(result.after.reachable, true);
  assert.ok(result.after.path.length > 0);
  assert.match(result.summary, /길이 열려요/);
});

test('벽을 통과하거나 대각선으로 모서리를 가로지르지 않는다', () => {
  const result = compareRoutes(request);
  for (const [nx, ny] of result.after.path) {
    const x = Math.min(47, Math.floor(nx * 48));
    const y = Math.min(47, Math.floor(ny * 48));
    assert.equal(request.mask[y][x], '0');
  }
});

test('현관이 벽 위면 입력을 거절한다', () => {
  assert.throws(() => compareRoutes({ ...request, start: [0, 0] }), error => error.code === 'POINT_ON_OBSTACLE');
});

test('공식 벽 정답 샘플에서 가구 이동 전후 경로 길이가 달라진다', () => {
  const mask = JSON.parse(readFileSync(new URL('../../ai/examples/first-pair/wall-mask-grid.json', import.meta.url), 'utf8'));
  const result = compareRoutes({
    mask, start: [0.33, 0.72], end: [0.65, 0.62],
    roomWidthCm: 720, roomHeightCm: 1200, passageCm: 35,
    furniture: { widthCm: 80, depthCm: 40, before: [0.50, 0.71], after: [0.30, 0.47] }
  });
  assert.equal(result.before.reachable, true);
  assert.equal(result.after.reachable, true);
  assert.ok(result.after.lengthCm < result.before.lengthCm);
});

test('YOLO 배치 가구 목록이 두 A* 경로 모두에 장애물로 반영된다', () => {
  const without = compareRoutes(request);
  const withItem = compareRoutes({ ...request, layoutItems: [{ box: { x: .47, y: .45, width: .06, height: .10 }, widthCm: 40, depthCm: 48 }] });
  assert.equal(without.after.reachable, true);
  assert.equal(withItem.after.reachable, false);
});
