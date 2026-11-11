import { ApiError } from './logic.js';

class MinHeap {
  items = [];
  push(cost, index) {
    const a = this.items;
    let i = a.length;
    a.push([cost, index]);
    while (i) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= cost) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = [cost, index];
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        if (left >= a.length) break;
        const right = left + 1;
        const child = right < a.length && a[right][0] < a[left][0] ? right : left;
        if (a[child][0] >= last[0]) break;
        a[i] = a[child];
        i = child;
      }
      a[i] = last;
    }
    return top;
  }
  get length() { return this.items.length; }
}

const number = (value, name, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, 'INVALID_INPUT', `${name}: ${min}~${max} 사이 숫자를 입력해 주세요.`);
  return n;
};

function point(value, name) {
  if (!Array.isArray(value) || value.length !== 2) throw new ApiError(400, 'INVALID_INPUT', `${name} 좌표가 필요합니다.`);
  return [number(value[0], `${name} x`, 0, 1), number(value[1], `${name} y`, 0, 1)];
}

function parseMask(rows) {
  if (!Array.isArray(rows) || rows.length < 16 || rows.length > 256 ||
      !rows.every(row => typeof row === 'string' && row.length === rows[0].length && /^[01]+$/.test(row)) ||
      rows[0].length < 16 || rows[0].length > 256) {
    throw new ApiError(400, 'INVALID_MASK', '벽 마스크는 16~256 픽셀의 0/1 행 배열이어야 합니다.');
  }
  const height = rows.length, width = rows[0].length;
  const walls = new Uint8Array(width * height);
  let minX = width, maxX = -1, minY = height, maxY = -1, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rows[y][x] !== '1') continue;
    walls[y * width + x] = 1;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++;
  }
  if (count < 4) throw new ApiError(422, 'NO_WALLS', '감지된 벽이 너무 적어 동선을 계산할 수 없어요. 도면과 모델을 확인해 주세요.');
  // 이미지에 넓은 흰 여백이 있어도 실제 치수는 벽이 차지하는 영역에 적용한다.
  const bounds = maxX - minX + 1 >= width * 0.15 && maxY - minY + 1 >= height * 0.15
    ? { minX, maxX, minY, maxY }
    : { minX: 0, maxX: width - 1, minY: 0, maxY: height - 1 };
  return { walls, width, height, bounds };
}

function neighbors(index, width, height, dx, dy) {
  const x = index % width, y = Math.floor(index / width);
  const out = [];
  for (const [sx, sy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const nx = x + sx, ny = y + sy;
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      out.push([ny * width + nx, Math.hypot(sx * dx, sy * dy), sx, sy]);
    }
  }
  return out;
}

function clearance(blocked, width, height, dx, dy) {
  const distance = new Float64Array(blocked.length).fill(Infinity);
  const heap = new MinHeap();
  for (let i = 0; i < blocked.length; i++) if (blocked[i]) {
    distance[i] = 0;
    heap.push(0, i);
  }
  while (heap.length) {
    const [cost, index] = heap.pop();
    if (cost > distance[index]) continue;
    for (const [next, weight] of neighbors(index, width, height, dx, dy)) {
      const nextCost = cost + weight;
      if (nextCost < distance[next]) {
        distance[next] = nextCost;
        heap.push(nextCost, next);
      }
    }
  }
  return distance;
}

function runRoute(blocked, width, height, start, end, dx, dy, passageCm) {
  const distance = clearance(blocked, width, height, dx, dy);
  const radius = passageCm / 2;
  const s = Math.min(height - 1, Math.floor(start[1] * height)) * width + Math.min(width - 1, Math.floor(start[0] * width));
  const t = Math.min(height - 1, Math.floor(end[1] * height)) * width + Math.min(width - 1, Math.floor(end[0] * width));
  if (blocked[s] || blocked[t]) return {
    reachable: false, reason: '현관 또는 목적지를 가구가 막고 있어요.',
    path: [], lengthCm: null, minimumPassageCm: null
  };
  if (distance[s] < radius || distance[t] < radius) {
    return { reachable: false, reason: '현관 또는 목적지의 주변 공간이 설정한 통로 폭보다 좁아요.', path: [], lengthCm: null, minimumPassageCm: null };
  }
  const best = new Float64Array(blocked.length).fill(Infinity);
  const previous = new Int32Array(blocked.length).fill(-1);
  const heap = new MinHeap();
  best[s] = 0;
  heap.push(0, s);
  while (heap.length) {
    const [cost, index] = heap.pop();
    if (cost > best[index]) continue;
    if (index === t) break;
    const x = index % width, y = Math.floor(index / width);
    for (const [next, weight, sx, sy] of neighbors(index, width, height, dx, dy)) {
      if (distance[next] < radius) continue;
      if (sx && sy && (distance[y * width + x + sx] < radius || distance[(y + sy) * width + x] < radius)) continue;
      const nextCost = cost + weight;
      if (nextCost < best[next]) {
        best[next] = nextCost;
        previous[next] = index;
        heap.push(nextCost, next);
      }
    }
  }
  if (!Number.isFinite(best[t])) return {
    reachable: false, reason: '벽 또는 가구와 필요한 통로 폭 때문에 목적지까지 갈 수 없어요.',
    path: [], lengthCm: null, minimumPassageCm: null
  };
  const indices = [];
  for (let i = t; i !== -1; i = previous[i]) indices.push(i);
  indices.reverse();
  let narrowest = Infinity, bottleneck = null;
  const path = indices.map(i => {
    if (distance[i] < narrowest) {
      narrowest = distance[i];
      bottleneck = [(i % width + 0.5) / width, (Math.floor(i / width) + 0.5) / height];
    }
    return [(i % width + 0.5) / width, (Math.floor(i / width) + 0.5) / height];
  });
  return { reachable: true, reason: '현관에서 목적지까지 이동할 수 있어요.',
    path, lengthCm: Math.round(best[t]), minimumPassageCm: Math.round(narrowest * 2), bottleneck };
}

