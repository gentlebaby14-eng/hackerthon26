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

export function chat(message, input = {}) {
  if (typeof message !== 'string' || !message.trim() || message.length > 220) {
    throw new ApiError(400, 'INVALID_INPUT', '질문을 1~220자로 입력해 주세요.');
  }
  const question = message.trim();
  const state = normalizedState(input);
  const supported = isSupported(state);
  const product = products.find(p => p.id === state.product);
  let answer;
  let showLayout = false;
  if (/가격|예산|쇼핑|상품|골라|어떤 가구/.test(question)) {
    answer = product
      ? `${product.name}은 ${product.price.toLocaleString('ko-KR')}원, 가로 ${product.width}cm예요. 가구 찾기 단계에서 예산과 최대 폭을 바꿔 다른 후보를 확인할 수 있어요.`
      : '가구 찾기에서 예산과 최대 가로폭을 바꿔보세요. 가구가 놓인 뒤의 통로는 동선 확인에서 볼 수 있어요.';
  } else if (/추천|옮기|배치|해결/.test(question)) {
    if (supported) {
      answer = '건조대를 창가 쪽으로 옮겨보세요. 시연 예시에서는 가장 좁은 통로가 55cm에서 72cm로 넓어져요.' +
        (state.passage > 72 ? ` 설정한 ${state.passage}cm에는 아직 못 미쳐요.` : '');
      showLayout = true;
    } else {
      answer = '지금 조건에 맞춘 추천 배치는 이 시연에서 제공하지 않아요. 방에 배치 단계에서 시연 예시를 불러오면 비교할 수 있어요.';
    }
  } else if (/폭|통로|좁|건조대|옷장|동선|불편/.test(question)) {
    if (supported) {
      const width = state.applied ? 72 : 55;
      answer = state.applied
        ? `건조대를 창가로 옮긴 배치에서는 옷장 앞 가장 좁은 통로가 ${width}cm예요.`
        : `건조대를 펼치면 옷장 앞 통로가 ${width}cm로 좁아져요.`;
      answer += ` 설정한 ${state.passage}cm를 ${width >= state.passage ? '충족해요.' : '충족하지 못해요.'}`;
    } else {
      answer = '이 조건의 통로 폭은 확인할 수 없어요. 시연 예시를 불러오면 현관에서 옷장까지의 통로를 확인할 수 있어요.';
    }
  } else {
    answer = '가구 조건, 옷장 앞 통로, 건조대를 옮긴 배치에 대해 안내할 수 있어요. 예를 들어 “건조대를 옮기면 뭐가 달라져?”라고 물어보세요.';
  }
  return { demo: true, label: '시연용 데이터', question, answer, showLayout, intent: showLayout ? 'OPEN_RECOMMENDATION' : null };
}
