"""Detect furniture in a room photo with the pretrained YOLO-World model."""
import argparse, json
from pathlib import Path
from ultralytics import YOLO

CLASSES = ["bed", "desk", "cabinet", "sofa", "chair", "table", "wardrobe", "bookshelf"]
MODEL = Path(__file__).resolve().parents[2] / "yolov8s-world.pt"

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("image"); ap.add_argument("--conf", type=float, default=.15); a = ap.parse_args()
    if not MODEL.is_file():
        raise SystemExit(f"YOLO 가중치가 없습니다: {MODEL}")
    model = YOLO(str(MODEL)); model.set_classes(CLASSES); result = model(a.image, conf=a.conf, verbose=False)[0]
    items=[]
    for box in result.boxes:
        cid=int(box.cls[0]); x1,y1,x2,y2=box.xyxy[0].tolist()
        items.append({"type": result.names[cid], "confidence": round(float(box.conf[0]),3), "bbox": {"x":round(x1),"y":round(y1),"width":round(x2-x1),"height":round(y2-y1)}, "needsSizeConfirm": True})
    print(json.dumps({"mode":"pretrained","model":"YOLO-World","imageWidth":int(result.orig_shape[1]),"imageHeight":int(result.orig_shape[0]),"items":items}, ensure_ascii=False))
if __name__ == "__main__": main()
