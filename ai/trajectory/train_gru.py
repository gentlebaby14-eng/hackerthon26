from __future__ import annotations
import argparse
from pathlib import Path
import numpy as np, torch
from torch import nn

class TrajectoryGRU(nn.Module):
    def __init__(self, hidden=64):
        super().__init__(); self.gru=nn.GRU(2,hidden,1,batch_first=True); self.head=nn.Linear(hidden,9)
    def forward(self,x): return self.head(self.gru(x)[0][:,-1])

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--data',type=Path,required=True); ap.add_argument('--out',type=Path,required=True); ap.add_argument('--epochs',type=int,default=2); ap.add_argument('--batch-size',type=int,default=256); a=ap.parse_args()
    d=np.load(a.data); device='cuda' if torch.cuda.is_available() else 'cpu'; model=TrajectoryGRU().to(device); opt=torch.optim.Adam(model.parameters(),1e-3); lossfn=nn.CrossEntropyLoss(); X=torch.tensor(d['X_train'],dtype=torch.float32); y=torch.tensor(d['y_train'],dtype=torch.long); vx=torch.tensor(d['X_val'],dtype=torch.float32).to(device); vy=torch.tensor(d['y_val'],dtype=torch.long).to(device); best=1e9; a.out.parent.mkdir(parents=True,exist_ok=True)
    for ep in range(1,a.epochs+1):
        model.train(); total=0
        for ix in torch.randperm(len(X)).split(a.batch_size):
            loss=lossfn(model(X[ix].to(device)),y[ix].to(device)); opt.zero_grad(); loss.backward(); opt.step(); total+=loss.item()*len(ix)
        model.eval();
        with torch.no_grad(): vl=lossfn(model(vx),vy).item(); acc=(model(vx).argmax(1)==vy).float().mean().item()
        print(f'epoch={ep} train_loss={total/len(X):.4f} val_loss={vl:.4f} val_acc={acc:.4f}')
        if vl<best: best=vl; torch.save({'model':model.state_dict(),'input_size':2,'classes':9,'sequence_length':int(d['X_train'].shape[1]),'feature_note':'THOR adult baseline; child traits are not inferred'},a.out)
    print(f'saved {a.out} device={device}')
if __name__=='__main__': main()
