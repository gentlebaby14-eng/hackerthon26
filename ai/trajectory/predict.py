import argparse, json
import numpy as np, torch
from train_gru import TrajectoryGRU

DIRS=['정지','위','오른쪽 위','오른쪽','오른쪽 아래','아래','왼쪽 아래','왼쪽','왼쪽 위']
ap=argparse.ArgumentParser(); ap.add_argument('--checkpoint',required=True); ap.add_argument('--points',required=True); a=ap.parse_args()
raw=json.loads(a.points); pts=np.asarray(raw,dtype=np.float32)
if pts.shape != (10,2): raise SystemExit('points must contain 10 [x,y] pairs')
lo,hi=pts.min(0),pts.max(0); pts=(pts-lo)/np.maximum(hi-lo,1e-6)
m=TrajectoryGRU(); m.load_state_dict(torch.load(a.checkpoint,map_location='cpu')['model']); m.eval()
with torch.no_grad(): idx=int(m(torch.tensor(pts[None],dtype=torch.float32)).argmax(1).item())
print(json.dumps({'direction':idx,'label':DIRS[idx],'model':'child-trajectory-gru.pt'},ensure_ascii=False))
