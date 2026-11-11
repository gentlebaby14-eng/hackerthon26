import { ApiError } from './logic.js';

// Doors close the room boundary only while selecting a room. Route masks stay unchanged.
export function selectRoom({ labels, point } = {}) {
  if (!Array.isArray(labels) || labels.length < 3 || labels.length > 1024 ||
      typeof labels[0] !== 'string' || labels[0].length < 3 || labels[0].length > 1024 ||
      labels.some(row => typeof row !== 'string' || row.length !== labels[0].length || /[^0123]/.test(row)) ||
      !Array.isArray(point) || point.length !== 2 || point.some(v => !Number.isFinite(v) || v < 0 || v >= 1)) {
    throw new ApiError(400, 'INVALID_ROOM_INPUT', '도면 분석 결과와 방 안의 터치 위치가 필요해요.');
  }
  const h = labels.length, w = labels[0].length;
  const sx = Math.floor(point[0] * w), sy = Math.floor(point[1] * h);
  if (labels[sy][sx] !== '0') throw new ApiError(422, 'NOT_FLOOR', '벽·문·창문이 아닌 방 바닥을 눌러 주세요.');
  // Close one-cell prediction gaps without modifying the displayed model labels.
  const dilated = new Uint8Array(w*h), boundary = new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(labels[y][x]!=='0')
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)dilated[(y+dy)*w+x+dx]=1;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let closed=true;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h&&!dilated[(y+dy)*w+x+dx])closed=false;
    boundary[y*w+x]=closed?1:0;
  }
  if(boundary[sy*w+sx])throw new ApiError(422,'NOT_FLOOR','경계에서 조금 떨어진 방 바닥을 눌러 주세요.');
  const seen=new Uint8Array(w*h),queue=[sy*w+sx];seen[sy*w+sx]=1;
  let exterior=false;
  for(let i=0;i<queue.length;i++){
    const p=queue[i],x=p%w,y=Math.floor(p/w);
    if(x===0||y===0||x===w-1||y===h-1)exterior=true;
    for(const [nx,ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]){
      if(nx<0||ny<0||nx>=w||ny>=h)continue;
      const n=ny*w+nx;if(!boundary[n]&&!seen[n]){seen[n]=1;queue.push(n);}
    }
  }
  if(exterior)throw new ApiError(422,'OPEN_ROOM_BOUNDARY','이 영역은 도면 바깥과 연결되어 있어요. 방 안쪽을 다시 눌러 주세요. 벽·문 인식이 끊겨 있으면 방을 구분하기 어려워요.');
  const room=Array.from({length:h},(_,y)=>Array.from({length:w},(_,x)=>seen[y*w+x]?'1':'0').join(''));
  return {room,cellCount:queue.length,selectionOnly:true};
}
