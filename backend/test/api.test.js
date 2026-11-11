import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { defaultState } from '../data.js';

let server;
let base;

test.before(async () => {
  server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function request(path, method = 'GET', body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json() };
}

test('프론트 3 기본 조건으로 두 상품을 찾는다', async () => {
  const { status, data } = await request('/api/v1/products?kind=수납장&style=원목&budget=20&maxWidth=80');
  assert.equal(status, 200);
  assert.deepEqual(data.products.map(product => product.id), ['oak', 'low']);
  assert.equal(data.label, '시연용 데이터');
});

test('조건에 맞는 상품이 없으면 빈 목록을 반환한다', async () => {
  const { data } = await request('/api/v1/products?kind=책상&style=미니멀&budget=20&maxWidth=80');
  assert.equal(data.count, 0);
  assert.deepEqual(data.products, []);
});

test('현재 배치와 추천 배치의 경로, 막힌 구간, 폭을 반환한다', async () => {
  const { status, data } = await request('/api/v1/simulations', 'POST', { state: defaultState });
  assert.equal(status, 200);
  assert.equal(data.current, 'before');
  assert.equal(data.currentResult.minimumPassageCm, 55);
  assert.equal(data.variants.before.blocked, true);
  assert.equal(data.variants.after.minimumPassageCm, 72);
  assert.equal(data.variants.after.blocked, false);
  assert.equal(data.improvementCm, 17);
  assert.deepEqual(data.currentResult.route[0], [94, 279]);
  assert.equal(data.recommendedState.applied, true);
});

test('추천 배치를 적용하면 현재 결과가 72cm가 된다', async () => {
  const { data } = await request('/api/v1/simulations', 'POST', { state: { ...defaultState, applied: true } });
  assert.equal(data.current, 'after');
  assert.equal(data.currentResult.minimumPassageCm, 72);
});

test('지원하지 않는 조건은 분석한 척하지 않고 시연 복귀값을 준다', async () => {
  const { status, data } = await request('/api/v1/simulations', 'POST', { state: { ...defaultState, product: 'desk' } });
  assert.equal(status, 422);
  assert.equal(data.error.code, 'DEMO_ONLY');
  assert.equal(data.error.resetDemo.product, 'oak');
});

test('챗봇은 미리 정해진 추천 응답과 열기 동작을 준다', async () => {
  const { status, data } = await request('/api/v1/chat', 'POST', { message: '추천 배치 보여줘', state: defaultState });
  assert.equal(status, 200);
  assert.equal(data.showLayout, true);
  assert.match(data.answer, /55cm에서 72cm/);
});

test('잘못된 숫자 입력을 거절한다', async () => {
  const { status, data } = await request('/api/v1/products?budget=abc');
  assert.equal(status, 400);
  assert.equal(data.error.code, 'INVALID_INPUT');
});

test('학습 가중치가 없으면 AI 분석을 했다고 응답하지 않는다', async () => {
  const model = await request('/api/v1/model/status');
  if (model.data.ready) return;
  const { status, data } = await request('/api/v1/floorplans/analyze', 'POST', { image: 'data:image/png;base64,AAAA' });
  assert.equal(status, 503);
  assert.equal(data.error.code, 'MODEL_NOT_READY');
});

test('공식 정답 도면과 마스크를 화면 체험용으로 제공한다', async () => {
  for (const filename of ['floorplan.png', 'wall-mask.png']) {
    const response = await fetch(base + '/sample/' + filename);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
  }
});

test('새 경로 API가 벽 마스크와 가구 전후 위치를 비교한다', async () => {
  const mask = Array.from({ length: 48 }, (_, y) => Array.from({ length: 48 }, (_, x) =>
    x === 0 || x === 47 || y === 0 || y === 47 || (x === 24 && (y < 22 || y > 26)) ? '1' : '0').join(''));
  const { status, data } = await request('/api/v1/routes/compare', 'POST', {
    mask, start: [0.25, 0.5], end: [0.75, 0.5], roomWidthCm: 480,
    roomHeightCm: 480, passageCm: 20,
    furniture: { widthCm: 40, depthCm: 40, before: [0.5, 0.5], after: [0.75, 0.75] }
  });
  assert.equal(status, 200);
  assert.equal(data.before.reachable, false);
  assert.equal(data.after.reachable, true);
});

test('원본 화면과 새 도면 화면을 백엔드에서 연다', async () => {
  for (const page of ['/', '/floorplan.html']) {
    const response = await fetch(base + page);
    assert.equal(response.status, 200);
    assert.match(await response.text(), page === '/' ? /<title>루마이/ : /Roommate/i);
  }
});
