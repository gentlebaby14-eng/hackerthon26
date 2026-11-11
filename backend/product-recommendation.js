import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ApiError } from './logic.js';

const promptDocument = readFileSync(new URL('./prompts/gemini-product-recommendation.md', import.meta.url), 'utf8');
const systemPrompt = promptDocument.match(/## 시스템 프롬프트\s*```text\s*([\s\S]*?)\s*```/)?.[1];
if (!systemPrompt) throw new Error('Gemini 상품 추천 프롬프트를 읽을 수 없습니다.');

const allowedKinds = ['침대', '장난감 수납장', '놀이매트', '책상', '옷장', '화장대'];
const sellerHosts = ['smartstore.naver.com', 'brand.naver.com', 'www.ikea.com', 'www.ohou.se', 'ohou.se', 'www.coupang.com', 'www.hanssem.com', 'www.iloom.com'];
const categoryTerms = {
  '침대': /침대|베드|bed/i,
  '장난감 수납장': /수납|정리함|장난감|트로파스트|trofast/i,
  '놀이매트': /매트|mat/i,
  '책상': /책상|데스크|desk/i,
  '옷장': /옷장|장롱|워드로브|wardrobe/i,
  '화장대': /화장대|드레서|dressing table/i
};

function boundedString(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function normalizeConditions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'INVALID_INPUT', '가구 추천 조건을 보내 주세요.');
  }
  if (!Array.isArray(input.desiredFurnitureTypes)) {
    throw new ApiError(400, 'INVALID_INPUT', '찾는 가구 종류를 확인해 주세요.');
  }
  const desiredFurnitureTypes = [...new Set(input.desiredFurnitureTypes)];
  if (!desiredFurnitureTypes.length ||
      desiredFurnitureTypes.length > 6 || desiredFurnitureTypes.some(kind => !allowedKinds.includes(kind))) {
    throw new ApiError(400, 'INVALID_INPUT', '찾는 가구 종류를 확인해 주세요.');
  }
  if (!Array.isArray(input.existingFurniture) || input.existingFurniture.length > 12 ||
      input.existingFurniture.some(item => typeof item !== 'string' || item.length > 80)) {
    throw new ApiError(400, 'INVALID_INPUT', '현재 가구 목록을 확인해 주세요.');
  }
  const roomWidthMm = Number(input.roomWidthMm), roomDepthMm = Number(input.roomDepthMm);
  if (![roomWidthMm, roomDepthMm].every(n => Number.isFinite(n) && n >= 1000 && n <= 20000)) {
    throw new ApiError(400, 'INVALID_INPUT', '방 가로·세로를 mm 단위로 입력해 주세요.');
  }
  const age = input.occupantAge;
  if (!age || !['years', 'months'].includes(age.unit) || !Number.isFinite(Number(age.value)) ||
      Number(age.value) < 0 || Number(age.value) > (age.unit === 'months' ? 1200 : 120)) {
    throw new ApiError(400, 'INVALID_INPUT', '사용자 연령을 확인해 주세요.');
  }
  const budgetKrw = input.budgetKrw == null ? null : Number(input.budgetKrw);
  const maxWidthCm = input.maxWidthCm == null ? null : Number(input.maxWidthCm);
  if (budgetKrw !== null && (!Number.isFinite(budgetKrw) || budgetKrw < 1000 || budgetKrw > 100000000) ||
      maxWidthCm !== null && (!Number.isFinite(maxWidthCm) || maxWidthCm < 10 || maxWidthCm > 1000)) {
    throw new ApiError(400, 'INVALID_INPUT', '예산 또는 최대 폭을 확인해 주세요.');
  }
  return {
    roomUse: boundedString(input.roomUse, 30), desiredFurnitureTypes,
    existingFurniture: input.existingFurniture.map(item => item.trim()),
    roomWidthMm, roomDepthMm,
    occupantAge: { value: Number(age.value), unit: age.unit },
    activity: boundedString(input.activity, 30), budgetKrw, maxWidthCm
  };
}

function safeHttps(value, seller = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes('.') ||
        /(^|\.)(localhost|local|internal)$/.test(url.hostname) ||
        /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;
    if (seller && (!sellerHosts.includes(url.hostname.toLowerCase()) ||
        /\/(search|catalog)(\/|$)/i.test(url.pathname) || url.pathname === '/')) return null;
    return url;
  } catch { return null; }
}

function decodeEntities(value) {
  return String(value ?? '').replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([a-f\d]+));/gi,
    (match, dec, hex) => dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) :
      ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[match.toLowerCase()] ?? match));
}

