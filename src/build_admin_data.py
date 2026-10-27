"""행정 화면용 보조 자료 만들기 (점수·순위·가중치는 건드리지 않는다).

입력: data/processed/priority_scores.csv, title_joined.parquet, elderly_by_admdong.csv, data/interim/gs_buildings.gpkg,
      data/raw/sgis/bnd_dong_00_2025_2Q.shp(통계청 SGIS 행정동 경계), rules/roof_rules.csv, roof_strings_all.csv
출력:
  web/public/data/admin_extra.json   건물 ID별 대장 PK·법정리·행정동·70세 이상 비율 (지번 없음, 공개 배포됨)
  web/public/data/rules.json         규칙 23개와 표기 예시 (엑셀 '판정 근거' 시트)
  web/public/data/join_stats.json    결합 데이터 표
  outputs/private/jibun_경산시.csv    건물 ID·대장 PK·지번 (행정망 내부용, Git·배포 제외)
건물 ID는 웹 지도 자료의 일련번호(B + 6자리)이며 export_web.py 와 같은 순서로 만든다.
"""
import json
from pathlib import Path

import geopandas as gpd
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PRO, INT, WEB = ROOT / "data" / "processed", ROOT / "data" / "interim", ROOT / "web" / "public" / "data"
PRIV = ROOT / "outputs" / "private"
PRIV.mkdir(parents=True, exist_ok=True)

# 웹 지도 자료에서 건물 ID ↔ gis_bld_id 대응을 다시 만든다(export_web.py 와 같은 순서)
feats = []
for k in range(json.loads((WEB / "buildings.manifest.json").read_text(encoding="utf-8"))["parts"]):
    feats += json.loads((WEB / f"buildings.part{k}.json").read_text(encoding="utf-8"))["features"]
scored = [(f["id"], f["properties"]) for f in feats if f["properties"].get("ps") is not None]
print("점수 있는 건물:", len(scored))

ps = pd.read_csv(PRO / "priority_scores.csv", dtype={"gis_bld_id": str})
ps = ps[ps["located"]].copy()
ps["rank"] = ps["rank"].astype(int)
by_rank = ps.set_index("rank")
t = pd.read_parquet(PRO / "title_joined.parquet")
t = t[t["gis_bld_id"].notna()].drop_duplicates("gis_bld_id").set_index("gis_bld_id")
b = gpd.read_file(INT / "gs_buildings.gpkg").drop_duplicates("gis_bld_id").set_index("gis_bld_id")

rows = []
for fid, p in scored:
    g = by_rank.loc[int(p["pr"])]
    assert abs(float(g["score"]) - float(p["ps"])) < 1e-6, (fid, p["pr"])  # 순위로 같은 건물임을 확인
    gid = g["gis_bld_id"]
    rec = t.loc[gid] if gid in t.index else None
    bjd = b.loc[gid, "bjd_nm"] if gid in b.index else None
    rows.append({"bid": f"B{fid:06d}", "gid": gid, "pk": None if rec is None else str(rec["mgmBldrgstPk"]),
                 "jibun": None if rec is None else str(rec["platPlc"]), "ri": None if bjd is None else str(bjd).split()[-1],
                 "emd": p["emd"]})
d = pd.DataFrame(rows)

# 행정동: 건물 대표점 → 통계청 SGIS 행정동 경계(2025.6.30 기준)
pts = b.loc[d["gid"]].geometry.representative_point().to_crs(5179)
adm = gpd.read_file(ROOT / "data" / "raw" / "sgis" / "bnd_dong_00_2025_2Q.shp")
adm = adm[adm.intersects(pts.union_all().envelope)]
j = gpd.sjoin(gpd.GeoDataFrame({"i": range(len(d))}, geometry=pts.values, crs=5179), adm[["ADM_NM", "geometry"]], how="left", predicate="within")
d["admd"] = j.sort_values("i").drop_duplicates("i")["ADM_NM"].to_numpy()
el = pd.read_csv(PRO / "elderly_by_admdong.csv")
d = d.merge(el[["dongNm", "ratio70p", "ym"]].rename(columns={"dongNm": "admd"}), on="admd", how="left")

n = len(d)
rate = lambda m: f"{int(m.sum()):,} / {n:,} ({m.mean():.1%})"
stats = {
    "pk": rate(d["pk"].notna()), "jibun": rate(d["jibun"].notna()), "ri": rate(d["ri"].notna()),
    "admd": rate(d["admd"].notna()), "elderly": rate(d["ratio70p"].notna()),
}
print(stats)
print("행정동 분포:", d["admd"].value_counts().to_dict())
ym = str(int(el["ym"].iloc[0]))
ex = {r.bid: {"pk": r.pk, "ri": r.ri, "ad": r.admd, "eo": None if pd.isna(r.ratio70p) else float(r.ratio70p)} for r in d.itertuples()}
(WEB / "admin_extra.json").write_text(json.dumps(ex, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
d[["bid", "pk", "jibun", "ri", "emd"]].to_csv(PRIV / "jibun_경산시.csv", index=False, encoding="utf-8-sig")

join = [
    {"name": "건축물대장 표제부 (관리건축물대장 PK)", "org": "국토교통부 건축HUB", "date": "2026-10-05 조회", "unit": "건물(동)", "rate": stats["pk"]},
    {"name": "건축물대장 대지위치 (지번, 행정망 내부 파일)", "org": "국토교통부 건축HUB", "date": "2026-10-05 조회", "unit": "건물(동)", "rate": stats["jibun"]},
    {"name": "법정리 (GIS건물통합정보 법정동명)", "org": "국토교통부·브이월드", "date": "2026-09-09 기준", "unit": "필지", "rate": stats["ri"]},
    {"name": "행정동 경계", "org": "통계청 SGIS", "date": "2025-06-30 기준", "unit": "건물 대표점 위치", "rate": stats["admd"]},
    {"name": "주민등록 연령별 인구 (70세 이상 비율)", "org": "행정안전부", "date": f"{ym[:4]}-{ym[4:]} 말 기준", "unit": "행정동", "rate": stats["elderly"]},
]
(WEB / "join_stats.json").write_text(json.dumps({"rows": join, "elderly_ym": ym}, ensure_ascii=False, indent=1), encoding="utf-8")

# 판정 근거: 규칙과 그 규칙에 걸린 표기 예시(빈도 상위 3개)
rules = pd.read_csv(ROOT / "rules" / "roof_rules.csv", dtype=str)
s = pd.read_csv(PRO / "roof_strings_all.csv", dtype=str).fillna("")
s["n"] = s["n"].astype(int)
s = s[s["etcRoof"] != ""].groupby(["etcRoof", "rules_hit"], as_index=False)["n"].sum()
out = []
for r in rules.itertuples():
    hit = s[s["rules_hit"].str.split().apply(lambda xs: r.order in xs)].sort_values("n", ascending=False)
    out.append({"order": int(r.order), "label": r.label, "note": r.note, "pattern": r.pattern,
                "examples": hit["etcRoof"].head(3).tolist(), "n": int(hit["n"].sum())})
(WEB / "rules.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print("규칙", len(out), "개 저장")
