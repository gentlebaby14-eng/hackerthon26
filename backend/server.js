import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { defaultState, plan, products } from './data.js';
import { ApiError, chat, searchProducts, simulate } from './logic.js';

const maxBodyBytes = 32 * 1024;

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type: application/json이 필요합니다.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      throw new ApiError(413, 'BODY_TOO_LARGE', '요청 본문은 32KB 이하여야 합니다.');
    }
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object required');
    return body;
  } catch {
    throw new ApiError(400, 'INVALID_JSON', '올바른 JSON 객체를 보내 주세요.');
  }
}

export function createApp() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return json(res, 204, null);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/v1/health') {
        return json(res, 200, { status: 'ok', demo: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/demo') {
        return json(res, 200, {
          demo: true, label: '시연용 데이터', state: { ...defaultState },
          room: plan, product: products[0],
          note: '주소 검색, 사진 분석, 웹 쇼핑 검색, 실제 경로 계산은 연결되지 않았습니다.'
        });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/products') {
        return json(res, 200, searchProducts(Object.fromEntries(url.searchParams)));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/v1/products/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/v1/products/'.length));
        const product = products.find(p => p.id === id);
        if (!product) throw new ApiError(404, 'NOT_FOUND', '상품을 찾을 수 없어요.');
        return json(res, 200, { demo: true, label: '시연용 데이터', product });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/simulations') {
        const body = await readJson(req);
        return json(res, 200, simulate(body.state ?? body));
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/chat') {
        const body = await readJson(req);
        return json(res, 200, chat(body.message, body.state ?? {}));
      }
      throw new ApiError(404, 'NOT_FOUND', '요청한 API가 없어요.');
    } catch (error) {
      if (error instanceof ApiError) {
        return json(res, error.status, { error: { code: error.code, message: error.message, ...error.extra } });
      }
      console.error(error);
      return json(res, 500, { error: { code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' } });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT는 1~65535 사이 정수여야 합니다.');
    process.exit(1);
  }
  createApp().listen(port, '127.0.0.1', () => {
    console.log(`Roommate 시연 API: http://127.0.0.1:${port}/api/v1/health`);
  });
}
