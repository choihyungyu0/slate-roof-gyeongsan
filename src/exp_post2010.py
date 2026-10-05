"""실험: 2010년 이후 사용승인 주택을 음성 라벨로 쓰면 영상 분류가 좋아지는가, 아니면 "연식 착시"인가.

- 양성: 대장 슬레이트 단독 기재 주택(정규화 기준) / 음성: 사용승인 2010년 이후 주택(석면 슬레이트 사용 금지 이후)
- (가) 영상 모델(efficientnet_b0 특징 + 로지스틱 회귀) 5-fold 교차검증
- (나) 사용승인연도 하나만 쓴 기준선
- (다) 착시 검사: 같은 영상 모델을 "오래됐지만 대장이 슬레이트가 아닌 주택"(1990년 이전, 기와·콘크리트 등)에 적용.
      모델이 슬레이트를 본다면 이들을 슬레이트로 부르지 않아야 한다. 오래된 집을 본다면 슬레이트로 부른다.
지역은 자인면. 지표는 그대로 출력하고 data/processed/exp_post2010.json 에 저장.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import timm
import torch
from PIL import Image

import mlutil
import tiles

ROOT = Path(__file__).resolve().parents[1]
INT, PRO = ROOT / "data" / "interim", ROOT / "data" / "processed"
CROPS = INT / "crops"
SEED, REGION, CAP, MIN_AREA = 42, "자인면", 300, 20.0

t = pd.read_parquet(PRO / "title_joined.parquet")  # roof_class 포함
b = gpd.read_file(INT / "gs_buildings.gpkg")[["gis_bld_id", "PNU", "geometry"]].drop_duplicates("gis_bld_id")
h = gpd.GeoDataFrame(t[t["house"] & t["gis_bld_id"].notna() & (t["emd_nm"] == REGION)].merge(b, on="gis_bld_id", suffixes=("", "_g")), geometry="geometry", crs=5186)
h = h[h.geometry.area >= MIN_AREA]
pos = h[h["roof_class"] == "슬레이트"]
neg = h[(h["year"] >= 2010) & (h["roof_class"] == "비슬레이트")]
old = h[(h["year"] < 1990) & (h["roof_class"] == "비슬레이트")]
print(f"{REGION} 후보 — 양성(슬레이트 단독) {len(pos)}, 음성(2010년 이후) {len(neg)}, 오래된 비슬레이트(1990년 이전) {len(old)}")
n = min(len(pos), len(neg), CAP)
pos, neg = pos.sample(n, random_state=SEED), neg.sample(n, random_state=SEED)
old = old.sample(min(len(old), CAP), random_state=SEED)
print(f"표본 — 양성 {len(pos)}, 음성 {len(neg)}, 착시 검사용 {len(old)}")
print("착시 검사용의 대장 지붕 코드:", old["roofCdNm"].value_counts().to_dict())


def ensure(df) -> pd.DataFrame:
    keep = []
    for i, r in df.iterrows():
        f = CROPS / f"{r['gis_bld_id']}.jpg"
        if not f.exists():
            im = tiles.crop_polygon(r.geometry, z=19, margin_m=2.0, size=224)
            if im is None:
                continue
            im.save(f, quality=92)
        keep.append(i)
    return df.loc[keep]


pos, neg, old = ensure(pos), ensure(neg), ensure(old)
print(f"크롭 확보 — 양성 {len(pos)}, 음성 {len(neg)}, 착시 검사용 {len(old)} | 새로 받은 타일 {tiles.fetched}장")

model = timm.create_model("efficientnet_b0", pretrained=True, num_classes=0).eval()
tf = timm.data.create_transform(**timm.data.resolve_data_config({}, model=model))


def feats(ids) -> np.ndarray:
    out = []
    with torch.no_grad():
        for i in range(0, len(ids), 32):
            out.append(model(torch.stack([tf(Image.open(CROPS / f"{g}.jpg").convert("RGB")) for g in ids[i:i + 32]])).numpy())
    return np.concatenate(out)


ds = pd.concat([pos.assign(y=1), neg.assign(y=0)]).reset_index(drop=True)
X, y, groups = feats(ds["gis_bld_id"].tolist()), ds["y"].to_numpy(), ds["PNU"].to_numpy()
Xold = feats(old["gis_bld_id"].tolist())


def cv(Xm: np.ndarray) -> np.ndarray:
    p = np.zeros(len(y))
    for tr, te in mlutil.stratified_group_kfold(y, groups, k=5, seed=SEED):
        a, c = mlutil.standardize(Xm[tr], Xm[te])
        p[te] = mlutil.fit_predict_logreg(a, y[tr], c, C=0.1)
    return p


def summary(yy, p) -> dict:
    s = mlutil.prf(yy, (p >= 0.5).astype(int))
    return dict(precision=round(s["precision"], 3), recall=round(s["recall"], 3), f1=round(s["f1"], 3), roc_auc=round(mlutil.roc_auc(yy, p), 3),
                tn=s["tn"], fp=s["fp"], fn=s["fn"], tp=s["tp"])


p_img = cv(X)
yr = ds["year"].fillna(ds["year"].median()).to_numpy(float).reshape(-1, 1)
p_year = cv(-yr)  # 오래될수록 양성
res = {"region": REGION, "n_pos": int(y.sum()), "n_neg": int((1 - y).sum()), "n_old_nonslate": int(len(old)),
       "pos_year_unknown": int(ds.loc[ds.y == 1, "year"].isna().sum()),
       "image_model_cv": summary(y, p_img), "year_only_cv": summary(y, p_year)}

a, c = mlutil.standardize(X, Xold)
p_old = mlutil.fit_predict_logreg(a, y, c, C=0.1)
res["old_nonslate_called_slate"] = dict(n=int(len(p_old)), called=int((p_old >= 0.5).sum()), rate=round(float((p_old >= 0.5).mean()), 3),
                                        mean_proba=round(float(p_old.mean()), 3))
res["pos_called_slate_cv"] = dict(n=int(y.sum()), called=int((p_img[y == 1] >= 0.5).sum()), rate=round(float((p_img[y == 1] >= 0.5).mean()), 3))
res["neg_called_slate_cv"] = dict(n=int((1 - y).sum()), called=int((p_img[y == 0] >= 0.5).sum()), rate=round(float((p_img[y == 0] >= 0.5).mean()), 3))
# 슬레이트(양성, 교차검증 확률) vs 오래된 비슬레이트(전체 학습 모델 확률)를 이 모델이 구분하는가
res["auc_slate_vs_old_nonslate"] = round(mlutil.roc_auc(np.r_[np.ones(int(y.sum())), np.zeros(len(p_old))].astype(int), np.r_[p_img[y == 1], p_old]), 3)
res["tiles_fetched"] = tiles.fetched
print(json.dumps(res, ensure_ascii=False, indent=2))
(PRO / "exp_post2010.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