function addFurniture(blocked, width, height, bounds, roomWidthCm, roomHeightCm, furniture, center) {
  const widthGrid = furniture.widthCm / roomWidthCm * (bounds.maxX - bounds.minX + 1);
  const heightGrid = furniture.depthCm / roomHeightCm * (bounds.maxY - bounds.minY + 1);
  const cx = center[0] * width, cy = center[1] * height;
  const left = Math.max(0, Math.floor(cx - widthGrid / 2));
  const right = Math.min(width - 1, Math.ceil(cx + widthGrid / 2));
  const top = Math.max(0, Math.floor(cy - heightGrid / 2));
  const bottom = Math.min(height - 1, Math.ceil(cy + heightGrid / 2));
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) blocked[y * width + x] = 1;
  return { x: left / width, y: top / height, width: (right - left + 1) / width, height: (bottom - top + 1) / height };
}

export function compareRoutes(input) {
  if (!input || typeof input !== 'object') throw new ApiError(400, 'INVALID_INPUT', '요청 객체가 필요합니다.');
  const { walls, width, height, bounds } = parseMask(input.mask);
  const roomWidthCm = number(input.roomWidthCm, '방 가로', 100, 10000);
  const roomHeightCm = number(input.roomHeightCm, '방 세로', 100, 10000);
  const passageCm = number(input.passageCm, '필요한 통로 폭', 10, 200);
  const start = point(input.start, '현관');
  const end = point(input.end, '목적지');
  const furniture = input.furniture;
  if (!furniture || typeof furniture !== 'object') throw new ApiError(400, 'INVALID_INPUT', '가구 크기와 전후 위치가 필요합니다.');
  const widthCm = number(furniture.widthCm, '가구 가로', 10, 1000);
  const depthCm = number(furniture.depthCm, '가구 깊이', 10, 1000);
  const beforeCenter = point(furniture.before, '현재 가구 위치');
  const afterCenter = point(furniture.after, '변경 가구 위치');
  const base = walls.slice();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY ||
        x === 0 || y === 0 || x === width - 1 || y === height - 1) base[y * width + x] = 1;
  }
  const dx = roomWidthCm / (bounds.maxX - bounds.minX + 1);
  const dy = roomHeightCm / (bounds.maxY - bounds.minY + 1);
  const beforeBlocked = base.slice(), afterBlocked = base.slice();
  for (const [label, location] of [['현관', start], ['목적지', end]]) {
    const x = Math.min(width - 1, Math.floor(location[0] * width));
    const y = Math.min(height - 1, Math.floor(location[1] * height));
    if (base[y * width + x]) throw new ApiError(422, 'POINT_ON_OBSTACLE', `${label}가 벽 또는 도면 바깥에 있어요. 빈 공간을 찍어 주세요.`);
  }
  const beforeBox = addFurniture(beforeBlocked, width, height, bounds, roomWidthCm, roomHeightCm, { widthCm, depthCm }, beforeCenter);
  const afterBox = addFurniture(afterBlocked, width, height, bounds, roomWidthCm, roomHeightCm, { widthCm, depthCm }, afterCenter);
  const before = runRoute(beforeBlocked, width, height, start, end, dx, dy, passageCm);
  const after = runRoute(afterBlocked, width, height, start, end, dx, dy, passageCm);
  return {
    modelBased: true, routeMethod: '격자 Dijkstra', grid: { width, height },
    bounds: { x: bounds.minX / width, y: bounds.minY / height,
      width: (bounds.maxX - bounds.minX + 1) / width, height: (bounds.maxY - bounds.minY + 1) / height },
    roomWidthCm, roomHeightCm, passageCm, start, end,
    before: { ...before, furnitureBox: beforeBox }, after: { ...after, furnitureBox: afterBox },
    summary: !before.reachable && after.reachable ? '가구를 옮기면 막힌 길이 열려요.'
      : before.reachable && !after.reachable ? '가구를 옮긴 뒤 길이 막혀요.'
      : before.reachable && after.reachable
        ? `이동 거리 ${before.lengthCm}cm → ${after.lengthCm}cm`
        : '두 배치 모두 설정한 통로 폭으로는 지나갈 수 없어요.',
    note: '벽은 U-Net 추론 마스크, 경로는 격자 계산입니다. 오인식과 실제 치수 오차를 확인해 주세요.'
  };
}
