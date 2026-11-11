// 프론트 3의 시연 데이터와 좌표를 맞춘다. 현재 화면은 frontend/index.html이다.
export const routineExample = '내가 책상에서 공부하는 동안 룸메가 건조대를 펼친 채 현관에서 옷장으로 가요.';

export const products = Object.freeze([
  { id: 'oak', kind: '수납장', style: '원목', name: '오크 2단 수납장', price: 159000, width: 78, depth: 35, tone: '#af825b', seller: '시연용 가구점', rating: 4.7 },
  { id: 'low', kind: '수납장', style: '원목', name: '낮은 원목 수납장', price: 189000, width: 80, depth: 38, tone: '#b89770', seller: '시연용 가구점', rating: 4.5 },
  { id: 'modern', kind: '수납장', style: '모던', name: '슬림 그레이 수납장', price: 139000, width: 60, depth: 32, tone: '#818a82', seller: '시연용 가구점', rating: 4.4 },
  { id: 'desk', kind: '책상', style: '원목', name: '오크 작업 책상', price: 179000, width: 110, depth: 52, tone: '#ad845f', seller: '시연용 가구점', rating: 4.6 },
  { id: 'shelf', kind: '선반', style: '미니멀', name: '화이트 3단 선반', price: 99000, width: 60, depth: 27, tone: '#aaa69a', seller: '시연용 가구점', rating: 4.3 }
]);

export const defaultState = Object.freeze({
  kind: '수납장', style: '원목', budget: '20', maxWidth: '80',
  product: 'oak', position: 0, rotated: false,
  width: '360', height: '270', passage: '65',
  heightCm: '', age: '', weight: '', routine: routineExample,
  applied: false
});

export const plan = Object.freeze({
  canvas: { width: 480, height: 330 },
  roomCm: { width: 360, height: 270 },
  labels: [
    { name: '현관', x: 68, y: 289 },
    { name: '창문', x: 242, y: 41 },
    { name: '책상', x: 111, y: 88 },
    { name: '의자', x: 116, y: 126 },
    { name: '옷장', x: 390, y: 85 }
  ],
  furniture: [
    { name: '책상', x: 58, y: 49, width: 106, height: 54 },
    { name: '의자', x: 98, y: 111, width: 36, height: 31 },
    { name: '옷장', x: 361, y: 43, width: 58, height: 86 }
  ],
  variants: {
    before: {
      dryingRack: { x: 253, y: 139, width: 83, height: 49 },
      route: [[94, 279], [165, 279], [165, 218], [356, 218], [356, 105], [354, 105]],
      narrowSection: { x: 333, y: 129, width: 48, height: 66 },
      minimumPassageCm: 55
    },
    after: {
      dryingRack: { x: 236, y: 62, width: 77, height: 36 },
      route: [[94, 279], [165, 279], [165, 218], [332, 218], [332, 105], [354, 105]],
      narrowSection: { x: 314, y: 103, width: 45, height: 31 },
      minimumPassageCm: 72
    }
  }
});
