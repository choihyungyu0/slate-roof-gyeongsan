"""웹 데모용 데이터 내보내기 → web/public/data/

- buildings.part{i}.json + buildings.manifest.json : 경산시 전체 건물 도형(EPSG:4326), 2만 동씩 나눈 조각. 주소·지번·PNU는 넣지 않는다.
- emd.geojson : 읍·면·동 36곳 경계와 집계
"""
import shutil
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely import set_precision

ROOT = Path(__file__).resolve().parents[1]
INT, PRO, OUT = ROOT / "data" / "interim", ROOT / "data" / "processed", ROOT / "web" / "public" / "data"
OUT.mkdir(parents=True, exist_ok=True)

emd = gpd.read_file(INT / "gs_emd.gpkg")
b = gpd.read_file(INT / "gs_buildings.gpkg").drop_duplicates("gis_bld_id")
b = b[b["bjd_cd"].str[:8].isin(emd["emd_cd"])].copy()
b["emd"] = b["bjd_cd"].str[:8].map(dict(zip(emd["emd_cd"], emd["emd_kor_nm"])))

t = pd.read_parquet(PRO / "title_joined.parquet")
# 인허가 이력(같은 필지의 대수선·철거멸실 기록) — src/permit_check.py 산출
pf = PRO / "permit_flags.parquet"
if pf.exists():
    t = t.merge(pd.read_parquet(pf)[["mgmBldrgstPk", "any", "dem_whole", "dem_roof_asb"]].rename(columns={"any": "pm_any"}), on="mgmBldrgstPk", how="left")
else:
    t = t.assign(pm_any=None, dem_whole=None, dem_roof_asb=None)
t = t[t["gis_bld_id"].notna()].drop_duplicates("gis_bld_id")
b = b.merge(t[["gis_bld_id", "house", "slate", "slate_sure", "roof_class", "slate_code", "slate_text", "pm_any", "dem_whole", "dem_roof_asb", "mainPurpsCdNm", "roofCdNm", "etcRoof", "year", "year_raw", "archArea", "match_how"]],
            on="gis_bld_id", how="left")
# 우선순위 점수(정책 점수) — 위치가 있는 대장 슬레이트 주택에만 있다
ps = pd.read_csv(PRO / "priority_scores.csv", dtype={"gis_bld_id": str})
ps = ps[ps["rank"].notna()].drop_duplicates("gis_bld_id")
PS_N = len(ps)
b = b.merge(ps[["gis_bld_id", "rank", "score", "c_age", "c_area", "c_school", "c_daycare", "c_senior", "c_certainty", "dist_school_m", "dist_daycare_m", "dist_senior_m"]], on="gis_bld_id", how="left")
house, slate = b["house"].fillna(False).astype(bool), b["slate"].fillna(False).astype(bool)
sure = b["slate_sure"].fillna(False).astype(bool)
b["cat"] = np.select([house & sure, house & slate, house], [1, 3, 2], 0)
hgt, flr = b["height"].fillna(0), b["grnd_flr"].fillna(0)
b["h"] = np.where(hgt > 0, hgt, np.where(flr > 0, flr * 3.0, 3.0)).round(1)
b["he"] = (hgt <= 0).astype(int)
b["hsrc"] = np.select([hgt > 0, flr > 0], ["GIS 높이", "층수×3m 추정"], "기본 3m(정보 없음)")

g = b.to_crs(4326)
g["geometry"] = set_precision(g.geometry.values, 1e-6)
g = g[~g.geometry.is_empty]
feats = []
for i, r in enumerate(g.itertuples(), 1):
    p = {"cat": int(r.cat), "h": float(r.h), "he": int(r.he), "hsrc": r.hsrc, "emd": r.emd,
         "reg": 0 if pd.isna(r.match_how) else 1}
    if p["reg"]:
        if not pd.isna(r.rank):
            p.update(ps=float(r.score), pr=int(r.rank), pn=PS_N,
                     ca=round(float(r.c_age), 2), cr=round(float(r.c_area), 2), cs=round(float(r.c_school), 2),
                     cd=round(float(r.c_daycare), 2), ce=round(float(r.c_senior), 2), cc=round(float(r.c_certainty), 2),
                     ds=int(r.dist_school_m), dd=int(r.dist_daycare_m), de=int(r.dist_senior_m))
        if not pd.isna(r.pm_any):  # 슬레이트 주택에만 값이 있다
            p.update(pm=int(bool(r.pm_any)), pw=int(bool(r.dem_whole)), pa=int(bool(r.dem_roof_asb)))
        p.update(use=r.mainPurpsCdNm, roof=r.roofCdNm, etc=r.etcRoof, rc=r.roof_class, how=r.match_how,
                 year=None if pd.isna(r.year) else int(r.year),
                 yflag=int(pd.isna(r.year) and not pd.isna(r.year_raw)),
                 area=None if pd.isna(r.archArea) else round(float(r.archArea), 1),
                 sc=int(bool(r.slate_code)), st=int(bool(r.slate_text)))
    else:
        p.update(use=None if pd.isna(r.purps_nm) else r.purps_nm)
    feats.append({"type": "Feature", "id": i, "properties": p, "geometry": r.geometry.__geo_interface__})
