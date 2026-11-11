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
