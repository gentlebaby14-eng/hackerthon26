"""Convert THOR TSV trajectories into GRU-ready windows."""
from __future__ import annotations
import argparse, json, math, re
from pathlib import Path
import numpy as np

DIRS = [(0,0),(0,-1),(1,-1),(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1)]

def read_points(path: Path):
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    i = next((i for i, line in enumerate(lines) if line.startswith("Frame\t") or line.startswith("Frame,")), None)
    if i is None: raise ValueError(f"Frame header not found: {path}")
    sep = "\t" if "\t" in lines[i] else ","; header = [h for h in lines[i].split(sep) if h]
    xs = [k for k in header if re.search(r"(^| )X$", k)]; ys = [k for k in header if re.search(r"(^| )Y$", k)]
    # Prefer a populated rigid-body pair; some exports leave Helmet markers at 0.
    pairs = [(x, next((k for k in ys if k.rsplit(' ',1)[0] == x.rsplit(' ',1)[0]), ys[0])) for x in xs]
    x, y = pairs[0]
    for cx, cy in pairs:
        try:
            vals = [float(line.split(sep)[header.index(cx)]) for line in lines[i+1:i+1001]]
            if any(abs(v) > 1e-6 for v in vals): x, y = cx, cy; break
        except (ValueError, IndexError): pass
    out=[]
    for line in lines[i+1:]:
        vals=line.split(sep)
        if len(vals) < len(header): continue
        try: out.append((float(vals[header.index(x)]), float(vals[header.index(y)])))
        except ValueError: pass
    if not out: raise ValueError(f"No numeric coordinates found in {path}")
    return np.asarray(out, dtype=np.float32), x, y

def direction(a,b):
    dx,dy=float(b[0]-a[0]),float(b[1]-a[1])
    if math.hypot(dx,dy) < 1e-5: return 0
    s=(1 if dx>0 else -1 if dx<0 else 0, 1 if dy>0 else -1 if dy<0 else 0)
    return DIRS.index(s)

def windows(points, seq_len, max_windows):
    valid=np.linalg.norm(points,axis=1)>1e-3
    if not np.any(valid): return []
    result=[]
    count=max(0,len(points)-seq_len)
    for i in np.unique(np.linspace(0,count-1,min(count,max_windows),dtype=np.int64)) if count else []:
        if not np.all(valid[i:i+seq_len+1]): continue
        if np.linalg.norm(points[i+seq_len]-points[i+seq_len-1])>500: continue
        history=points[i:i+seq_len]
        if np.linalg.norm(history[-1]-history[0])<10: continue
        lo,hi=history.min(0),history.max(0)
        normalized=(history-lo)/np.maximum(hi-lo,1e-6)
        result.append((normalized,direction(history[-1],points[i+seq_len])))
    return result

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--data-dir',type=Path,required=True); ap.add_argument('--output',type=Path,required=True); ap.add_argument('--seq-len',type=int,default=10); ap.add_argument('--max-windows',type=int,default=20000)
    a=ap.parse_args(); datasets=[]; manifest=[]
    for f in sorted(a.data_dir.glob('*.tsv')):
        pts,xc,yc=read_points(f); w=windows(pts,a.seq_len,a.max_windows)
        if not w: continue
        datasets.append((np.asarray([x for x,_ in w],dtype=np.float32),np.asarray([t for _,t in w],dtype=np.int64)))
        manifest.append({'file':f.name,'rows':len(pts),'windows':len(w),'x':xc,'y':yc})
    if not datasets: raise SystemExit('No usable windows')
    if len(datasets)>=3:
        X_train=np.concatenate([p[0] for p in datasets[:-2]]); y_train=np.concatenate([p[1] for p in datasets[:-2]])
        X_val,y_val=datasets[-2]; X_test,y_test=datasets[-1]
        split='recording holdout'
    else:
        X=np.concatenate([p[0] for p in datasets]); y=np.concatenate([p[1] for p in datasets]); idx=np.random.default_rng(42).permutation(len(X)); X=X[idx]; y=y[idx]; a1=int(len(X)*.7); a2=int(len(X)*.85)
        X_train,y_train=X[:a1],y[:a1]; X_val,y_val=X[a1:a2],y[a1:a2]; X_test,y_test=X[a2:],y[a2:]; split='window random (overlap leakage possible)'
    a.output.parent.mkdir(parents=True,exist_ok=True); np.savez_compressed(a.output,X_train=X_train,y_train=y_train,X_val=X_val,y_val=y_val,X_test=X_test,y_test=y_test)
    a.output.with_suffix('.json').write_text(json.dumps({'files':manifest,'seq_len':a.seq_len,'features':['x','y'],'classes':DIRS,'seed':42,'split':split},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(a.output),'samples':sum(len(p[0]) for p in datasets),'train':len(X_train),'val':len(X_val),'test':len(X_test),'split':split,'files':manifest},ensure_ascii=False))
if __name__=='__main__': main()
