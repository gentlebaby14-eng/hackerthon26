import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function sceneModel() {
  const html = readFileSync(new URL('../../frontend/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const context = vm.createContext({});
  // Exercise the same scene geometry as the browser, before DOM event registration.
  vm.runInContext(script.slice(0, script.indexOf("document.addEventListener('input'")), context);
  return expression => vm.runInContext(expression, context);
}

test('두 시나리오와 추천 상품 묶음을 제공한다', () => {
  const run = sceneModel();
  assert.equal(run('state.scenario'), 'bedroom');
  assert.equal(run('scenarioProducts.bedroom.length'), 3);
  assert.equal(run("scenarioProducts.baby.filter(p => p.group === '장난감 수납장').length"), 3);
  assert.equal(run("scenarioProducts.baby.filter(p => p.group === '놀이매트').length"), 3);
  assert.equal(run('presets.baby.age'), 1.5);
  assert.equal(run("scenarioProducts.bedroom.filter(p => p.url.startsWith('https://')).length"), 3);
  assert.equal(run("scenarioProducts.baby.filter(p => p.group === '장난감 수납장' && p.url.startsWith('https://')).length"), 2);
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

test('실제 상품의 사진·가격·판매처 링크를 기존 카드 구조에 표시한다', () => {
  const run = sceneModel();
  run("liveProducts=[{id:'live-1',kind:'침대',group:'침대',name:'실제 침대',price:429000,width:140,depth:200,seller:'판매처',imageUrl:'https://example.com/bed.jpg',url:'https://example.com/product/bed',score:null}];productSearchStatus='live';state.step=1;state.searchView='results';state.product='live-1'");
  const html = run('controls()');
  assert.match(html, /<img src="https:\/\/example.com\/bed.jpg"/);
  assert.match(html, /429,000원/);
  assert.match(html, /href="https:\/\/example.com\/product\/bed"/);
  assert.doesNotMatch(html, /★ null/);
  assert.match(html, /실제 판매처 정보/);
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
  assert.match(nodes.get('#headline').textContent, /가구/);
  assert.equal(nodes.get('.shell').dataset.intro, true);
});
