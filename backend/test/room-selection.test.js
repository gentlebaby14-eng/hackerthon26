import test from 'node:test';
import assert from 'node:assert/strict';
import { selectRoom } from '../room-selection.js';

const labels=Array.from({length:25},(_,y)=>Array.from({length:35},(_,x)=>x===2||x===32||y===2||y===22?'1':x===17?(y>=10&&y<=13?'2':'1'):'0').join(''));
test('문을 임시 경계로 사용해 터치한 방 하나만 선택한다',()=>{
  const left=selectRoom({labels,point:[.25,.5]}),right=selectRoom({labels,point:[.75,.5]});
  assert.equal(left.room[12][8],'1');assert.equal(left.room[12][26],'0');
  assert.equal(right.room[12][8],'0');assert.equal(right.room[12][26],'1');
  assert.equal(labels[12][17],'2');
});
test('바깥 영역과 벽 터치는 거절한다',()=>{
  assert.throws(()=>selectRoom({labels,point:[0,0]}),/도면 바깥/);
  assert.throws(()=>selectRoom({labels,point:[17/35,12/25]}),/방 바닥/);
});
