import { defaultState, plan, products, routineExample } from './data.js';

export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function finiteNumber(value, name, { min = 0, max = 1000000 } = {}) {
  if (value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new ApiError(400, 'INVALID_INPUT', `${name}은 ${min}~${max} 사이 숫자여야 합니다.`);
  }
  return Number(value);
}

export function searchProducts(query) {
  const kind = query.kind ?? defaultState.kind;
  const style = query.style ?? defaultState.style;
  if (!['수납장', '책상', '선반'].includes(kind) || !['원목', '모던', '미니멀'].includes(style)) {
    throw new ApiError(400, 'INVALID_INPUT', '가구 종류 또는 스타일을 확인해 주세요.');
  }
  const budgetManwon = finiteNumber(query.budget ?? defaultState.budget, '예산', { max: 10000 });
  const maxWidthCm = finiteNumber(query.maxWidth ?? defaultState.maxWidth, '최대 가로폭', { max: 10000 });
  const results = products.filter(p => p.kind === kind && p.style === style && p.price <= budgetManwon * 10000 && p.width <= maxWidthCm);
  return { demo: true, label: '시연용 데이터', filters: { kind, style, budgetManwon, maxWidthCm }, count: results.length, products: results };
}

function normalizedState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'INVALID_INPUT', 'state 객체를 보내 주세요.');
  }
  const state = { ...defaultState, ...input };
  state.width = finiteNumber(state.width, '방 가로', { min: 1, max: 10000 });
  state.height = finiteNumber(state.height, '방 세로', { min: 1, max: 10000 });
  state.passage = finiteNumber(state.passage, '필요한 통로 폭', { min: 1, max: 1000 });
  if (typeof state.routine !== 'string' || state.routine.length > 2000) {
    throw new ApiError(400, 'INVALID_INPUT', '생활 패턴은 2000자 이하로 입력해 주세요.');
  }
  if (!Number.isInteger(state.position) || ![0, 1].includes(state.position) || typeof state.rotated !== 'boolean' || typeof state.applied !== 'boolean') {
    throw new ApiError(400, 'INVALID_INPUT', '배치 위치, 회전, 적용 상태를 확인해 주세요.');
  }
  return state;
}

export function isSupported(state) {
  return state.routine.trim() === routineExample &&
    state.width === 360 && state.height === 270 &&
    state.product === 'oak' && state.position === 0 && !state.rotated;
}

export function simulate(input) {
  const state = normalizedState(input);
  if (!isSupported(state)) {
    throw new ApiError(422, 'DEMO_ONLY', '이 조건의 시뮬레이션은 아직 준비되지 않았어요. 시연 예시를 불러와 주세요.', {
      resetDemo: { ...defaultState },
      supportedScenario: '360×270cm 원룸, 오크 2단 수납장 기본 위치, 지정된 생활 패턴'
    });
  }
  const current = state.applied ? 'after' : 'before';
  const variants = Object.fromEntries(Object.entries(plan.variants).map(([key, variant]) => [key, {
    ...variant,
    blocked: variant.minimumPassageCm < state.passage,
    reason: key === 'before' ? '건조대를 펼치면 옷장 앞 통로가 좁아져요.' : '건조대를 창가 쪽으로 옮긴 배치예요.'
  }]));
  return {
    demo: true, label: '시연용 데이터', routeName: '현관 → 옷장',
    requiredPassageCm: state.passage, current, room: plan,
    currentResult: variants[current], variants,
    improvementCm: variants.after.minimumPassageCm - variants.before.minimumPassageCm,
    recommendedState: { ...state, applied: true },
    disclaimer: '경로와 통로 폭은 프론트 3에 지정된 시연 값입니다. 실제 공간 분석 결과가 아닙니다.'
  };
}