function metaTags(html) {
  const values = {};
  for (const tag of html.match(/<meta\s+[^>]*>/gi) ?? []) {
    const attrs = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(['"])(.*?)\2/g)) attrs[match[1].toLowerCase()] = decodeEntities(match[3]);
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (key && attrs.content) values[key] = attrs.content;
  }
  return values;
}

function productNodes(value) {
  if (Array.isArray(value)) return value.flatMap(productNodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...productNodes(value['@graph'] ?? []), ...productNodes(value.mainEntity ?? [])].filter(node =>
    (Array.isArray(node['@type']) ? node['@type'] : [node['@type']]).some(type => /(^|\/)Product$/i.test(type ?? '')));
}

function structuredProduct(html) {
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const product = productNodes(JSON.parse(match[1]))[0];
      if (product) return product;
    } catch { /* Invalid seller metadata is not evidence. */ }
  }
  return null;
}

function money(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const n = Number(value.replace(/[,\s₩원]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function dimension(value) {
  if (value && typeof value === 'object') {
    const n = Number(value.value);
    if (!Number.isFinite(n)) return null;
    return /MMT|mm/i.test(value.unitCode ?? value.unitText ?? '') ? n / 10 : n;
  }
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)\s*(mm|cm)/i);
  return match ? Number(match[1]) / (match[2].toLowerCase() === 'mm' ? 10 : 1) : null;
}

function pageHasDimension(html, label, cm) {
  const number = String(cm).replace('.', '\\.');
  const pattern = label === 'width' ? '(?:가로|너비|폭|width|w)' : '(?:깊이|세로|depth|d)';
  return new RegExp(`${pattern}[^<\\n]{0,35}?(?:${number}\\s*cm|${Number(cm) * 10}\\s*mm)`, 'i').test(decodeEntities(html));
}

async function readLimited(response, maxBytes = 2 * 1024 * 1024) {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new Error('page too large');
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error('page too large'); }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchSellerPage(rawUrl, fetchImpl) {
  let url = safeHttps(rawUrl, true);
  if (!url) return null;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetchImpl(url, {
      redirect: 'manual', signal: AbortSignal.timeout(12000),
      headers: { Accept: 'text/html,application/xhtml+xml' }
    });
    if (response.status >= 300 && response.status < 400) {
      url = safeHttps(new URL(response.headers.get('location') ?? '', url).href, true);
      if (!url) return null;
      continue;
    }
    if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') ?? '')) return null;
    return { url: url.href, html: await readLimited(response) };
  }
  return null;
}

function sameProduct(modelName, pageName) {
  const words = modelName.toLowerCase().match(/[가-힣a-z0-9]{3,}/g) ?? [];
  return words.some(word => pageName.toLowerCase().includes(word));
}

export async function verifyCandidate(candidate, group, conditions, fetchImpl = fetch) {
  if (!candidate || typeof candidate !== 'object') return null;
  const requestedUrl = safeHttps(candidate.url, true);
  if (!requestedUrl) return null;
  const page = await fetchSellerPage(requestedUrl.href, fetchImpl);
  if (!page) return null;
  const meta = metaTags(page.html), structured = structuredProduct(page.html);
  const pageName = boundedString(structured?.name ?? meta['og:title'], 180);
  if (!pageName || !sameProduct(boundedString(candidate.name), pageName) || !categoryTerms[group].test(pageName)) return null;
  const offer = Array.isArray(structured?.offers) ? structured.offers[0] : structured?.offers;
  const pagePrice = money(offer?.price ?? offer?.priceSpecification?.price ?? meta['product:price:amount']);
  const currency = offer?.priceCurrency ?? meta['product:price:currency'];
  if (currency && currency !== 'KRW' || !Number.isInteger(pagePrice) || pagePrice < 1000 || pagePrice > 100000000 ||
      (candidate.price != null && money(candidate.price) !== pagePrice) ||
      (conditions.budgetKrw !== null && pagePrice > conditions.budgetKrw)) return null;
  const pageImage = (Array.isArray(structured?.image) ? structured.image[0] : structured?.image) ?? meta['og:image'];
  const imageValue = typeof pageImage === 'object' ? pageImage.url ?? pageImage.contentUrl : pageImage;
  const imageUrl = safeHttps(imageValue);
  if (!imageUrl) return null;
  const width = dimension(structured?.width) ?? Number(candidate.width);
  const depth = dimension(structured?.depth) ?? Number(candidate.depth);
  if (![width, depth].every(n => Number.isFinite(n) && n >= 10 && n <= 1000) ||
      (dimension(structured?.width) == null && !pageHasDimension(page.html, 'width', width)) ||
      (dimension(structured?.depth) == null && !pageHasDimension(page.html, 'depth', depth)) ||
      (conditions.maxWidthCm !== null && width > conditions.maxWidthCm) ||
      !((width * 10 <= conditions.roomWidthMm && depth * 10 <= conditions.roomDepthMm) ||
        (width * 10 <= conditions.roomDepthMm && depth * 10 <= conditions.roomWidthMm))) return null;
  const rating = Number(structured?.aggregateRating?.ratingValue);
  const reviewCount = Number(structured?.aggregateRating?.reviewCount);
  const hasRating = Number.isFinite(rating) && rating > 0 && rating <= 5 && Number.isInteger(reviewCount) && reviewCount > 0;
  return {
    id: 'live-' + createHash('sha256').update(page.url).digest('hex').slice(0, 12),
    kind: group === '장난감 수납장' ? '수납장' : group,
    group, name: pageName, seller: boundedString(meta['og:site_name'] ?? requestedUrl.hostname, 80),
    price: pagePrice, shippingPrice: null, width, depth,
    tone: group === '놀이매트' ? '#d8ccd0' : group === '침대' ? '#c9b59f' : '#b9936e',
    score: hasRating ? `${rating} · 후기 ${reviewCount.toLocaleString('ko-KR')}` : null,
    rating: hasRating ? rating : null, reviewCount: hasRating ? reviewCount : null,
    imageUrl: imageUrl.href, url: page.url, sourceUrl: page.url,
    recommendationReason: boundedString(candidate.recommendationReason, 160)
  };
}

