"""대장 지붕 기재 전수 정규화.

- data/processed/roof_strings_all.csv : roofCdNm·etcRoof 고유 조합 전체와 빈도, 분류 결과, 걸린 규칙
- rules/roof_rules.csv : 순서대로 적용하는 규칙표(정규식 → 슬레이트/비슬레이트/모호/무시/불명). 걸린 부분은 지우고 다음 규칙 적용
- etcRoof 문자열 분류: 슬레이트 / 혼합(슬레이트+다른 재료) / 비슬레이트 / 불명
- 건물 분류(코드+자유기재): 슬레이트 / 혼합 / 코드만 슬레이트(자유기재는 다른 재료) / 비슬레이트 / 불명
"""
import re
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PRO = ROOT / "data" / "processed"
RULES = pd.read_csv(ROOT / "rules" / "roof_rules.csv", dtype=str).sort_values("order", key=lambda s: s.astype(int))
COMPILED = [(r.order, re.compile(r.pattern, re.I), r.label) for r in RULES.itertuples()]
JUNK = re.compile(r"[\s\d\W_a-zA-Z]+")  # 규칙 적용 뒤 남아도 되는 것: 공백·숫자·기호·영문 단위(T, THK, mm 등)


def classify_text(s: str) -> tuple[str, str, str]:
    """반환: (분류, 걸린 규칙 번호들, 규칙에 안 걸리고 남은 글자)"""
    rest, labels, hits = s, set(), []
    for order, pat, label in COMPILED:
        if order == "190" and not labels - {"무시"}:
            break  # 수식어 규칙만으로 "걸렸다"고 치지 않는다
        if pat.search(rest):
            hits.append(order)
            labels.add(label)
            rest = pat.sub(" ", rest)
    left = JUNK.sub("", rest)
    if "슬레이트" in labels:
        cls = "혼합" if "비슬레이트" in labels else "슬레이트"
    elif "모호" in labels:
        cls = "불명(표기 모호)"
    elif "비슬레이트" in labels:
        cls = "비슬레이트"
    else:
        cls = "불명(재료 미기재)"
    return cls, " ".join(hits), left


def classify_building(code: str, text_cls: str, text: str) -> str:
    if text_cls in ("슬레이트", "혼합"):
        return text_cls
    if code == "슬레이트":
        return "코드만 슬레이트" if text_cls == "비슬레이트" else "슬레이트"
    if text_cls == "불명(표기 모호)":
        return "불명"
    if text_cls == "비슬레이트" or code in ("(철근)콘크리트", "기와"):
        return "비슬레이트"
    return "불명"


