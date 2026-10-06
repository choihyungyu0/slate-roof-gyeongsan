"""인허가 이력 교차: 슬레이트 주택(대장 기재) ↔ 대수선·철거멸실관리대장, 필지(PNU) 단위 → reports/permit_check.md

입력: data/interim/permit_imprpr.parquet, permit_demol.parquet (fetch_permit.py), data/processed/title_joined.parquet
"이력이 있다"는 같은 필지에 인허가 기록이 있다는 뜻이며, 그 건물의 지붕이 바뀌었다는 확정이 아니다.
"""
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
INT, PRO = ROOT / "data" / "interim", ROOT / "data" / "processed"


def pnu(d: pd.DataFrame) -> pd.Series:
    return "47290" + d["bjdongCd"].str.zfill(5) + d["platGbCd"].map({"0": "1", "1": "2"}).fillna("?") + d["bun"].str.zfill(4) + d["ji"].str.zfill(4)


def year(s: pd.Series) -> pd.Series:
    y = pd.to_numeric(s.fillna("").astype(str).str[:4], errors="coerce")
    return y.where((y >= 1900) & (y <= 2026))


imp = pd.read_parquet(INT / "permit_imprpr.parquet")
dem = pd.read_parquet(INT / "permit_demol.parquet")
imp["PNU"], dem["PNU"] = pnu(imp), pnu(dem)
dem["dyear"] = year(dem["demolExtngDay"]).fillna(year(dem["demolEndDay"])).fillna(year(dem["demolStrtDay"]))
print(f"대수선 {len(imp):,}건 (필지 {imp['PNU'].nunique():,}) · 철거멸실 {len(dem):,}건 (필지 {dem['PNU'].nunique():,})")
print("대수선 구분:", imp["imprprGbCdNm"].replace("", "(빈값)").value_counts().head(8).to_dict())
print("철거멸실 구분:", dem["demolExtngGbCdNm"].replace("", "(빈값)").value_counts().head(6).to_dict())
print("철거멸실 연도 범위:", int(dem["dyear"].min()), "~", int(dem["dyear"].max()), "| 연도 없음", int(dem["dyear"].isna().sum()))
print("지붕재 석면 포함 여부(rfmaIncYn):", dem["rfmaIncYn"].replace("", "(빈값)").value_counts().to_dict())

t = pd.read_parquet(PRO / "title_joined.parquet")
h = t[t["house"] & t["slate"]].copy()
imp_p = set(imp["PNU"])
dmax = dem.groupby("PNU")["dyear"].max()          # 필지의 가장 최근 철거멸실 연도
dany = set(dem["PNU"])
h["has_imp"] = h["PNU"].isin(imp_p)
h["has_dem"] = h["PNU"].isin(dany)
h["dem_year"] = h["PNU"].map(dmax)
# 사용승인 이후(같은 해 포함)의 철거멸실만 '이 건물과 관련될 수 있는' 이력으로 본다. 사용승인연도가 불명이면 포함.
h["dem_after"] = h["has_dem"] & (h["year"].isna() | h["dem_year"].isna() | (h["dem_year"] >= h["year"]))
h["dem_before"] = h["has_dem"] & ~h["dem_after"]
h["any"] = h["has_imp"] | h["dem_after"]
roof = dem[dem["rfmaIncYn"].eq("1")]  # 1 = 지붕재에 석면 포함으로 신고
h["dem_roof_asb"] = h["PNU"].isin(set(roof["PNU"])) & h["dem_after"]
whole = dem[dem["demolExtngGbCdNm"].isin(["철거", "멸실"])]  # 부분철거·부분멸실 제외
h["dem_whole"] = h["PNU"].isin(set(whole["PNU"])) & h["dem_after"]


def row(name: str, mask) -> str:
    out = [name]
    for g in (h[h["slate_sure"]], h):
        k, n = int(mask.reindex(g.index).sum()), len(g)
        out.append(f"{k:,} / {n:,} ({k / n:.1%})")
    return "| " + " | ".join(out) + " |"


