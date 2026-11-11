import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConditions, recommendRealProducts, verifyCandidate } from '../product-recommendation.js';

const bedroom = {
  roomUse: '침실', desiredFurnitureTypes: ['침대'],
  existingFurniture: ['슈퍼싱글 침대', '책상', '옷장', '화장대'],
  roomWidthMm: 3300, roomDepthMm: 2700,
  occupantAge: { value: 32, unit: 'years' }, activity: '보통',
  budgetKrw: null, maxWidthCm: null
};

const productUrl = 'https://www.ikea.com/kr/ko/p/malm-bed-frame-example/';
const listing = {
  name: 'MALM 침대 프레임', price: 429000, width: 140, depth: 200,
  url: productUrl, seller: 'IKEA', recommendationReason: '방 크기에 맞는 침대 후보예요.'
};
const page = `<!doctype html><html><head>
<meta property="og:site_name" content="IKEA">
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Product', name: 'MALM 침대 프레임',
  image: 'https://www.ikea.com/images/malm-bed.jpg',
  width: { value: 140, unitCode: 'CMT' }, depth: { value: 200, unitCode: 'CMT' },
  offers: { price: '429000', priceCurrency: 'KRW' },
  aggregateRating: { ratingValue: 4.7, reviewCount: 18 }
})}</script></head><body></body></html>`;

test('스크린샷의 침실 조건을 입력으로 받고 잘못된 가구 목록은 거절한다', () => {
  assert.deepEqual(normalizeConditions(bedroom).desiredFurnitureTypes, ['침대']);
  assert.throws(() => normalizeConditions({ ...bedroom, desiredFurnitureTypes: {} }), /찾는 가구/);
});

test('API 키가 없으면 실제 검색을 했다고 응답하지 않는다', async () => {
  await assert.rejects(recommendRealProducts(bedroom, { apiKey: '' }), error => error.code === 'GEMINI_NOT_CONFIGURED');
});

test('Gemini 할당량 오류를 시연 데이터와 구별해 안내한다', async () => {
  await assert.rejects(recommendRealProducts(bedroom, {
    apiKey: 'test-key', fetchImpl: async () => new Response('', { status: 429 })
  }), error => error.code === 'GEMINI_QUOTA');
});

test('판매처의 상품 메타데이터에서 가격·사진·치수를 확인한 상품만 반환한다', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), init });
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return Response.json({ output_text: JSON.stringify({ groups: [{ group: '침대', products: [
        listing, { ...listing, url: 'https://127.0.0.1/private' },
        { ...listing, url: 'https://www.ikea.com/kr/ko/p/other/', price: 999000 }
      ] }] }) });
    }
    return new Response(page, { headers: { 'Content-Type': 'text/html' } });
  };
  const result = await recommendRealProducts(bedroom, { apiKey: 'test-key', fetchImpl });
  assert.equal(result.demo, false);
  assert.equal(result.groups[0].products.length, 1);
  assert.equal(result.groups[0].products[0].price, 429000);
  assert.equal(result.groups[0].products[0].imageUrl, 'https://www.ikea.com/images/malm-bed.jpg');
  assert.equal(result.groups[0].products[0].url, productUrl);
  assert.equal(result.groups[0].products[0].score, '4.7 · 후기 18');
  assert.match(result.groups[0].shortfallReason, /3개보다 적어요/);
  const geminiCall = seen.find(item => item.url.includes('generativelanguage.googleapis.com'));
  assert.equal(geminiCall.init.headers['x-goog-api-key'], 'test-key');
  assert.deepEqual(JSON.parse(geminiCall.init.body).tools, [{ type: 'google_search' }, { type: 'url_context' }]);
});

test('실제 페이지가 없거나 방에 들어가지 않는 크기는 제외한다', async () => {
  const fetchImpl = async () => new Response(page, { headers: { 'Content-Type': 'text/html' } });
  assert.equal(await verifyCandidate({ ...listing, url: 'https://www.ikea.com/kr/ko/search/' }, '침대', bedroom, fetchImpl), null);
  assert.equal(await verifyCandidate(listing, '침대', { ...bedroom, roomWidthMm: 1000, roomDepthMm: 1000 }, fetchImpl), null);
  assert.equal(await verifyCandidate({ ...listing, price: 400000 }, '침대', bedroom, fetchImpl), null);
});

test('18개월 아기방에서는 수납장과 놀이매트를 별도 묶음으로 추천한다', async () => {
  const baby = {
    ...bedroom, roomUse: '아기방', desiredFurnitureTypes: ['장난감 수납장', '놀이매트'],
    existingFurniture: ['아기 침대', '모빌'], roomWidthMm: 3000, roomDepthMm: 2400,
    occupantAge: { value: 18, unit: 'months' }, activity: '활동적'
  };
  const candidates = [
    { group: '장난감 수납장', name: 'TROFAST 장난감 수납장', price: 129000, width: 82, depth: 34,
      url: 'https://www.ikea.com/kr/ko/p/trofast-example/' },
    { group: '놀이매트', name: 'PLUFSIG 놀이매트', price: 149000, width: 140, depth: 180,
      url: 'https://www.ikea.com/kr/ko/p/plufsig-example/' }
  ];
  const fetchImpl = async url => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      return Response.json({ output_text: JSON.stringify({ groups: candidates.map(item => ({ group: item.group, products: [item] })) }) });
    }
    const item = candidates.find(candidate => candidate.url === String(url));
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Product', name: item.name, image: 'https://www.ikea.com/images/' + item.group + '.jpg',
      width: { value: item.width, unitCode: 'CMT' }, depth: { value: item.depth, unitCode: 'CMT' },
      offers: { price: item.price, priceCurrency: 'KRW' }
    })}</script>`;
    return new Response(html, { headers: { 'Content-Type': 'text/html' } });
  };
  const result = await recommendRealProducts(baby, { apiKey: 'test-key', fetchImpl });
  assert.deepEqual(result.groups.map(group => group.group), ['장난감 수납장', '놀이매트']);
  assert.equal(result.groups[0].products[0].kind, '수납장');
  assert.equal(result.groups[1].products[0].kind, '놀이매트');
});
