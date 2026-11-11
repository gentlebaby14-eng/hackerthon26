import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

function sceneModel() {
  const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const context = vm.createContext({});
  // Exercise the same scene geometry as the browser, before DOM event registration.
  vm.runInContext(script.slice(0, script.indexOf("document.addEventListener('input'")), context);
  return expression => vm.runInContext(expression, context);
}

test('메인 방 선택 단계에는 현관·목적지·가구 배치 도구가 없다',()=>{
  const run=sceneModel();run('state.step=2');
  const controls=run('controls()'),visual=run('visual()');
  assert.match(controls,/방의 바닥을 터치/);
  assert.doesNotMatch(controls,/현관|목적지|90°|동선 계산|선택한 가구/);
  assert.doesNotMatch(visual,/#111/);assert.match(visual,/#2284ef/);assert.match(visual,/#e23434/);
  assert.match(controls,/disabled/);
});

test('두 시나리오와 추천 상품 묶음을 제공한다', () => {
  const run = sceneModel();
  assert.equal(run('state.scenario'), 'bedroom');
  assert.equal(run('scenarioProducts.bedroom.length'), 3);
  assert.equal(run("scenarioProducts.baby.filter(p => p.group === '장난감 수납장').length"), 3);
  assert.equal(run("scenarioProducts.baby.filter(p => p.group === '놀이매트').length"), 3);
  assert.equal(run('presets.baby.age'), 1.5);
  assert.equal(run("scenarioProducts.bedroom.filter(p => p.url.startsWith('https://')).length"), 3);
  assert.equal(run("scenarioProducts.baby.filter(p => p.group === '장난감 수납장' && p.url.startsWith('https://')).length"), 3);
  const items = run('[...scenarioProducts.bedroom,...scenarioProducts.baby].map(p=>({imageUrl:p.imageUrl,url:p.url,price:p.price}))');
  for (const item of items) {
    assert.ok(existsSync(new URL(`../../frontend/${item.imageUrl}`, import.meta.url)));
    assert.match(item.url, /^https:\/\/(?:brand|smartstore)\.naver\.com\//);
    assert.ok(item.price > 0);
  }
});

test('성인 방은 큰 침대의 기존 배치에서 멈추고 추천 배치에서는 이동을 완료한다', () => {
  const run = sceneModel();
  const stop = run("overlap('before').at");
  assert.ok(stop > 0 && stop < 1);
  assert.equal(run("overlap('after').at"), Infinity);
  run('state.afterX = state.cabX; state.afterY = state.cabY');
  assert.equal(run("overlap('after').at"), stop, '수정한 추천 위치에 따라 결과 재계산');
});

test('18개월 아기 방은 활동 경로와 수납장 문 간섭을 줄인다', () => {
  const run = sceneModel();
  run("Object.assign(state,{scenario:'baby',preset:'baby',product:'toy-1',cabX:70,cabY:230,afterX:330,afterY:62,radius:'27',activity:'활동적'})");
  assert.ok(run("overlap('before').at") < 1);
  assert.equal(run("overlap('after').at"), Infinity);
  assert.ok(run("routePoints().length") > run("sceneRoutes.baby.length"));
});

test('저장된 실제 상품의 사진·가격·판매처 링크를 기존 카드 구조에 표시한다', () => {
  const run = sceneModel();
  run("state.step=1;state.searchView='results';state.product='bed-q1'");
  const html = run('controls()');
  assert.match(html, /<img src="assets\/products\/bed-q1.webp"/);
  assert.match(html, /298,000원/);
  assert.match(html, /href="https:\/\/brand.naver.com\/lemerebed\/products\/4221928734"/);
  assert.match(html, /저장된 상품 · 판매처 정보/);
  assert.doesNotMatch(html, /더 찾아보기/);
  assert.doesNotMatch(readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8'), /fetch\([^\n]*\/api\/v1\/products\/recommend/);
});

test('전체 프론트 스크립트에 문법 오류가 없다', () => {
  const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
});

test('앱을 열면 첫 화면의 소개와 가구 찾기 버튼을 렌더링한다', async () => {
  const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const nodes = new Map(['#workspace', '.shell', 'main', '#progress', '#headline', '#intro', '#controls', '#visual',
    '#chat', '#chat-open', '#chat-close', '#chat-form', '#chat-result'].map(selector =>
    [selector, { dataset: {}, classList: { toggle() {} }, innerHTML: '', textContent: '', hidden: false }]));
  const document = {
    querySelector: selector => nodes.get(selector) ?? null,
    querySelectorAll: () => [],
    addEventListener() {}
  };
  const context = vm.createContext({ document, fetch: async () => ({ json: async () => ({ ready: false, message: '준비 전' }) }) });
  vm.runInContext(script, context);
  assert.match(nodes.get('#controls').innerHTML, /가구 찾아보기/);
  assert.match(nodes.get('#visual').innerHTML, /editorial/);
  assert.match(nodes.get('#headline').innerHTML, /가구를 들이기 전,<br>생활을 먼저 그려보세요/);
  assert.equal(nodes.get('.shell').dataset.intro, true);
});

test('도면 화면은 GRU 없이 A* 경로와 배치 가구를 연결한다', () => {
  const html = readFileSync(new URL('../../frontend/floorplan.html', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.match(html, /A\* 동선 시뮬레이션 시작/);
  assert.doesNotMatch(html, /\/api\/v1\/trajectory\/predict|GRU/);
  assert.match(html, /state\.layoutItems=data\.items\.map/);
  assert.match(html, /layoutItems:state\.layoutItems/);
});
