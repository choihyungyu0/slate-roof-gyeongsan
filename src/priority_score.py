"""우선순위 점수 계산 (정책 점수 — 정답이 있는 예측이 아님). 설계: reports/priority_score.md

대상: 대장 지붕 기재 정규화에서 슬레이트·혼합·코드만 슬레이트인 주택.
항목: 노후도 0.30 · 지붕 면적 0.15 · 학교 거리 0.20 · 어린이집 거리 0.15 · 경로당 거리 0.10 · 기재 확실성 0.10
거리 항목은 data/raw/poi/ 에 표준데이터 CSV가 있을 때만 계산한다(파일명에 '학교' / '어린이집' / '경로당' 포함, 위도·경도 열 필요).
없는 항목은 빼고 나머지 가중치를 합이 1이 되도록 다시 나눈다. 건물 도형과 연결되지 않은 주택은 거리를 계산할 수 없다.

출력: data/processed/priority_scores.csv (건물 내부 ID·읍면동까지만), reports/priority_result.md
"""
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely import STRtree

ROOT = Path(__file__).resolve().parents[1]
INT, PRO, POI = ROOT / "data" / "interim", ROOT / "data" / "processed", ROOT / "data" / "raw" / "poi"
WEIGHTS = {"age": 0.30, "area": 0.15, "school": 0.20, "daycare": 0.15, "senior": 0.10, "certainty": 0.10}
KO = {"age": "노후도", "area": "지붕 면적", "school": "학교 거리", "daycare": "어린이집 거리", "senior": "경로당 거리", "certainty": "기재 확실성"}
POI_KEY = {"school": "학교", "daycare": "어린이집", "senior": "경로당"}
NEAR, FAR, TOP = 100.0, 500.0, 95


def load_poi(key: str) -> gpd.GeoSeries | None:
    files = [f for f in POI.glob("*.csv") if POI_KEY[key] in f.name] if POI.exists() else []
    if not files:
        return None
    for enc in ("utf-8-sig", "cp949"):
        try:
            d = pd.read_csv(files[0], encoding=enc, dtype=str)
            break
        except UnicodeDecodeError:
            continue
    kind = next((c for c in d.columns if "시설유형" in c), None)
    if key == "senior" and kind:  # 마을회관은 빼고 경로당만
        d = d[d[kind].fillna("").str.contains("경로당")]
    lat = next(c for c in d.columns if "위도" in c)
    lon = next(c for c in d.columns if "경도" in c)
    d = d.assign(lat=pd.to_numeric(d[lat], errors="coerce"), lon=pd.to_numeric(d[lon], errors="coerce")).dropna(subset=["lat", "lon"])
    d = d[d["lat"].between(35.6, 36.1) & d["lon"].between(128.6, 129.1)]  # 경산시와 인접 지역
    print(f"{POI_KEY[key]}: {files[0].name} → 경산 일대 {len(d)}곳")
    return gpd.GeoSeries(gpd.points_from_xy(d["lon"], d["lat"]), crs=4326).to_crs(5186)


t = pd.read_parquet(PRO / "title_joined.parquet")
s = t[t["house"] & t["slate"]].copy()
b = gpd.read_file(INT / "gs_buildings.gpkg")[["gis_bld_id", "geometry"]].drop_duplicates("gis_bld_id")
s = s.merge(b.assign(pt=b.geometry.representative_point())[["gis_bld_id", "pt"]], on="gis_bld_id", how="left")

comp = pd.DataFrame(index=s.index)
comp["age"] = np.select([s["year"] < 1970, s["year"] < 1980, s["year"] < 1990, s["year"] < 2000, s["year"] >= 2000], [1.0, 0.8, 0.6, 0.4, 0.1], 0.6)
area = pd.to_numeric(s["archArea"], errors="coerce")
comp["area"] = area.rank(pct=True).fillna(0.5)
comp["certainty"] = s["roof_class"].map({"슬레이트": 1.0, "혼합": 0.6, "코드만 슬레이트": 0.3})
has_pt = s["pt"].notna().to_numpy()
dist = {}
for key in POI_KEY:
    pts = load_poi(key)
    if pts is None:
        continue
    tree = STRtree(pts.values)
    d = np.full(len(s), np.nan)
    _, dd = tree.query_nearest(s.loc[has_pt, "pt"].values, return_distance=True, all_matches=False)
    d[has_pt] = dd
    dist[key] = d
    comp[key] = np.clip((FAR - d) / (FAR - NEAR), 0, 1)

used = [k for k in WEIGHTS if k in comp.columns]
missing = [k for k in WEIGHTS if k not in comp.columns]


def score(weights: dict) -> pd.Series:
    """건물마다 값이 있는 항목만으로 가중 평균(없는 항목의 가중치는 나머지에 비례 배분)."""
    w = pd.Series({k: weights[k] for k in used})
    ok = comp[used].notna()
    return (comp[used].fillna(0) * w).sum(axis=1) / (ok * w).sum(axis=1) * 100


