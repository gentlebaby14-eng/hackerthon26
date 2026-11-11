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

test('YOLO 픽셀·정규화 박스는 같은 사진 위치가 되고 잘못된 박스는 제외한다',()=>{
  const {run}=editor();
  assert.equal(run('JSON.stringify(photoBox({x:100,y:200,width:300,height:500},1000,1000))'),'[0.1,0.2,0.4,0.7]');
  assert.equal(run('JSON.stringify(photoBox([.1,.2,.4,.7]))'),'[0.1,0.2,0.4,0.7]');
  assert.equal(run('photoBox([100,200,400,700])'),null);
  assert.equal(run('photoBox([.5,.5,.1,.1])'),null);
});
test('방문 기준 사진 좌우·거리를 네 방향으로 회전해 배치한다',()=>{
  const {run}=editor();
  run('draft.items=[{id:"a",w:30,d:30,photoBox:[.1,.1,.3,.4]}];draft.active="a"');
  for(const [side,wall] of [['bottom','left'],['top','right'],['left','top'],['right','bottom']]){
    run(`draft.doorSide='${side}';projectPhotoItem(selectedItem())`);
    assert.equal(run('selectedItem().photoWall'),wall);
    assert.ok(run('selectedItem().x')>0&&run('selectedItem().x')<1);
    assert.ok(run('selectedItem().y')>0&&run('selectedItem().y')<1);
  }
});

test('사진에서 본 벽 방향에 맞춰 긴 가구 축을 자동 회전한다',()=>{
  const {run}=editor();
  run("draft.doorSide='bottom';draft.items=[{id:'desk',w:100,d:55,photoBox:[.02,.2,.25,.75]}];draft.active='desk';projectPhotoItem(selectedItem())");
  assert.equal(run('selectedItem().photoWall'),'left');
  assert.ok(run('selectedItem().d')>run('selectedItem().w'));
  run("draft.items=[{id:'bed',w:110,d:200,photoBox:[.4,.1,.6,.5]}];draft.active='bed';projectPhotoItem(selectedItem())");
  assert.equal(run('selectedItem().photoWall'),'top');
  assert.ok(run('selectedItem().w')>run('selectedItem().d'));
});
test('문 인식은 선택한 방 경계의 문만 사용하고 문이 없으면 수동 선택을 기다린다',()=>{
  const {run}=editor();
  assert.equal(run('detectedDoorSide()'),null);
  run("state.structure.labels=Array(20).fill('0'.repeat(20));state.structure.labels[19]='00000000222200000000'");
  assert.equal(run('detectedDoorSide()'),'bottom');
});

test('연령과 활동성에 따라 아기·어린이·성인 걸음이 확실히 달라진다',()=>{
  const {run}=editor();
  run("state.roomUse='아기방';state.age='18';state.activity='활동적'");
  assert.equal(run('walkerProfile().label'),'18개월 아기');
  assert.ok(run('walkerProfile().scale')<1);
  run("state.roomUse='침실';state.age='8';state.activity='보통'");
  assert.equal(run('walkerProfile().label'),'어린이');
  run("state.age='32';state.activity='차분함'");
  assert.equal(run('walkerProfile().label'),'성인');
  assert.ok(run('walkerProfile().speed')<1);
});

test('AI 배치 추천은 새 가구를 방·가구·문 개폐 공간과 겹치지 않게 배치한다',()=>{
  const {run}=editor();
  run("draft.doorSide='bottom';draft.items=[{id:'old',name:'침대',w:80,d:120,x:.25,y:.35,source:'yolo'},{id:'new',name:'수납장',w:60,d:40,x:.55,y:.55,source:'manual'}];draft.active='new'");
  assert.equal(run('optimizeFurnitureLayout()'),true);
  assert.equal(run('draft.optimization.targetId'),'new');
  assert.equal(run('itemFits(selectedItem())'),true);
  assert.equal(run("overlaps(selectedItem(),draft.items.find(item=>item.id==='old'))"),false);
  assert.equal(run('intersectsDoorSwing(selectedItem())'),false);
  assert.ok(run('draft.optimization.recommended.route.path.length')>1);
});

test('시뮬레이션 진입 시 방문 쪽 출발점과 안전한 목적지 경로를 자동 준비한다',()=>{
  const {run}=editor();
  run("draft.items=[];draft.doorSide='bottom';state.passage='20'");
  assert.equal(run('prepareAutomaticSimulation()'),true);
  assert.ok(run('state.startPoint[1]')>0.5);
  assert.ok(run('draft.route.path.length')>1);
  assert.equal(run('draft.route.path.every(point=>roomCell(...point))'),true);
});

test('새 가구 없이 기존 가구를 옮겨도 최초 배치와 변경 배치를 분리한다',()=>{
  const {run}=editor();
  run("draft.items=[{id:'desk',source:'yolo',x:.2,y:.3,w:100,d:55}];captureInitialLayout();draft.items[0].x=.7;draft.items[0].y=.6");
  assert.equal(run('beforeLayoutItems()[0].x'),.2);
  assert.equal(run('beforeLayoutItems()[0].y'),.3);
  assert.equal(run('draft.items[0].x'),.7);
});

