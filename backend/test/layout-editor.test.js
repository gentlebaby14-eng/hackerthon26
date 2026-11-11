import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function editor(){
  const listeners=[];
  const nodes=new Map(['#workspace','.shell','main','#progress','#headline','#intro','#controls','#visual','#chat','#chat-open','#chat-close','#chat-form','#chat-result'].map(key=>[key,{dataset:{},classList:{toggle(){}},focus(){}}]));
  let calls=0;
  const context=vm.createContext({document:{querySelector:s=>nodes.get(s)||null,querySelectorAll:()=>[],addEventListener:(type,fn,capture)=>listeners.push({type,fn,capture})},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},FileReader:class{readAsDataURL(){this.result='data:image/png;base64,TEST';this.onload();}},fetch:async(url,options)=>{calls++;assert.equal(url,'/api/v1/furniture/detect');assert.equal(options.headers['Content-Type'],'application/json');return {ok:true,json:async()=>({items:[{type:'bed',confidence:.8}]})};}});
  const html=readFileSync(new URL('../../frontend/index.html',import.meta.url),'utf8');
  for(const [,s]of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(s,context);
  const run=s=>vm.runInContext(s,context);
  run("render=()=>{};draft.page=4;state.structure.room=Array(20).fill('1'.repeat(20));state.floorplanImage={naturalWidth:1000,naturalHeight:1000};state.width='3300';state.height='2700';");
  return {run,context,listeners,calls:()=>calls};
}
test('침대 도형은 방 실측 비율로 표시하고 축마다 같은 축척을 사용한다',()=>{
  const {run}=editor();
  assert.ok(Math.abs(run('footprint({w:150,d:200}).w')-150/330)<1e-9);
  assert.ok(Math.abs(run('editorRect().w/330-editorRect().h/270'))<1e-9);
});
test('모서리 드래그는 반대편 모서리를 유지하고 cm 크기를 줄인다',()=>{
  const {run}=editor();
  run('draft.items=[{id:"bed",name:"침대",w:150,d:200,x:.5,y:.5}];draft.active="bed";const anchor=resizeHandles(selectedItem())[0];resizeLayoutItem(selectedItem(),anchor,[anchor[0]+100/330,anchor[1]+160/270]);');
  assert.equal(run('selectedItem().w'),100);assert.equal(run('selectedItem().d'),160);
  assert.ok(Math.abs(run('resizeHandles(selectedItem())[0][0]-anchor[0]'))<1e-9);
});
test('배치 페이지에서 사진 업데이트 시 YOLO가 자동 실행되고 기존 수동 가구는 보존된다',async()=>{
  const e=editor();e.run("draft.items=[{id:'old',source:'yolo'},{id:'keep',source:'manual',w:40,d:40,x:.2,y:.2}]");
  const fn=e.listeners.filter(x=>x.type==='change'&&x.capture).at(-1).fn;
  await fn({target:{id:'flow-room-photo',dataset:{},files:[{name:'room.png',type:'image/png',size:1000}]},stopImmediatePropagation(){}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(e.calls(),1);assert.equal(e.run('draft.photoStatus'),'done');
  assert.equal(e.run('draft.items.filter(x=>x.source==="yolo").length'),1);
  assert.equal(e.run('draft.items.some(x=>x.id==="keep")'),true);
  assert.equal(e.run('draft.items.find(x=>x.source==="yolo").w'),110);
});