s["score"] = score(WEIGHTS).round(1)
# 위치가 없는 주택은 거리 항목이 빠져 점수가 높게 나오므로(거리 점수는 대부분 0에 가깝다) 같은 순위표에 넣지 않는다
s["located"] = has_pt
s["rank"] = s.loc[s["located"], "score"].rank(ascending=False, method="first")
s["rank"] = s["rank"].astype("Int64")
out = s[["rank", "score", "located", "gis_bld_id", "emd_nm", "roof_class", "year", "archArea", "match_how"]].copy()
for k in used:
    out[f"c_{k}"] = comp[k].round(3).to_numpy()
for k, d in dist.items():
    out[f"dist_{k}_m"] = np.round(d, 0)
out.sort_values(["rank", "score"], ascending=[True, False], na_position="last").to_csv(PRO / "priority_scores.csv", index=False, encoding="utf-8-sig")

loc = s[s["located"]]
top = loc[loc["rank"] <= TOP]
L = ["# 우선순위 점수 계산 결과", "",
     "정책 점수다. 정답이 없으므로 정확도는 없고, 항목·가중치를 바꾸면 순위가 바뀐다. 설계와 가중치 근거는 `reports/priority_score.md`.", "",
     f"- 대상: 대장 슬레이트 주택(최대 기준) {len(s):,}동. 그중 건물 도형과 연결돼 위치가 있는 것 {int(has_pt.sum()):,}동",
     "- 반영한 항목: " + ", ".join(f"{KO[k]}({WEIGHTS[k]:.2f})" for k in used),
     "- **반영하지 못한 항목**: " + (", ".join(f"{KO[k]}({WEIGHTS[k]:.2f})" for k in missing) + " — 위치 자료 미확보. 가중치는 나머지 항목에 비례 배분함" if missing else "없음"),
     f"- **순위는 위치가 있는 {len(loc):,}동 안에서만 매겼다.** 위치가 없는 {int((~s['located']).sum()):,}동은 거리 항목을 계산할 수 없어 순위에서 빼고 별도 목록(rank 빈칸)으로 둔다. 이들을 같은 표에 넣으면 거리 항목이 빠진 만큼 점수가 높게 나와 상위를 차지하게 된다",
     f"- 점수 분포(위치 있는 주택): 최소 {loc['score'].min():.1f} · 중앙값 {loc['score'].median():.1f} · 최대 {loc['score'].max():.1f}. 상위 {TOP}동의 최저 점수 {top['score'].min():.1f}",
     f"- 동점: 상위 {TOP}동 경계 점수({top['score'].min():.1f})와 같은 점수인 주택이 {int((loc['score'] == top['score'].min()).sum())}동 있어, 경계 부근 순위는 임의(자료 순서)로 갈린다", "",
     f"## 상위 {TOP}동의 구성 (2026년 지원 물량 95동에 맞춘 예시)", "",
     "| 읍면동 | 상위 95동 중 | 위치 있는 대상 주택 수 |", "|---|---|---|"]
te, ae = top["emd_nm"].value_counts(), loc["emd_nm"].value_counts()
L += [f"| {k} | {v} | {int(ae[k]):,} |" for k, v in te.items()]
L += ["", "| 기재 분류 | 상위 95동 중 | 대상 주택 수 |", "|---|---|---|"]
L += [f"| {k} | {int((top['roof_class'] == k).sum())} | {int(v):,} |" for k, v in loc["roof_class"].value_counts().items()]
dec = lambda d: (d["year"] // 10 * 10).astype("Int64").astype(str).replace("<NA>", "연도 불명")
L += ["", "| 사용승인 연대 | 상위 95동 중 |", "|---|---|"] + [f"| {k} | {v} |" for k, v in dec(top).value_counts().sort_index().items()]

L += ["", "## 민감도 — 가중치를 바꾸면 상위 95동이 얼마나 바뀌나", "",
      "한 항목의 가중치를 ±0.10 바꾸고(나머지는 그대로, 합으로 나눠 정규화) 다시 뽑은 상위 95동이 기본값의 상위 95동과 겹치는 수.", "",
      "| 항목 | +0.10 | −0.10 |", "|---|---|---|"]
base = set(top.index)
for k in used:
    row = []
    for delta in (0.10, -0.10):
        w = dict(WEIGHTS)
        w[k] = max(0.0, w[k] + delta)
        sc = score(w)[s["located"]]
        row.append(len(base & set(sc.rank(ascending=False, method="first").loc[lambda r: r <= TOP].index)))
    L.append(f"| {KO[k]} | {row[0]} / {TOP} | {row[1]} / {TOP} |")
L += ["", "## 한계", "",
      "- 가중치와 구간 경계는 임의로 정한 기본값이다. 담당 부서의 판단으로 바꿔야 한다.",
      "- 거리 항목이 빠진 상태에서는 사실상 '오래되고 넓고 기재가 분명한 집' 순서일 뿐이다." if missing else "- 거리는 건물 대표점에서 시설 좌표까지의 직선거리다.",
      "- 연도 불명 주택은 노후도를 중간값(0.6)으로 두었다. 건축면적은 지붕 면적의 근사다.",
      "- 대장 기재 기준이며 실제 지붕 상태·거주 여부는 반영되지 않았다.", ""]
(ROOT / "reports" / "priority_result.md").write_text("\n".join(L), encoding="utf-8")
print("\n".join(L[4:9]))
print("상위 95 읍면동:", te.head(8).to_dict())
print("민감도:", L[L.index("| 항목 | +0.10 | −0.10 |") + 2:L.index("## 한계") - 1])
