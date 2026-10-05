"""A(지붕 값 확인) · B(슬레이트 주택 집계) · C(표제부↔폴리곤 조인).

입력: data/interim/title_47290.parquet, gs_buildings.gpkg, gs_emd.gpkg
출력: data/processed/roof_values.csv, slate_by_dong.csv, slate_by_decade.csv,
      title_joined.parquet(표제부+매칭 폴리곤 키), slate_houses.gpkg(슬레이트 주택 폴리곤·점)
"""
import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
INT = ROOT / "data" / "interim"
OUT = ROOT / "data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)

# A에서 실제 값을 확인한 뒤 확정한 표기 (etcRoof 자유 텍스트의 슬레이트 변형)
SLATE_RE = r"슬레이트|슬레트|슬래이트|슬래트|스레이트|스레트|스래이트|스래트|스레이드|슬레이드|스레뜨|쓰레트|스렛트|스레토|석면|slate"
HOUSE = ["단독주택", "공동주택"]
SUPPORT_2026 = 95  # 경산시 2026년 주택 슬레이트 철거 지원 물량(동) — 아주경제 2026.4.11 보도(사용자 제공, 원문 미열람)
YEAR_MIN = 1910    # 사용승인연도 1900~1909 는 실제 준공연도로 보기 어려워 "연도 불명"으로 분리

pd.set_option("display.width", 200)
stats: dict = {}


def section(t: str) -> None:
    print(f"\n{'=' * 8} {t} {'=' * 8}")


# ---------- 적재 ----------
t = pd.read_parquet(INT / "title_47290.parquet")
for c in ["roofCdNm", "etcRoof", "mainPurpsCdNm", "etcPurps", "useAprDay", "bun", "ji", "bjdongCd", "platGbCd"]:
    t[c] = t[c].fillna("").astype(str).str.strip()
stats["title_rows"] = len(t)

# ---------- A. 지붕 값 ----------
section("A. roofCdNm 고유값")
print(t["roofCdNm"].replace("", "(빈값)").value_counts().to_string())
section("A. etcRoof 고유값 (상위 30 / 전체는 roof_values.csv)")
ev = t["etcRoof"].replace("", "(빈값)").value_counts()
print(f"고유값 {len(ev):,}종")
print(ev.head(30).to_string())
ev.rename_axis("etcRoof").reset_index(name="n").to_csv(OUT / "roof_values.csv", index=False, encoding="utf-8-sig")

t["slate_code"] = t["roofCdNm"].eq("슬레이트")
t["slate_text"] = t["etcRoof"].str.contains(SLATE_RE, case=False, regex=True)
t["slate"] = t["slate_code"] | t["slate_text"]
section("A. 슬레이트 표기 형태")
print("etcRoof 중 슬레이트로 판정된 표기(빈도순):")
print(t.loc[t["slate_text"], "etcRoof"].value_counts().head(40).to_string())
print("\n코드(roofCdNm=슬레이트) × 텍스트(etcRoof 슬레이트 표기) 교차:")
print(pd.crosstab(t["slate_code"], t["slate_text"], rownames=["코드=슬레이트"], colnames=["텍스트=슬레이트"]).to_string())
print("\n코드=슬레이트인데 텍스트는 아닌 것의 etcRoof:")
print(t.loc[t["slate_code"] & ~t["slate_text"], "etcRoof"].replace("", "(빈값)").value_counts().head(15).to_string())
print("\n텍스트=슬레이트인데 코드는 아닌 것의 roofCdNm:")
print(t.loc[~t["slate_code"] & t["slate_text"], "roofCdNm"].replace("", "(빈값)").value_counts().to_string())
print("\n'슬' 또는 '스레/스래'가 들어가지만 판정에서 빠진 etcRoof (누락 점검):")
miss = t.loc[~t["slate_text"] & t["etcRoof"].str.contains(r"슬[레래]|스[레래]|쓰레|slat", case=False), "etcRoof"]
print(miss.value_counts().head(20).to_string() if len(miss) else "(없음)")
stats.update(slate_code=int(t["slate_code"].sum()), slate_text=int(t["slate_text"].sum()), slate_any=int(t["slate"].sum()))

