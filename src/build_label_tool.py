"""1.5단계: 사람 판독 표본 추출 + 판독 도구(서버 없는 HTML) 생성.

- 표본: 자인면·하양읍 × (대장=슬레이트 / 대장=비슬레이트 주택) 4개 층에서 75동씩 무작위 → 300동 (시드 고정)
- 표본 열쇠(대장 라벨 포함)는 data/labels/sample_key.csv 에만 저장. 판독 도구에는 내부 ID(R001…)만 들어감
- 판독용 영상: labeling/img/{ID}.jpg (여백 8m), {ID}_o.jpg (같은 영상 + 대상 건물 외곽선)
- 1단계 모델 확률: data/labels/sample_model_proba.csv (1단계 교차검증에 들어간 건물은 out-of-fold 값,
  나머지는 자인면 982동 전체로 학습한 모델의 예측)

타일이 캐시에 없으면 새로 받는다. 받지 않으려면 환경변수 TILES_OFFLINE=1.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from PIL import ImageDraw

import tiles

ROOT = Path(__file__).resolve().parents[1]
INT, PRO = ROOT / "data" / "interim", ROOT / "data" / "processed"
LAB, TOOL = ROOT / "data" / "labels", ROOT / "labeling"
IMG, CROPS = TOOL / "img", INT / "crops"
for d in (LAB, IMG, CROPS):
    d.mkdir(parents=True, exist_ok=True)

SEED = 20261005
REGIONS = ["자인면", "하양읍"]
PER_STRATUM = 75
MIN_AREA = 20.0
KEY = LAB / "sample_key.csv"

# ---------- 표본 ----------
t = pd.read_parquet(PRO / "title_joined.parquet")
b = gpd.read_file(INT / "gs_buildings.gpkg")[["gis_bld_id", "PNU", "geometry"]].drop_duplicates("gis_bld_id")
h = gpd.GeoDataFrame(t[t["house"] & t["gis_bld_id"].notna()].merge(b, on="gis_bld_id", suffixes=("", "_g")), geometry="geometry", crs=5186)
h = h[(h.geometry.area >= MIN_AREA) & h["emd_nm"].isin(REGIONS)]

if KEY.exists():
    key = pd.read_csv(KEY, dtype=str)
    print(f"기존 표본 목록 사용: {KEY} ({len(key)}동)")
else:
    rng = np.random.default_rng(SEED)
    parts = []
    for region in REGIONS:
        for slate in (True, False):
            pool = h[(h["emd_nm"] == region) & (h["slate"] == slate)].sort_values("gis_bld_id")
            pick = pool.iloc[rng.choice(len(pool), PER_STRATUM, replace=False)]
            print(f"층 {region} / 대장 {'슬레이트' if slate else '비슬레이트'}: 모집단 {len(pool):,} → 표본 {len(pick)}")
            parts.append(pick)
    s = pd.concat(parts).iloc[rng.permutation(PER_STRATUM * 4)].reset_index(drop=True)  # 제시 순서 섞기
    s["id"] = [f"R{i + 1:03d}" for i in range(len(s))]
    s["register_slate"] = s["slate"].astype(int)
    s["year"] = s["year"].astype("Int64")
    key = s[["id", "gis_bld_id", "emd_nm", "register_slate", "slate_code", "slate_text", "roofCdNm", "etcRoof", "year"]].astype(str)
    key.to_csv(KEY, index=False, encoding="utf-8-sig")
    print(f"표본 목록 저장: {KEY} ({len(key)}동, 시드 {SEED})")
geom = h.drop_duplicates("gis_bld_id").set_index("gis_bld_id").geometry

# ---------- 영상 ----------
missing = []
for _, r in key.iterrows():
    g = geom[r["gis_bld_id"]]
    f, fo, fc = IMG / f"{r['id']}.jpg", IMG / f"{r['id']}_o.jpg", CROPS / f"{r['gis_bld_id']}.jpg"
    if not (f.exists() and fo.exists()):
        res = tiles.crop_context(g, z=19, margin_m=8.0, size=448)
        if res is None:
            missing.append(r["id"])
            continue
        im, ring = res
        im.save(f, quality=92)
        ImageDraw.Draw(im).line(ring, fill=(255, 235, 0), width=2)
        im.save(fo, quality=92)
    if not fc.exists():  # 1단계 모델 입력과 같은 규격(여백 2m, 224px)
        c = tiles.crop_polygon(g, z=19, margin_m=2.0, size=224)
        if c is not None:
            c.save(fc, quality=92)
print(f"판독 영상 준비 {len(key) - len(missing)}/{len(key)} | 새로 받은 타일 {tiles.fetched}장" + (f" | 타일 없음 {len(missing)}동" if missing else ""))

# ---------- 판독 도구 ----------
html = (ROOT / "src" / "label_tool_template.html").read_text(encoding="utf-8")
(TOOL / "index.html").write_text(html.replace("/*__IDS__*/[]", json.dumps(key["id"].tolist())), encoding="utf-8")
print("판독 도구:", TOOL / "index.html")
if missing:
    print("※ 영상이 없는 표본이 있어 아직 판독을 시작하면 안 됨. 키 교체 후 다시 실행할 것")
    sys.exit(0)

# ---------- 1단계 모델 확률 ----------
import timm
import torch
from PIL import Image

import mlutil

oof = pd.read_csv(PRO / "classify_oof.csv", dtype={"gis_bld_id": str})
model = timm.create_model("efficientnet_b0", pretrained=True, num_classes=0).eval()
tf = timm.data.create_transform(**timm.data.resolve_data_config({}, model=model))


def feats(ids: list[str]) -> np.ndarray:
    out = []
    with torch.no_grad():
        for i in range(0, len(ids), 32):
            out.append(model(torch.stack([tf(Image.open(CROPS / f"{g}.jpg").convert("RGB")) for g in ids[i:i + 32]])).numpy())
    return np.concatenate(out)


in_cv = key["gis_bld_id"].isin(oof["gis_bld_id"])
new_ids = key.loc[~in_cv, "gis_bld_id"].tolist()
Xtr, Xte = mlutil.standardize(feats(oof["gis_bld_id"].tolist()), feats(new_ids))
p_new = mlutil.fit_predict_logreg(Xtr, oof["y"].to_numpy(), Xte, C=0.1)
proba = key[["id", "gis_bld_id"]].merge(oof[["gis_bld_id", "proba"]], on="gis_bld_id", how="left")
proba.loc[~in_cv.to_numpy(), "proba"] = p_new
proba["source"] = np.where(in_cv, "1단계 교차검증 out-of-fold", "자인면 982동 전체 학습 모델")
proba[["id", "proba", "source"]].to_csv(LAB / "sample_model_proba.csv", index=False, encoding="utf-8-sig")
print("모델 확률 저장:", LAB / "sample_model_proba.csv", proba["source"].value_counts().to_dict())
