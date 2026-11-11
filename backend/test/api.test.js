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

test('실제 상품 추천 API는 Gemini를 호출하지 않고 중단 상태를 반환한다', async () => {
  const { status, data } = await request('/api/v1/products/recommend', 'POST', {
    roomUse: '침실', desiredFurnitureTypes: ['없는 가구'], existingFurniture: [],
    roomWidthMm: 3300, roomDepthMm: 2700,
    occupantAge: { value: 32, unit: 'years' }, activity: '보통'
  });
  assert.equal(status, 503);
  assert.equal(data.error.code, 'PRODUCT_API_PAUSED');
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

test('4-class 가중치가 없으면 기존 벽 모델로 분석한 척하지 않는다', async () => {
  const model = await request('/api/v1/model/status');
  assert.deepEqual(model.data.classes, ['background', 'wall', 'door', 'window']);
  if (model.data.ready) return;
  assert.match(model.data.message, /세 종류 인식 모델/);
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
    assert.match(await response.text(), page === '/' ? /<title>RoomAI/ : /Roommate/i);
  }
  const mobile = await fetch(base + '/room-select.html');
  assert.equal(mobile.status, 200);
  assert.match(await mobile.text(), /AI 방 선택/);
});

test('사용자가 제공한 두 평면도 이미지를 화면에 제공한다', async () => {
  for (const asset of ['/assets/baby-floorplan.png', '/assets/bedroom-floorplan.png']) {
    const response = await fetch(base + asset);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
  }
});

test('저장된 상품 사진을 서버에서도 제공한다', async () => {
  for (const asset of ['bed-q1', 'bed-q2', 'bed-k1', 'toy-1', 'toy-2', 'toy-3', 'mat-1', 'mat-2', 'mat-3']) {
    const response = await fetch(base + `/assets/products/${asset}.webp`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.ok((await response.arrayBuffer()).byteLength > 1000);
  }
});

test('RoomAI 스타일과 벽 전용 U-Net 상태를 제공한다', async () => {
  const style = await fetch(base + '/roomai.css');
  assert.equal(style.status, 200);
  assert.match(style.headers.get('content-type'), /text\/css/);
  assert.match(await style.text(), /category-tabs/);
  const status = await request('/api/v1/walls/status');
  assert.equal(status.status, 200);
  assert.equal(status.data.model, 'U-Net wall segmentation');
  assert.equal(status.data.ready, true);
  const invalid = await request('/api/v1/walls/analyze', 'POST', { image: 'invalid' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.error.code, 'INVALID_IMAGE');
});