# ---------- B. 슬레이트 주택 집계 ----------
emd = gpd.read_file(INT / "gs_emd.gpkg")
emd_nm = dict(zip(emd["emd_cd"], emd["emd_kor_nm"]))
t["emd_cd"] = "47290" + t["bjdongCd"].str[:3]
t["emd_nm"] = t["emd_cd"].map(emd_nm)
t["house"] = t["mainPurpsCdNm"].isin(HOUSE)
y = pd.to_numeric(t["useAprDay"].str[:4], errors="coerce")
t["year_raw"] = y
t["year"] = y.where((y >= YEAR_MIN) & (y <= 2026))
sh = t[t["house"] & t["slate"]].copy()

section("B. 슬레이트 주택")
print("주택류(단독주택+공동주택) 표제부:", f"{int(t['house'].sum()):,}", "| 그중 슬레이트:", f"{len(sh):,}")
print("주용도별:", sh["mainPurpsCdNm"].value_counts().to_dict())
print("주/부속:", sh["mainAtchGbCdNm"].value_counts().to_dict())
print("판정 근거: 코드만", int((sh.slate_code & ~sh.slate_text).sum()), "| 텍스트만", int((~sh.slate_code & sh.slate_text).sum()),
      "| 둘 다", int((sh.slate_code & sh.slate_text).sum()))
print("읍면동 코드 매핑 실패:", int(t["emd_nm"].isna().sum()))

by = (t[t["house"]].groupby(["emd_cd", "emd_nm"]).agg(houses=("house", "size"), slate_houses=("slate", "sum")).reset_index())
by["slate_main"] = by["emd_cd"].map(sh[sh["mainAtchGbCdNm"].eq("주건축물")].groupby("emd_cd").size()).fillna(0).astype(int)
by["slate_share_pct"] = (by["slate_houses"] / by["houses"] * 100).round(1)
by["median_year"] = by["emd_cd"].map(sh.groupby("emd_cd")["year"].median())
by["year_unknown"] = by["emd_cd"].map(sh[sh["year"].isna()].groupby("emd_cd").size()).fillna(0).astype(int)
by = by.sort_values("slate_houses", ascending=False)
by.to_csv(OUT / "slate_by_dong.csv", index=False, encoding="utf-8-sig")
print(by.to_string(index=False))

