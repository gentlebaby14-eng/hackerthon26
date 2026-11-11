import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './logic.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'ai', 'furniture', 'detect_pretrained.py');
const winPython = path.join(root, 'ai', '.venv', 'Scripts', 'python.exe');
const unixPython = path.join(root, 'ai', '.venv', 'bin', 'python');
const python = process.env.PYTHON ?? (existsSync(winPython) ? winPython : existsSync(unixPython) ? unixPython : process.platform === 'win32' ? 'python' : 'python3');
const model = path.join(root, 'yolov8s-world.pt');

export function furnitureStatus() {
  return { ready: existsSync(model), model: 'YOLO-World', weights: 'yolov8s-world.pt',
    message: existsSync(model) ? '가중치가 준비됐어요. Python 패키지는 사진 분석 시 확인합니다.' : 'YOLO 가중치가 없습니다. 저장소를 다시 내려받아 주세요.' };
}

export async function detectFurniture(image) {
  if (!existsSync(model)) throw new ApiError(503, 'FURNITURE_MODEL_NOT_READY', furnitureStatus().message);
  if (typeof image !== 'string') throw new ApiError(400, 'INVALID_IMAGE', '가구 사진을 올려 주세요.');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!match) throw new ApiError(400, 'INVALID_IMAGE', 'PNG/JPEG/WebP 사진만 올려 주세요.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 100 || bytes.length > 8_000_000) throw new ApiError(400, 'INVALID_IMAGE', '사진은 8MB 이하로 올려 주세요.');
  const folder = await mkdtemp(path.join(tmpdir(), 'roommate-furniture-')); const file = path.join(folder, `photo.${match[1] === 'jpeg' ? 'jpg' : match[1]}`);
  try {
    await writeFile(file, bytes);
    const output = await new Promise((resolve, reject) => {
      const child = spawn(python, [script, file], { cwd: root, windowsHide: true }); let out=''; let err='';
      const timer=setTimeout(()=>child.kill(),120000); child.stdout.on('data',c=>out+=c); child.stderr.on('data',c=>err+=c.toString().slice(-3000));
      child.on('error',reject); child.on('close',code=>{clearTimeout(timer); if(code) reject(new Error(err || `detector exited ${code}`)); else {try{resolve(JSON.parse(out))}catch{reject(new Error('가구 인식 결과를 읽을 수 없습니다.'))}}});
    });
    return {...output, autoPlace: true, note: '사진 속 좌표를 반환했습니다. 방문 방향으로 추정한 위치와 실제 치수를 확인해 주세요.'};
  } catch (error) { throw new ApiError(502, 'FURNITURE_INFERENCE_FAILED', `가구 인식에 실패했어요: ${error.message}. 저장소 루트에서 Python 환경을 만들고 pip install -r ai/requirements.txt를 실행해 주세요.`); }
  finally { await rm(folder,{recursive:true,force:true}); }
}