def main() -> None:
    t = pd.read_parquet(PRO / "title_joined.parquet").drop(columns=["text_class", "roof_class"], errors="ignore")
    for c in ("roofCdNm", "etcRoof"):
        t[c] = t[c].fillna("").str.strip()
    uniq = pd.DataFrame({"etcRoof": t["etcRoof"].unique()})
    uniq[["text_class", "rules_hit", "leftover"]] = uniq["etcRoof"].apply(lambda s: pd.Series(classify_text(s)))
    t = t.merge(uniq, on="etcRoof")
    t["roof_class"] = [classify_building(c, k, s) for c, k, s in zip(t["roofCdNm"], t["text_class"], t["etcRoof"])]

    allstr = (t.groupby(["roofCdNm", "etcRoof", "text_class", "roof_class", "rules_hit", "leftover"]).size().reset_index(name="n")
              .sort_values("n", ascending=False))
    allstr.to_csv(PRO / "roof_strings_all.csv", index=False, encoding="utf-8-sig")
    t[["mgmBldrgstPk", "text_class", "roof_class"]].to_parquet(PRO / "roof_normalized.parquet", index=False)

    nz = uniq[uniq["etcRoof"] != ""]
    nohit = nz[nz["rules_hit"] == ""]
    left = nz[nz["leftover"] != ""]
    cnt = t["etcRoof"].value_counts()
    print(f"etcRoof 고유 문자열 {len(nz):,}종 (빈값 제외) | roofCdNm·etcRoof 고유 조합 {len(allstr):,}종")
    print(f"규칙에 하나도 안 걸린 문자열: {len(nohit)}종 ({int(cnt.reindex(nohit['etcRoof']).sum())}건)")
    print(f"규칙 적용 뒤 한글이 남은 문자열: {len(left)}종 ({int(cnt.reindex(left['etcRoof']).sum())}건)")
    for name, d in (("안 걸림", nohit), ("남은 글자", left)):
        d = d.assign(n=cnt.reindex(d["etcRoof"]).to_numpy()).sort_values("n", ascending=False).head(60)
        print(f"-- {name} 상위:", " | ".join(f"{r.etcRoof}[{r.leftover}]×{r.n}" for r in d.itertuples()))
    print("\netcRoof 문자열 분류(고유 종 / 건수):")
    print(pd.DataFrame({"종": nz["text_class"].value_counts(), "건": t[t["etcRoof"] != ""].groupby("text_class").size()}).to_string())
    h = t[t["house"]]
    print("\n주택류 건물 분류:", h["roof_class"].value_counts().to_dict())
    print("코드만 쓸 때 슬레이트 주택:", int((h["roofCdNm"] == "슬레이트").sum()))
    print(pd.crosstab(h["roofCdNm"].replace("", "(빈값)"), h["roof_class"]).to_string())
    old = int(h["slate_regex"].sum())
    print("이전 정규식 기준 슬레이트 주택:", old, "| 새 규칙 슬레이트+혼합+코드만:", int(h["roof_class"].isin(["슬레이트", "혼합", "코드만 슬레이트"]).sum()))
    print("이전=슬레이트인데 새 규칙=불명/비슬레이트:", h[h["slate_regex"] & h["roof_class"].isin(["불명", "비슬레이트"])]["etcRoof"].value_counts().head(15).to_dict())
    print("이전≠슬레이트인데 새 규칙=슬레이트 계열:", h[~h["slate_regex"] & h["roof_class"].isin(["슬레이트", "혼합", "코드만 슬레이트"])]["etcRoof"].value_counts().head(10).to_dict())


if __name__ == "__main__":
    main()