dec = (sh["year"] // 10 * 10).astype("Int64").astype(str).replace("<NA>", "연도 불명") + np.where(sh["year"].notna(), "년대", "")
dec = dec.value_counts().sort_index().rename_axis("decade").reset_index(name="n")
dec.to_csv(OUT / "slate_by_decade.csv", index=False, encoding="utf-8-sig")
print("\n사용승인연도 분포:")
print(dec.to_string(index=False))
n_1900s = int(sh["year_raw"].between(1900, 1909).sum())
n_known, n_pre90 = int(sh["year"].notna().sum()), int((sh["year"] < 1990).sum())
print("연도 불명:", int(sh["year"].isna().sum()), "= 1900~1909 기재", n_1900s, "+ 빈값·기타", int(sh["year"].isna().sum()) - n_1900s)
print(f"1990년 이전: {n_pre90:,} / 연도 확인 {n_known:,} = {n_pre90 / n_known:.1%} | 중앙값 {sh['year'].median():.0f}")
n_main = int(sh["mainAtchGbCdNm"].eq("주건축물").sum())
print(f"\n2026년 지원 물량 {SUPPORT_2026}동 기준 소요: 전체 {len(sh):,}동 → {len(sh) / SUPPORT_2026:.1f}년, "
      f"주건축물만 {n_main:,}동 → {n_main / SUPPORT_2026:.1f}년")
stats.update(house_rows=int(t["house"].sum()), slate_house=len(sh), slate_house_main=n_main,
             years_all=round(len(sh) / SUPPORT_2026, 1), years_main=round(n_main / SUPPORT_2026, 1),
             slate_house_year_known=int(sh["year"].notna().sum()),
             slate_house_pre1990=n_pre90, slate_house_year_unknown=int(sh["year"].isna().sum()),
             slate_house_year_1900s=n_1900s, slate_house_median_year=float(sh["year"].median()),
             top_emd=by.head(5)[["emd_nm", "slate_houses"]].values.tolist())

# ---------- C. 공간 조인 ----------
section("C. 표제부 ↔ 건물 폴리곤 조인")
b = gpd.read_file(INT / "gs_buildings.gpkg")
b = b[~b["gis_bld_id"].duplicated()].reset_index(drop=True)
t["PNU"] = "47290" + t["bjdongCd"] + t["platGbCd"].map({"0": "1", "1": "2"}).fillna("?") + t["bun"].str.zfill(4) + t["ji"].str.zfill(4)
print("PNU 구성 불가(대지구분 0/1 외):", int(t["PNU"].str.contains(r"\?").sum()))

# (1) 건축물대장 PK ↔ GIS 건축물ID 가 같은 체계인지 확인
bid = pd.to_numeric(b["bld_id"], errors="coerce")
pk = pd.to_numeric(t["mgmBldrgstPk"], errors="coerce")
both = t.assign(pk=pk).merge(b.assign(bid=bid)[["bid", "PNU"]].dropna(), left_on="pk", right_on="bid", how="inner", suffixes=("", "_g"))
same = (both["PNU"] == both["PNU_g"]).mean() if len(both) else float("nan")
print(f"mgmBldrgstPk == GIS 건축물ID(A19) 인 쌍: {len(both):,}건, 그중 PNU까지 일치: {same:.1%}" if len(both) else "PK 일치 쌍 없음")
pk_key_ok = len(both) > 0.5 * len(t) and same > 0.9
print("→ PK를 조인 키로 사용:", "가능" if pk_key_ok else "불가 (PNU 기준으로 조인)")

# (2) PNU(필지) 단위 매칭
pnu_set = set(b["PNU"])
t["pnu_hit"] = t["PNU"].isin(pnu_set)


def rate(mask) -> str:
    return f"{int(t.loc[mask, 'pnu_hit'].sum()):,} / {int(mask.sum()):,} = {t.loc[mask, 'pnu_hit'].mean():.1%}"


print("필지(PNU) 매칭률 — 표제부 전체:", rate(pd.Series(True, index=t.index)))
print("필지(PNU) 매칭률 — 주택류:", rate(t["house"]))
print("필지(PNU) 매칭률 — 슬레이트 주택:", rate(t["house"] & t["slate"]))
print("반대 방향 — 폴리곤 중 표제부 PNU가 있는 것:", f"{int(b['PNU'].isin(set(t['PNU'])).sum()):,} / {len(b):,} = {b['PNU'].isin(set(t['PNU'])).mean():.1%}")

# (3) 건물(동) 단위 매칭: PK가 되면 PK, 아니면 같은 필지 안에서 건축면적이 가장 가까운 폴리곤을 1:1 배정
t["gis_bld_id"] = None
t["match_how"] = "미매칭"
if pk_key_ok:
    m = dict(zip(bid.dropna().astype("int64"), b.loc[bid.notna(), "gis_bld_id"]))
    hit = pk.map(m)
    t.loc[hit.notna(), "gis_bld_id"] = hit[hit.notna()]
    t.loc[hit.notna(), "match_how"] = "PK"
used = set(t["gis_bld_id"].dropna())
bg = {k: g for k, g in b[~b["gis_bld_id"].isin(used)].groupby("PNU")}
for pnu, tg in t[t["gis_bld_id"].isna() & t["pnu_hit"]].groupby("PNU"):
    cand = bg.get(pnu)
    if cand is None:
        continue
    if len(tg) == 1 and len(cand) == 1:
        t.loc[tg.index[0], ["gis_bld_id", "match_how"]] = [cand["gis_bld_id"].iloc[0], "필지 1:1"]
        continue
    # 면적 차가 작은 쌍부터 탐욕 배정 (상대오차 20% 이내만)
    ta = pd.to_numeric(tg["archArea"], errors="coerce").to_numpy(float)
    ca = np.where(cand["arch_area"].notna(), cand["arch_area"], cand.geometry.area).astype(float)
    with np.errstate(divide="ignore", invalid="ignore"):
        d = np.abs(ta[:, None] - ca[None, :]) / np.maximum(ta[:, None], ca[None, :])
    d = np.nan_to_num(d, nan=9.0)
    order = np.dstack(np.unravel_index(np.argsort(d, axis=None), d.shape))[0]
    ti, ci = set(), set()
    for i, j in order:
        if d[i, j] > 0.2:
            break
        if i in ti or j in ci:
            continue
        ti.add(i), ci.add(j)
        t.loc[tg.index[i], ["gis_bld_id", "match_how"]] = [cand["gis_bld_id"].iloc[j], "필지+면적"]
t.loc[t["match_how"].eq("미매칭") & t["pnu_hit"], "match_how"] = "필지만 일치(동 특정 불가)"
t.loc[~t["pnu_hit"], "match_how"] = "대장-도형 불일치(필지에 도형 없음)"

print("\n건물(동) 단위 매칭 결과 — 표제부 전체:")
print(t["match_how"].value_counts().to_string())
hs = t["house"] & t["slate"]
print("\n건물(동) 단위 매칭 결과 — 슬레이트 주택:")
print(t.loc[hs, "match_how"].value_counts().to_string())
bm = t["gis_bld_id"].notna()
print(f"\n동 단위 매칭률: 전체 {bm.mean():.1%} ({int(bm.sum()):,}/{len(t):,}), 주택류 {bm[t['house']].mean():.1%}, "
      f"슬레이트 주택 {bm[hs].mean():.1%} ({int(bm[hs].sum()):,}/{int(hs.sum()):,})")
print("미매칭 슬레이트 주택:", int((~bm & hs).sum()), "| 한 폴리곤에 중복 배정:", int(t["gis_bld_id"].dropna().duplicated().sum()))
stats.update(polygons=len(b), pnu_rate_all=round(float(t["pnu_hit"].mean()), 4), pnu_rate_slate_house=round(float(t.loc[hs, "pnu_hit"].mean()), 4),
             bld_rate_all=round(float(bm.mean()), 4), bld_rate_house=round(float(bm[t["house"]].mean()), 4),
             bld_rate_slate_house=round(float(bm[hs].mean()), 4), slate_house_matched=int(bm[hs].sum()),
             slate_house_unmatched=int((~bm & hs).sum()), pk_key_ok=bool(pk_key_ok),
             match_how=t["match_how"].value_counts().to_dict(),
             polygons_without_title_pnu=int((~b["PNU"].isin(set(t["PNU"]))).sum()))

t.to_parquet(OUT / "title_joined.parquet", index=False)
keep = ["mgmBldrgstPk", "emd_cd", "emd_nm", "mainPurpsCdNm", "mainAtchGbCdNm", "roofCdNm", "etcRoof", "year", "archArea", "match_how", "gis_bld_id"]
g = b[["gis_bld_id", "geometry"]].merge(t.loc[hs & bm, keep], on="gis_bld_id", how="inner")
g.to_file(OUT / "slate_houses.gpkg", layer="polygons", driver="GPKG")
g.assign(geometry=g.geometry.representative_point()).to_file(OUT / "slate_houses.gpkg", layer="points", driver="GPKG")
print("저장:", OUT / "slate_houses.gpkg", f"({len(g):,}동)")
(OUT / "stats_abc.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