function parseGeminiOutput(body) {
  const result = body.interaction ?? body;
  const stepText = (result.steps ?? []).filter(step => step.type === 'model_output' || step.type === 'modelOutput')
    .flatMap(step => step.content ?? step.modelOutput?.content ?? []).map(block => block.text ?? '').join('');
  const raw = result.output_text ?? result.outputText ?? stepText;
  if (!raw) throw new ApiError(502, 'GEMINI_EMPTY', 'Gemini가 상품 후보를 반환하지 않았어요.');
  try { return JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); }
  catch { throw new ApiError(502, 'GEMINI_INVALID_JSON', 'Gemini 상품 응답 형식을 확인할 수 없어요.'); }
}

const productSchema = {
  type: 'object', properties: { groups: { type: 'array', items: {
    type: 'object', properties: {
      group: { type: 'string' }, products: { type: 'array', items: {
        type: 'object', properties: {
          name: { type: 'string' }, seller: { type: 'string' }, price: { type: 'integer' },
          width: { type: 'number' }, depth: { type: 'number' }, url: { type: 'string' },
          imageUrl: { type: 'string' }, recommendationReason: { type: 'string' }
        }, required: ['name', 'price', 'width', 'depth', 'url']
      } }
    }, required: ['group', 'products']
  } } }, required: ['groups']
};

export async function recommendRealProducts(input, options = {}) {
  const conditions = normalizeConditions(input);
  const apiKey = (options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.API_KEY ?? '').trim();
  if (!apiKey) throw new ApiError(503, 'GEMINI_NOT_CONFIGURED', 'Gemini API 키가 없어 실제 상품을 검색할 수 없어요.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  let response;
  try {
    response = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', signal: AbortSignal.timeout(65000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, 'Api-Revision': '2026-05-20' },
      body: JSON.stringify({
        model,
        input: `${systemPrompt}\n\n다음 사용자 조건으로 판매처 상품 상세 페이지를 검색하세요. 각 종류마다 최대 3개를 반환하세요.\n${JSON.stringify(conditions)}`,
        tools: [{ type: 'google_search' }, { type: 'url_context' }],
        response_format: { type: 'text', mime_type: 'application/json', schema: productSchema }
      })
    });
  } catch {
    throw new ApiError(502, 'GEMINI_UNAVAILABLE', 'Gemini에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  if (!response.ok) {
    if (response.status === 429) {
      throw new ApiError(503, 'GEMINI_QUOTA', 'Gemini 사용량 한도에 도달했어요. AI Studio의 할당량을 확인해 주세요.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(503, 'GEMINI_ACCESS', 'Gemini API 키 또는 모델 사용 권한을 확인해 주세요.');
    }
    throw new ApiError(502, 'GEMINI_ERROR', `Gemini 상품 검색에 실패했어요. (${response.status})`);
  }
  let data;
  try { data = parseGeminiOutput(await response.json()); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(502, 'GEMINI_INVALID_JSON', 'Gemini 응답을 읽을 수 없어요.'); }
  const groups = await Promise.all(conditions.desiredFurnitureTypes.map(async group => {
    const candidates = data.groups?.find(item => item.group === group)?.products;
    const distinct = [...new Map((Array.isArray(candidates) ? candidates : []).slice(0, 8)
      .filter(item => typeof item?.url === 'string').map(item => [item.url, item])).values()];
    const checks = await Promise.allSettled(distinct.map(candidate => verifyCandidate(candidate, group, conditions, fetchImpl)));
    const products = checks.filter(check => check.status === 'fulfilled' && check.value).map(check => check.value).slice(0, 3)
      .map((item, index) => ({ ...item, rank: index + 1 }));
    return { group, requestedCount: 3, products,
      shortfallReason: products.length < 3 ? '판매처에서 상품명·가격·사진·치수를 확인한 상품이 3개보다 적어요.' : null };
  }));
  return { demo: false, source: 'gemini_search', checkedAt: new Date().toISOString(), groups };
}