# 건물 단위 자료: 2만 동씩 나눠 public/data 에 둔다 (2026-10-06 사용자 결정으로 접근 키 없이 공개)
(OUT / "buildings.geojson").unlink(missing_ok=True)
for old in OUT.glob("buildings.part*.json"):
    old.unlink()
shutil.rmtree(ROOT / "web" / "private-data", ignore_errors=True)
PART = 20000
sizes = []
for k in range(0, len(feats), PART):
    f = OUT / f"buildings.part{k // PART}.json"
    f.write_text(json.dumps({"type": "FeatureCollection", "features": feats[k:k + PART]}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    sizes.append(round(f.stat().st_size / 1e6, 1))
(OUT / "buildings.manifest.json").write_text(json.dumps({"parts": len(sizes), "features": len(feats)}), encoding="utf-8")

by = pd.read_csv(PRO / "slate_by_dong.csv", dtype={"emd_cd": str})
e = emd.merge(by[["emd_cd", "houses", "slate_sure", "slate_houses", "slate_share_pct"]], on="emd_cd").to_crs(4326)
e["geometry"] = set_precision(e.geometry.simplify(0.0001).values, 1e-6)
e["shown"] = e["emd_kor_nm"].map(g[g["cat"].isin([1, 3])].groupby("emd").size())
e[["emd_cd", "emd_kor_nm", "houses", "slate_sure", "slate_houses", "slate_share_pct", "shown", "geometry"]].to_file(OUT / "emd.geojson", driver="GeoJSON")
# 첫 화면용 요약(검증 결과). 근거는 reports/proposal_numbers.md 와 각 보고서
hs = pd.read_parquet(PRO / "title_joined.parquet")
hs = hs[hs["house"]]
summary = {"houses": int(len(hs)), "code": int((hs["roofCdNm"].fillna("").str.strip() == "슬레이트").sum()),
           "sure": int(hs["slate_sure"].sum()), "max": int(hs["slate"].sum())}
cc = PRO / "llm" / "crosscheck.csv"
if cc.exists():
    c = pd.read_csv(cc)
    summary["llm"] = {"n": int(len(c)), "same4": int(c["same"].sum()), "same2": int((c["rule_sl"] == c["llm_sl"]).sum())}
if pf.exists():
    f = pd.read_parquet(pf)
    summary["permit"] = {"n": int(len(f)), "any": int(f["any"].sum())}
# 확장성 시험 수치는 reports/transfer_test.md 의 표(2026-10-06)를 옮긴 것
summary["transfer"] = [{"name": "영천시", "uniq": 1828, "unmatched": 25, "miss_pct": 26.5, "sure": 4288, "max": 6467},
                       {"name": "청도군", "uniq": 1755, "unmatched": 23, "miss_pct": 0.6, "sure": 8806, "max": 8855}]
(OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False), encoding="utf-8")
print("요약:", summary)
print(f"건물 {len(feats):,}동 → public/data 조각 {len(sizes)}개 (MB: {sizes})")
print("cat:", g["cat"].map({1: "슬레이트 주택(확실)", 3: "혼합 기재 주택", 2: "그 외 주택", 0: "그 밖"}).value_counts().to_dict())
print("우선순위 점수가 붙은 건물:", int(g["rank"].notna().sum()), "/ 순위 대상", PS_N)
print("높이 출처:", g["hsrc"].value_counts().to_dict())
print("슬레이트 주택 높이 출처:", g.loc[g["cat"] == 1, "hsrc"].value_counts().to_dict())
