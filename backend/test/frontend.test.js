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

test('서비스 기본값은 일상 이동이며 만 2세 사례는 별도 발표 장면이다', () => {
  const run = sceneModel();
  assert.equal(run('state.preset'), 'daily');
  assert.equal(run('state.simAge'), null);
  assert.equal(run('presets.play.age'), 2);
});

test('기존 모서리 앞에서 멈추고 추천 위치에서는 같은 길을 끝까지 간다', () => {
  const run = sceneModel();
  const stop = run("overlap('before').at");
  assert.ok(stop > .6 && stop < .9, '바구니에서 방향을 바꾸는 구간에서 정지');
  assert.equal(run("overlap('after').at"), Infinity);
  assert.equal(run('routeAt(1).point[0]'), 205);
  run('state.afterX = state.cabX; state.afterY = state.cabY');
  assert.equal(run("overlap('after').at"), stop, '수정한 추천 위치에 따라 결과 재계산');
  run('state.cabX = 80; state.cabY = 66');
  assert.equal(run("overlap('before').at"), Infinity);
});

test('가구 종류와 예산·폭을 반영하고 결과가 없으면 빈 후보를 준다', () => {
  const run = sceneModel();
  run("state.kind='책상'; state.style='원목'; state.budget='20'; state.maxWidth='80'");
  assert.equal(run('recommendProducts().length'), 1);
  run("state.budget='1'");
  assert.equal(run('recommendProducts().length'), 0);
});