test('조건 화면에 추가할 가구 해당없음과 기존·변경 배치 비교를 제공한다',()=>{
  const {run}=editor();
  run('draft.page=1');
  assert.match(run('flowControls()'),/해당없음/);
  run("draft.page=5;draft.route={path:[[.1,.1],[.2,.2]],distance:10};draft.compare=draft.route");
  const controls=run('flowControls()');
  assert.match(controls,/기존 배치/);assert.match(controls,/변경 배치/);assert.match(controls,/A\* 다중 생활 동선/);
  assert.doesNotMatch(controls,/출발점 찍기|목적지 찍기|필요한 통로 폭/);
});

test('고정 시연 도면은 지정한 방과 방문 방향을 모델 결과와 무관하게 선택한다',()=>{
  const {run}=editor();
  run("state.photo={name:'방 평면도.png'};state.structure.labels=Array(100).fill('0'.repeat(100));state.structure.room=null");
  assert.equal(run('applyKnownDemoRoom()'),true);
  assert.equal(run('draft.doorSide'),'top');
  assert.ok(run('roomCell(.5,.5)'));
  run("state.photo={name:'아기방 평면도.png'};state.structure.room=null;applyKnownDemoRoom()");
  assert.equal(run('draft.doorSide'),'top');
});

test('두 시연 사진의 YOLO 가구를 사진과 같은 벽·방향 프리셋에 놓는다',()=>{
  const {run}=editor();
  run("draft.photo={name:'내 방 사진.png'};draft.items=[{id:'bed',w:110,d:200}];draft.active='bed'");
  assert.equal(run("knownPhotoPlacement(selectedItem(),'bed')"),true);
  assert.equal(run('selectedItem().photoWall'),'right');
  assert.equal(run('selectedItem().x'),.8);
  run("draft.photo={name:'아기방 사진.png'};draft.items=[{id:'cabinet',w:75,d:40}];draft.active='cabinet';knownPhotoPlacement(selectedItem(),'cabinet')");
  assert.equal(run('selectedItem().photoWall'),'left');
  assert.ok(run('selectedItem().d')>run('selectedItem().w'));
});

test('가구 배치 화면은 방 사진을 노출하지 않고 평면도와 추가 버튼을 유지한다',()=>{
  const {run}=editor();
  run("draft.page=4;draft.photoUrl='blob:room-photo';draft.photo={name:'내 방 사진.png'}");
  const controls=run('flowControls()');
  assert.match(controls,/고른 가구 추가하기/);assert.match(controls,/직접 추가/);assert.match(controls,/방 사진으로 가구 자동 배치/);
  assert.doesNotMatch(controls,/<img[^>]+blob:room-photo/);
});

test('고정 시연 방은 원본 도면의 가로세로 비율과 Canvas 비율을 일치시킨다',()=>{
  const {run}=editor();
  run("state.photo={name:'아기방 평면도.png'};state.structure.labels=Array(100).fill('0'.repeat(100));state.floorplanImage={naturalWidth:498,naturalHeight:435};state.width='3000';state.height='2400';applyKnownDemoRoom()");
  const sourceAspect=run('editorRect().source.w/editorRect().source.h');
  const canvasAspect=run('editorRect().w/editorRect().h');
  assert.ok(Math.abs(sourceAspect-canvasAspect)<.01);
});

test('고정 도면도 업로드 직후에는 선택하지 않고 사용자가 누른 뒤 방을 표시한다',async()=>{
  const {run}=editor();
  run("state.photo={name:'방 평면도.png'};state.structure.labels=Array(100).fill('0'.repeat(100));state.structure.room=null;state.floorplanImage={naturalWidth:1007,naturalHeight:758}");
  assert.equal(run('state.structure.room'),null);
  await run('selectFlowRoom([.18,.78])');
  assert.ok(run('roomBounds()'));
  assert.equal(run('draft.doorSide'),'top');
});

test('내 방 사진 프리셋은 비율 보정 후에도 모든 가구 사이 간격을 유지한다',()=>{
  const {run}=editor();
  run("state.width='2760';state.height='3230';draft.photo={name:'내 방 사진.png'};draft.items=[]");
  for(const [type,w,d] of [['bed',110,200],['chair',45,45],['desk',100,55],['cabinet',75,40]])
    run(`addLayoutItem({name:'${type}',w:${w},d:${d},source:'yolo'});knownPhotoPlacement(selectedItem(),'${type}')`);
  run('settleProjectedItems()');
  assert.equal(run('layoutFits()'),true);
  assert.equal(run('draft.items.some((item,i)=>draft.items.slice(0,i).some(other=>overlaps(item,other)))'),false);
});

