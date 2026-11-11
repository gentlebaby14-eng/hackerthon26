import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('새 완료 버튼과 이전 완료 버튼 모두 방을 저장하고 가구 찾기로 이동한다',()=>{
  for(const dataset of [{flow:'confirm-room'},{action:'room-confirm'}]){
    const nodes=new Map(['#workspace','.shell','main','#progress','#headline','#intro','#controls','#visual','#chat','#chat-open','#chat-close','#chat-form','#chat-result'].map(key=>[key,{dataset:{},classList:{toggle(){}},innerHTML:'',textContent:'',focus(){}}]));
    const clicks=[],saved=new Map();
    const context=vm.createContext({document:{querySelector:s=>nodes.get(s)||null,querySelectorAll:()=>[],addEventListener(type,handler,capture){if(type==='click'&&capture)clicks.push(handler);}},sessionStorage:{setItem:(k,v)=>saved.set(k,v)}});
    const html=readFileSync(new URL('../../frontend/index.html',import.meta.url),'utf8');
    for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(script,context);
    vm.runInContext("draft.page=2;state.floorplanImage={};state.structure.labels=['11111','10001','10001','10001','11111'];state.structure.room=['00000','01110','01110','01110','00000'];",context);
    const button={dataset};clicks.at(-1)({target:{closest:()=>button},stopImmediatePropagation(){}});
    assert.equal(vm.runInContext('draft.page',context),3);
    assert.match(nodes.get('#headline').innerHTML,/내 방에 어울리는 가구/);
    assert.ok(saved.has('roomai.selectedRoom'));
  }
});
