import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './logic.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'); const checkpoint=path.join(root,'ai','checkpoints','child-trajectory-gru.pt'); const script=path.join(root,'ai','trajectory','predict.py'); const python=process.env.PYTHON??(existsSync(path.join(root,'ai','.venv','bin','python'))?path.join(root,'ai','.venv','bin','python'):'python3');
export function predictTrajectory(points){if(!existsSync(checkpoint))throw new ApiError(503,'TRAJECTORY_MODEL_NOT_READY','GRU 동선 모델이 준비되지 않았어요.');if(!Array.isArray(points)||points.length!==10)throw new ApiError(400,'INVALID_TRAJECTORY','최근 위치 10개가 필요합니다.');return new Promise((resolve,reject)=>{const child=spawn(python,[script,'--checkpoint',checkpoint,'--points',JSON.stringify(points)],{cwd:root});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>{if(code)reject(new Error(err||'trajectory inference failed'));else{try{resolve(JSON.parse(out))}catch{reject(new Error('GRU 결과를 읽을 수 없습니다.'))}}})})}