test('가구가 많은 방도 남은 빈 공간에서 캐릭터 재생 경로를 반드시 찾는다',()=>{
  const {run}=editor();
  run("state.width='2760';state.height='3230';state.passage='65';draft.doorSide='top';draft.items=[{x:.8,y:.5,w:110,d:200},{x:.36,y:.85,w:100,d:55},{x:.36,y:.5,w:45,d:45},{x:.12,y:.48,w:40,d:75},{x:.18,y:.12,w:60,d:40}]");
  assert.equal(run('prepareAutomaticSimulation()'),true);
  assert.ok(run('draft.route.path.length')>2);
  assert.equal(run("draft.route.path.some(([x,y])=>draft.items.some(item=>Math.abs(x-item.x)<item.w/(2*roomWidth())&&Math.abs(y-item.y)<item.d/(2*roomDepth())))"),false);
});

test('시연 동선은 임의의 모서리가 아니라 실제 방문 근처에서 시작한다',()=>{
  const {run}=editor();
  run("state.photo={name:'방 평면도.png'};state.structure.labels=Array(100).fill('0'.repeat(100));state.floorplanImage={naturalWidth:1007,naturalHeight:758};applyKnownDemoRoom();draft.items=[];draft.view='after';prepareAutomaticSimulation()");
  assert.ok(run('Math.hypot(draft.route.path[0][0]-.86,draft.route.path[0][1]-.05)')<.2);
  assert.ok(run('Math.min(...draft.route.path.map(point=>point[0]*roomWidth()))')>=20);
  assert.ok(run('Math.min(...draft.route.path.map(point=>point[1]*roomDepth()))')>=20);
  assert.ok(run('Math.max(...draft.route.path.map(([x,y])=>Math.min(x*roomWidth(),(1-x)*roomWidth(),y*roomDepth(),(1-y)*roomDepth())))')>70);
});

test('선택한 가구의 회전·삭제 버튼은 동선 버튼 바로 위 하단 영역에 표시한다',()=>{
  const {run}=editor();
  run("draft.page=4;draft.items=[{id:'desk',name:'책상',w:100,d:55,x:.5,y:.5,source:'yolo'}];draft.active='desk'");
  const controls=run('flowControls()');
  assert.match(controls,/layout-bottom-actions/);assert.match(controls,/가구 90° 회전/);assert.match(controls,/가구 삭제/);
  assert.ok(controls.indexOf('layout-bottom-actions')<controls.indexOf('동선 비교'));
});

test('생활 동선은 문에서 시작해 침대·의자·침대·책상 순으로 가구 사이를 방문한다',()=>{
  const {run}=editor();
  run("state.width='2760';state.height='3230';draft.doorSide='top';draft.items=[{id:'bed',name:'침대',x:.8,y:.5,w:110,d:200,source:'yolo'},{id:'chair',name:'의자',x:.36,y:.5,w:45,d:45,source:'yolo'},{id:'desk',name:'책상',x:.36,y:.85,w:100,d:55,source:'yolo'},{id:'cabinet',name:'수납장',x:.12,y:.48,w:40,d:75,source:'yolo'}];captureInitialLayout();draft.view='after'");
  assert.equal(run('prepareAutomaticSimulation()'),true);
  assert.equal(run("draft.visitLabels.slice(0,5).join('>')"),'문>침대>의자>침대>책상');
  assert.ok(run('draft.route.path.length')>5);
});

test('무작위 생활 동선은 같은 시드에서 같은 목적지 순서를 재현한다',()=>{
  const {run}=editor();
  run("state.activity='보통';const seqA=generateLifeSequences(['a','b','c'],20,731);const seqB=generateLifeSequences(['a','b','c'],20,731);const seqC=generateLifeSequences(['a','b','c'],20,732)");
  assert.equal(run('JSON.stringify(seqA)'),run('JSON.stringify(seqB)'));
  assert.notEqual(run('JSON.stringify(seqA)'),run('JSON.stringify(seqC)'));
});

test('반복 A* 결과의 히트맵과 모서리 접근 값은 계산된 경로에서만 누적된다',()=>{
  const {run}=editor();
  run("state.roomUse='아기방';state.age='18';draft.doorSide='bottom';const babyItems=[{id:'cab',name:'장난감 수납장',w:50,d:40,x:.3,y:.3,source:'yolo'},{id:'desk',name:'책상',w:80,d:45,x:.7,y:.35,source:'yolo'}];const seq=generateLifeSequences(['cab','desk'],8,22);const sim=simulateLifePaths(babyItems,seq,22)");
  assert.equal(run('sim.runs'),8);
  assert.equal(run('sim.heat.reduce((a,b)=>a+b,0)'),run('sim.paths.flat().length'));
  assert.ok(run('sim.success+sim.failures')===8);
  assert.equal(run('sim.corners.every(c=>c.count>0&&Number.isFinite(c.min))'),true);
});
