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

def windows(points, seq_len):
    lo,hi=points.min(0),points.max(0); span=np.maximum(hi-lo,1e-6); p=(points-lo)/span
    result=[]
    for i in range(len(p)-seq_len): result.append((p[i:i+seq_len], direction(p[i+seq_len-1],p[i+seq_len])))
    return result

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--data-dir',type=Path,required=True); ap.add_argument('--output',type=Path,required=True); ap.add_argument('--seq-len',type=int,default=10); ap.add_argument('--max-windows',type=int,default=20000)
    a=ap.parse_args(); X=[]; y=[]; manifest=[]
    for f in sorted(a.data_dir.glob('*.tsv')):
        pts,xc,yc=read_points(f); w=windows(pts,a.seq_len)[:a.max_windows]; X.extend(x for x,_ in w); y.extend(t for _,t in w); manifest.append({'file':f.name,'rows':len(pts),'windows':len(w),'x':xc,'y':yc})
    if not X: raise SystemExit('No usable windows')
    rng=np.random.default_rng(42); idx=rng.permutation(len(X)); X=np.asarray(X)[idx]; y=np.asarray(y)[idx]; n=len(X); a1=int(n*.7); a2=int(n*.85)
    a.output.parent.mkdir(parents=True,exist_ok=True); np.savez_compressed(a.output,X_train=X[:a1],y_train=y[:a1],X_val=X[a1:a2],y_val=y[a1:a2],X_test=X[a2:],y_test=y[a2:])
    a.output.with_suffix('.json').write_text(json.dumps({'files':manifest,'seq_len':a.seq_len,'features':['x','y'],'classes':DIRS,'seed':42},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'output':str(a.output),'samples':n,'train':a1,'val':a2-a1,'test':n-a2,'files':manifest},ensure_ascii=False))
if __name__=='__main__': main()