def report() -> None:
    """reports/roof_normalization.md 작성 (main() 이 만든 산출물을 읽어 표로 정리)."""
    t = pd.read_parquet(PRO / "title_joined.parquet").drop(columns=["text_class", "roof_class"], errors="ignore").merge(pd.read_parquet(PRO / "roof_normalized.parquet"), on="mgmBldrgstPk")
    s = pd.read_csv(PRO / "roof_strings_all.csv", dtype=str).fillna("")
    s["n"] = s["n"].astype(int)
    h = t[t["house"]]
    code = int((h["roofCdNm"] == "슬레이트").sum())
    rc = h["roof_class"].value_counts()
    incl = int(rc.get("슬레이트", 0) + rc.get("혼합", 0) + rc.get("코드만 슬레이트", 0))
    sure = int(rc.get("슬레이트", 0) + rc.get("코드만 슬레이트", 0))
    amb = h[(h["text_class"] == "불명(표기 모호)") & (h["roof_class"] == "불명")]
    es = s[s["etcRoof"] != ""].drop_duplicates("etcRoof")
    left = es[es["leftover"] != ""]
    tc = t[t["etcRoof"].fillna("").str.strip() != ""].groupby("text_class").size()
    L = ["# 대장 지붕 기재 전수 정규화", "",
         "경산시 건축물대장 표제부 49,728건의 지붕 코드명(roofCdNm)과 자유기재(etcRoof)를 규칙표로 전수 분류한 결과. "
         "정답과 비교한 정확도가 아니라, 규칙을 그대로 적용하면 누구나 같은 값을 얻는 **재현 가능한 분류**다.", "",
         "## 방법", "",
         f"- 규칙표 `rules/roof_rules.csv` ({len(RULES)}개 규칙)를 위에서부터 적용. 걸린 부분은 지우고 다음 규칙을 적용해 한 문자열에서 여러 재료를 읽는다.",
         "- 자유기재 분류: **슬레이트**(슬레이트 표기만) / **혼합**(슬레이트 + 다른 재료, 예 `기와/스레트`) / **비슬레이트** / **불명**(표기 모호 또는 재료 미기재)",
         "- 건물 분류: 자유기재가 슬레이트·혼합이면 그대로. 자유기재가 다른 재료인데 코드만 슬레이트면 **코드만 슬레이트**로 따로 둔다.", "",
         "## 규칙 적용 범위", "",
         f"- etcRoof 고유 문자열 {len(es):,}종(빈값 제외), roofCdNm·etcRoof 고유 조합 {len(s):,}종 → 전체 목록 `data/processed/roof_strings_all.csv`",
         f"- 규칙에 하나도 걸리지 않은 문자열: **{int((es['rules_hit'] == '').sum())}종**",
         f"- 규칙 적용 뒤 한글이 일부 남은 문자열: {len(left)}종 ({int(left['n'].sum())}건). 상위 60종을 훑어본 범위에서는 `도`(아연도), `패니쉬`(스패니쉬기와) 같은 수식어·오기였고 재료명은 없었으나 전부 확인하지는 않음", "",
         "| 자유기재 분류 | 건수 |", "|---|---|"] + [f"| {k} | {int(v):,} |" for k, v in tc.sort_values(ascending=False).items()] + [
         f"| (빈값) | {int((t['etcRoof'].fillna('').str.strip() == '').sum()):,} |", "",
         "## 코드만 쓸 때 vs 정규화 후 (주택류 26,645동)", "",
         "| 기준 | 슬레이트 주택 수 |", "|---|---|",
         f"| 지붕 코드(roofCdNm)=슬레이트만 집계 | {code:,} |",
         f"| 정규화 후: 슬레이트 단독 | {int(rc.get('슬레이트', 0)):,} |",
         f"| 정규화 후: 혼합 기재 | {int(rc.get('혼합', 0)):,} |",
         f"| 정규화 후: 코드만 슬레이트(자유기재는 다른 재료) | {int(rc.get('코드만 슬레이트', 0)):,} |",
         f"| **정규화 후 합계(슬레이트 기재 포함)** | **{incl:,}** |",
         f"| 코드 집계에서 빠지는 수 | {incl - code:,} ({(incl - code) / incl:.1%}) |",
         f"| 별도: 표기 모호로 불명 처리한 주택 | {len(amb):,} |", "",
         "지붕 코드 × 정규화 분류 (주택류):", ""]
    ct = pd.crosstab(h["roofCdNm"].replace("", "(빈값)"), h["roof_class"])
    cols = [c for c in ["슬레이트", "혼합", "코드만 슬레이트", "비슬레이트", "불명"] if c in ct.columns]
    L += ["| 지붕 코드 | " + " | ".join(cols) + " |", "|---" * (len(cols) + 1) + "|"]
    L += [f"| {i} | " + " | ".join(f"{int(ct.loc[i, c]):,}" for c in cols) + " |" for i in ct.index] + [""]
    L += ["## 표기 모호(불명)로 둔 것", "", "문자열만으로 석면 슬레이트인지 정할 수 없어 슬레이트 집계에서 뺐다. 주택류 기준 상위:", ""]
    L += [f"- `{k}` {v}동" for k, v in amb["etcRoof"].value_counts().head(10).items()] + [""]
    old = int(h["slate_regex"].sum())
    L += ["## 이전 집계와의 차이", "",
          f"- 1단계 보고서의 슬레이트 주택 {old:,}동은 `스레트기와` 류를 슬레이트에 포함한 값이다. 이번 정규화에서는 이를 불명으로 분리해 {incl:,}동이 됐다(차이 {old - incl}동).",
          f"- 슬레이트 주택 수는 범위로 쓴다: **확실 {sure:,}동**(슬레이트 단독 + 코드만 슬레이트) ~ **최대 {incl:,}동**(혼합 기재 포함). 읍면동별 집계·지도·3D 화면도 이 기준이다.", "",
          "## 한계", "",
          "- 대장 기재를 읽은 것이며 실제 지붕 재료를 확인한 것이 아니다.",
          "- 혼합 기재는 지붕의 어느 부분이 슬레이트인지, 건물 여러 동을 한 줄에 적은 것인지 알 수 없다.",
          "- 규칙은 경산시 표기를 보고 만들었으므로 다른 지역에는 없는 표기가 있을 수 있다.", ""]
    (ROOT / "reports" / "roof_normalization.md").write_text("\n".join(L), encoding="utf-8")
    print("보고서:", ROOT / "reports" / "roof_normalization.md")


if __name__ == "__main__":
    report()
