import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './logic.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkpoint = path.resolve(process.env.STRUCTURE_MODEL_CHECKPOINT ?? path.join(root, 'ai', 'checkpoints', 'walls-doors-windows.pt'));
const script = path.join(root, 'ai', 'infer_structures.py');
const projectPython = path.join(root, 'ai', '.venv', 'bin', 'python');
const modelCardPath = checkpoint.replace(/\.pt$/, '.json');
const evaluationPath = path.join(root, 'ai', 'checkpoints', 'walls-doors-windows-evaluation.json');

function readJsonFile(filename) {
  try { return JSON.parse(readFileSync(filename, 'utf8')); } catch { return null; }
}

export function modelStatus() {
  const modelCard = readJsonFile(modelCardPath);
  const compatible = modelCard?.classes?.join(',') === 'background,wall,door,window' && modelCard?.out_channels === 4;
  const ready = existsSync(checkpoint) && compatible;
  return { ready, model: 'U-Net multi-class segmentation', classes: ['background', 'wall', 'door', 'window'],
    modelCard, evaluation: readJsonFile(evaluationPath),
    message: ready ? '벽·문·창문 인식 모델을 사용할 수 있어요.'
      : '세 종류 인식 모델이 준비되지 않았어요. 기존 벽 전용 가중치는 사용할 수 없습니다.' };
}

export async function analyzeFloorplan(imageDataUrl) {
  if (!modelStatus().ready) throw new ApiError(503, 'MODEL_NOT_READY', modelStatus().message);
  if (typeof imageDataUrl !== 'string') throw new ApiError(400, 'INVALID_IMAGE', '도면 이미지를 올려 주세요.');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
  if (!match || match[2].length > 12_000_000) throw new ApiError(400, 'INVALID_IMAGE', 'PNG/JPEG/WebP 이미지는 8MB 이하로 올려 주세요.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > 8_000_000 || bytes.length < 100) throw new ApiError(400, 'INVALID_IMAGE', '이미지 크기를 확인해 주세요.');
  const folder = await mkdtemp(path.join(tmpdir(), 'roommate-floorplan-'));
  const imagePath = path.join(folder, `floorplan.${match[1] === 'jpeg' ? 'jpg' : match[1]}`);
  try {
    await writeFile(imagePath, bytes);
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.env.PYTHON ?? (existsSync(projectPython) ? projectPython : 'python3'), [script, '--image', imagePath, '--checkpoint', checkpoint],
        { cwd: root, windowsHide: true });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill(), 120_000);
      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString().slice(0, 4000); });
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(stderr.slice(-700) || `inference exited ${code}`));
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('추론 결과를 읽을 수 없습니다.')); }
      });
    });
    const mask = result.labels.map(row => [...row].map(value => value === '1' || value === '3' ? '1' : '0').join(''));
    return { ...result, mask, modelBased: true,
      note: 'U-Net이 벽·문·창문을 각각 예측했습니다. 문은 개구부, 벽과 창문은 통행 불가로 계산합니다.' };
  } catch (error) {
    throw new ApiError(502, 'INFERENCE_FAILED', `벽·문·창문 추론에 실패했어요: ${error.message}`);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
