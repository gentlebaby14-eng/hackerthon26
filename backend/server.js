import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultState, plan, products } from './data.js';
import { ApiError, chat, searchProducts, simulate } from './logic.js';
import { compareRoutes } from './routes.js';
import { analyzeFloorplan, modelStatus } from './model-service.js';

const maxBodyBytes = 32 * 1024;
const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const sampleDir = path.resolve(frontendDir, '..', 'ai', 'examples', 'first-pair');

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

async function readJson(req, maxBytes = maxBodyBytes) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type: application/json이 필요합니다.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new ApiError(413, 'BODY_TOO_LARGE', `요청 본문은 ${Math.round(maxBytes / 1024)}KB 이하여야 합니다.`);
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
      if (req.method === 'GET' && ['/', '/index.html', '/floorplan.html'].includes(url.pathname)) {
        const filename = url.pathname === '/floorplan.html' ? 'floorplan.html' : 'index.html';
        const html = await readFile(path.join(frontendDir, filename));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html);
      }
      if (req.method === 'GET' && ['/sample/floorplan.png', '/sample/wall-mask.png'].includes(url.pathname)) {
        const filename = url.pathname === '/sample/floorplan.png' ? 'floorplan-crop.png' : 'wall-mask-crop.png';
        const png = await readFile(path.join(sampleDir, filename));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
        return res.end(png);
      }
      if (req.method === 'GET' && url.pathname === '/sample/wall-mask-grid.json') {
        const rows = await readFile(path.join(sampleDir, 'wall-mask-grid.json'));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
        return res.end(rows);
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/health') {
        return json(res, 200, { status: 'ok', demo: true, wallModelReady: modelStatus().ready });
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/model/status') {
        return json(res, 200, modelStatus());
      }
      if (req.method === 'GET' && url.pathname === '/api/v1/demo') {
        return json(res, 200, {
          demo: true, label: '시연용 데이터', state: { ...defaultState },
          room: plan, product: products[0],
          note: '기본 시연 경로는 고정 데이터입니다. 도면 벽 분석과 경로 계산은 도면 분석 화면에서 제공합니다.'
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
      if (req.method === 'POST' && url.pathname === '/api/v1/floorplans/analyze') {
        const body = await readJson(req, 12 * 1024 * 1024);
        return json(res, 200, await analyzeFloorplan(body.image));
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/routes/compare') {
        const body = await readJson(req, 512 * 1024);
        return json(res, 200, compareRoutes(body));
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