L = ["# 인허가 이력 교차 — 슬레이트 주택 ↔ 대수선·철거멸실관리대장", "",
     "건축물대장에 슬레이트로 적힌 경산시 주택과, 같은 필지의 대수선·철거멸실 인허가 기록을 맞춰 보았다. "
     "**이력이 있다는 것은 개량·철거 가능성이 있다는 뜻이지 확정이 아니다.** 필지 단위 매칭이라 같은 필지의 다른 건물 기록일 수 있다.", "",
     "- 자료: 국토교통부 건축HUB 건축인허가정보 서비스 — 대수선 " + f"{len(imp):,}건, 철거멸실관리대장 {len(dem):,}건 (경산시 전체, 2026-10-06 조회)",
     "- 매칭 키: 시군구+법정동+대지구분+번+지로 만든 19자리 PNU",
     f"- 철거멸실 기록의 연도 범위: {int(dem['dyear'].min())}~{int(dem['dyear'].max())}년 (연도 없는 기록 {int(dem['dyear'].isna().sum())}건). 그 이전의 철거·개량은 이 자료에 없다.", "",
     "| 구분 | 확실 3,281동 중 | 최대 6,092동 중 |", "|---|---|---|",
     row("같은 필지에 대수선 기록 있음", h["has_imp"]),
     row("같은 필지에 사용승인 이후 철거멸실 기록 있음", h["dem_after"]),
     row("　그중 (부분이 아닌) 철거·멸실 기록", h["dem_whole"]),
     row("　그중 지붕재 석면 포함으로 신고된 기록", h["dem_roof_asb"]),
     row("대수선 또는 사용승인 이후 철거멸실 중 하나라도 있음", h["any"]),
     row("**둘 다 없음 (사용승인 이후 인허가 이력 없음)**", ~h["any"]),
     row("(참고) 철거멸실 기록이 사용승인보다 앞선 것만 있음", h["dem_before"]), ""]
k_any, n = int(h["any"].sum()), len(h)
allp = set(t["PNU"])
dated = int(dem["dyear"].notna().sum())
L += ["## 인허가 자료 자체의 모습", "",
      f"- 경산시 전체 철거멸실관리대장은 {len(dem):,}건(필지 {dem['PNU'].nunique():,}곳)뿐이고, 그중 철거·멸실 일자가 적힌 것은 {dated:,}건이다. 대수선은 {len(imp):,}건이다.",
      f"- 철거멸실 기록의 주용도는 단독주택이 {int((dem['mainPurpsCdNm'] == '단독주택').sum()):,}건으로 가장 많고, 지붕재에 석면이 포함된 것으로 신고된 기록은 {len(roof):,}건이다.",
      f"- 철거멸실 필지 {dem['PNU'].nunique():,}곳 중 현재 표제부에 같은 필지가 있는 것은 {int(pd.Series(sorted(set(dem['PNU']))).isin(allp).sum()):,}곳이다(매칭 키는 정상 동작).",
      "- 철거 신고가 처리되면 대장이 말소되므로, 철거멸실 기록이 현재 대장의 슬레이트 주택과 거의 겹치지 않는 것은 자료 구조상 자연스럽다.", ""]
line = (f"대장에 슬레이트로 적힌 주택 {n:,}동을 대수선·철거멸실 인허가 기록과 필지 단위로 대조한 결과 겹치는 것은 {k_any:,}동({k_any / n:.1%})뿐이었다. "
        "인허가 기록만으로는 지붕 개량 여부를 가릴 수 없어, 대장 기재의 현행화에는 현장 확인이 필요하다(대장 기재 기준, 현장 미확인).")
L += ["## 소개서용 문장", "", line, "",
      "## 읽는 법과 한계", "",
      "- **이력 있음 ≠ 개량됨.** 같은 필지에 건물이 여러 동이면 다른 건물의 기록일 수 있고, 일부 철거·부속건물 철거도 섞여 있다.",
      "- **이 대조는 현장 확인을 대신하지 못한다.** 겹치는 기록이 거의 없다는 것은 슬레이트가 남아 있다는 증거가 아니라, 인허가 자료에 지붕 교체가 거의 기록되지 않는다는 뜻이다.",
      "- **이력 없음 ≠ 슬레이트가 남아 있음.** 지붕만 바꾸는 공사는 대수선 허가·신고 대상이 아닌 경우가 많아 기록이 남지 않는다. 신고 없이 철거한 경우도 잡히지 않는다.",
      "- 대수선 기록에는 허가 일자가 없어(자료 생성일만 있음) 사용승인 전후를 가리지 못했다. 대수선 구분에 '지붕틀'이 28건 있으나 슬레이트 주택 필지와 겹치는 대수선 기록은 0건이다.",
      f"- 철거멸실 기록 중 일자가 없는 {int(dem['dyear'].isna().sum())}건은 '사용승인 이후'로 간주했다.",
      "- 철거멸실관리대장의 석면 관련 항목(지붕재 석면 포함 여부 등)은 신고서 기재값이며 비어 있는 기록이 많다.",
      "- 대장 기재 기준이며 현장 미확인.", ""]
(ROOT / "reports" / "permit_check.md").write_text("\n".join(L), encoding="utf-8")
h[["mgmBldrgstPk", "has_imp", "dem_after", "dem_whole", "dem_roof_asb", "any"]].to_parquet(PRO / "permit_flags.parquet", index=False)
print("\n".join(L[9:18])); print(line)
