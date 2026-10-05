"""E. 소규모 분류 시험 (읍면 1곳).

- 라벨(약한 라벨): 대장 지붕=슬레이트 → 1, 같은 읍면의 다른 주택 → 0. 클래스 균형(음성은 양성 수만큼 무작위 표본)
- 지붕 크롭: 브이월드 항공영상 z19, 폴리곤 외접 정사각 + 여백 2m → 224px
- timm 사전학습 efficientnet_b0 특징(1280차원) + 로지스틱 회귀, 필지 단위로 묶은 5-fold 교차검증
  (sklearn DLL이 이 PC에서 차단되어 mlutil.py 의 동일 목적함수 구현을 사용)
- 지표는 교차검증 out-of-fold 예측으로만 계산
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import timm
import torch
from PIL import Image
from tqdm import tqdm

import mlutil
import tiles

ROOT = Path(__file__).resolve().parents[1]
INT, PRO, FIG = ROOT / "data" / "interim", ROOT / "data" / "processed", ROOT / "outputs" / "figs"
CROPS = INT / "crops"
CROPS.mkdir(parents=True, exist_ok=True)
FIG.mkdir(parents=True, exist_ok=True)
plt.rcParams["font.family"] = "Malgun Gothic"

SEED = 42
PREFER = "자인면"
MIN_POS = 100       # 자인면 양성이 이보다 적으면 양성이 가장 많은 읍면으로 변경
MAX_PER_CLASS = 500  # 타일 대량 수집을 피하기 위한 상한
MIN_AREA = 20.0     # ㎡. 이보다 작은 폴리곤은 z19(약 0.24m/px)에서 식별이 어려워 제외
MODEL = "efficientnet_b0"

t = pd.read_parquet(PRO / "title_joined.parquet")
b = gpd.read_file(INT / "gs_buildings.gpkg")[["gis_bld_id", "PNU", "geometry"]].drop_duplicates("gis_bld_id")
h = t[t["house"] & t["gis_bld_id"].notna()].merge(b, on="gis_bld_id", suffixes=("", "_g"))
h = gpd.GeoDataFrame(h, geometry="geometry", crs=5186)
h = h[h.geometry.area >= MIN_AREA]

cnt = h[h["slate"]].groupby("emd_nm").size().sort_values(ascending=False)
is_eupmyeon = cnt.index.str.endswith(("읍", "면"))
region = PREFER if cnt.get(PREFER, 0) >= MIN_POS else cnt[is_eupmyeon].index[0]
print("읍면별 매칭된 슬레이트 주택(양성 후보):", cnt[is_eupmyeon].to_dict())
print("시험 지역:", region)

r = h[h["emd_nm"] == region]
pos, neg = r[r["slate"]], r[~r["slate"]]
n = min(len(pos), len(neg), MAX_PER_CLASS)
pos = pos.sample(n, random_state=SEED)
neg = neg.sample(n, random_state=SEED)
ds = pd.concat([pos.assign(y=1), neg.assign(y=0)]).reset_index(drop=True)
print(f"지역 내 주택 {len(r):,} (슬레이트 {int(r['slate'].sum()):,}, 그 외 {int((~r['slate']).sum()):,}) → 표본 양성 {n}, 음성 {n}")
print("음성 표본의 대장 지붕:", neg["roofCdNm"].value_counts().to_dict())

# --- 크롭 ---
ok = []
for i, row in tqdm(ds.iterrows(), total=len(ds), desc="크롭", file=sys.stdout, mininterval=20):
    f = CROPS / f"{row['gis_bld_id']}.jpg"
    if not f.exists():
        im = tiles.crop_polygon(row.geometry, z=19, margin_m=2.0, size=224)
        if im is None:
            continue
        im.save(f, quality=92)
    ok.append(i)
print(f"크롭 성공 {len(ok)}/{len(ds)} | 이번 실행에서 새로 받은 타일 {tiles.fetched}장")
ds = ds.loc[ok].reset_index(drop=True)

# --- 특징 추출 ---
torch.manual_seed(SEED)
model = timm.create_model(MODEL, pretrained=True, num_classes=0).eval()
cfg = timm.data.resolve_data_config({}, model=model)
tf = timm.data.create_transform(**cfg)
feats = []
with torch.no_grad():
    for s in tqdm(range(0, len(ds), 32), desc="특징", file=sys.stdout, mininterval=20):
        x = torch.stack([tf(Image.open(CROPS / f"{g}.jpg").convert("RGB")) for g in ds["gis_bld_id"].iloc[s:s + 32]])
        feats.append(model(x).numpy())
X, y, groups = np.concatenate(feats), ds["y"].to_numpy(), ds["PNU"].to_numpy()
print("특징 행렬:", X.shape, "| 전처리 입력 크기:", cfg["input_size"])

# --- 5-fold 교차검증 (같은 필지의 건물은 같은 fold) ---
proba = np.zeros(len(y))
fold_f1, fold_sizes = [], []
for tr, te in mlutil.stratified_group_kfold(y, groups, k=5, seed=SEED):
    assert not set(groups[tr]) & set(groups[te])
    Xtr, Xte = mlutil.standardize(X[tr], X[te])
    proba[te] = mlutil.fit_predict_logreg(Xtr, y[tr], Xte, C=0.1)
    fold_f1.append(mlutil.prf(y[te], (proba[te] >= 0.5).astype(int))["f1"])
    fold_sizes.append((int(len(te)), int(y[te].sum())))
pred = (proba >= 0.5).astype(int)
s_ = mlutil.prf(y, pred)
m = dict(region=region, model=MODEL, n=int(len(y)), n_pos=int(y.sum()), n_neg=int((1 - y).sum()),
         precision=round(s_["precision"], 4), recall=round(s_["recall"], 4), f1=round(s_["f1"], 4),
         roc_auc=round(mlutil.roc_auc(y, proba), 4), accuracy=round(float((pred == y).mean()), 4),
         confusion_matrix=dict(tn=s_["tn"], fp=s_["fp"], fn=s_["fn"], tp=s_["tp"]),
         fold_f1=[round(float(v), 4) for v in fold_f1], fold_f1_mean=round(float(np.mean(fold_f1)), 4),
         fold_f1_std=round(float(np.std(fold_f1)), 4), fold_sizes_n_pos=fold_sizes, threshold=0.5,
         tiles_fetched_this_run=tiles.fetched, region_houses=int(len(r)), region_slate=int(r["slate"].sum()),
         crop="z19, 여백 2m, 224px", cv="층화·그룹 5-fold (그룹=필지 PNU)",
         classifier="표준화 + L2 로지스틱 회귀(C=0.1, L-BFGS; sklearn과 동일 목적함수의 자체 구현)")
print(json.dumps(m, ensure_ascii=False, indent=2))
(PRO / "classify_metrics.json").write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
ds["proba"] = proba
ds[["gis_bld_id", "y", "proba", "roofCdNm", "etcRoof", "year", "archArea"]].to_csv(PRO / "classify_oof.csv", index=False, encoding="utf-8-sig")


def grid(sub: pd.DataFrame, title: str, name: str) -> None:
    fig, axes = plt.subplots(4, 5, figsize=(12.5, 11), dpi=150)
    for ax in axes.ravel():
        ax.set_axis_off()
    for ax, (_, row) in zip(axes.ravel(), sub.iterrows()):
        ax.imshow(Image.open(CROPS / f"{row['gis_bld_id']}.jpg"))
        yr = "미확인" if pd.isna(row["year"]) else str(int(row["year"]))
        roof = (row["etcRoof"] or row["roofCdNm"] or "(빈값)")[:14]
        ax.set_title(f"모델 p={row['proba']:.2f}\n대장: {roof} · {yr}", fontsize=8.5)
    fig.suptitle(title, fontsize=13, fontweight="bold")
    fig.text(0.5, 0.01, f"{region} · 교차검증 out-of-fold 확률 · 항공영상: 브이월드(국토교통부) · 대장 라벨은 약한 라벨(현장 미검증)",
             ha="center", fontsize=8, color="#333")
    fig.tight_layout(rect=(0, 0.02, 1, 0.96))
    fig.savefig(FIG / name, facecolor="w")
    plt.close(fig)


grid(ds[ds["y"] == 1].nsmallest(20, "proba"), "대장=슬레이트인데 모델=아님 (모델 확률 하위 20)", "disagree_register_slate_model_not.png")
grid(ds[ds["y"] == 0].nlargest(20, "proba"), "대장=슬레이트 아님인데 모델=슬레이트 (모델 확률 상위 20)", "disagree_register_not_model_slate.png")
grid(ds[ds["y"] == 1].nlargest(20, "proba"), "참고: 대장=슬레이트이고 모델도 슬레이트 (확률 상위 20)", "agree_slate_top20.png")
print("저장:", *(p.name for p in sorted(FIG.iterdir())))
