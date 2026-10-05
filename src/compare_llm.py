"""규칙표 분류와 LLM 독립 분류의 일치율 → reports/llm_crosscheck.md

LLM 분류는 data/processed/llm/out_*.csv (id,label; S=슬레이트만, M=혼합, N=비슬레이트, U=불명).
LLM(Claude Sonnet 하위 에이전트 3개)에게는 문자열만 주고 규칙표·규칙 결과는 주지 않았다.
둘 다 정답이 아니므로 이 문서의 수치는 '정확도'가 아니라 '두 방법의 일치율'이다.
"""
from pathlib import Path

import pandas as pd

from mlutil import rate
from normalize_roof import classify_text

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "data" / "processed"
MAP = {"S": "슬레이트", "M": "혼합", "N": "비슬레이트", "U": "불명"}
ORDER = ["슬레이트", "혼합", "비슬레이트", "불명"]

s = pd.read_csv(D / "llm" / "strings.csv", dtype=str)
llm = pd.concat([pd.read_csv(f, dtype=str) for f in sorted((D / "llm").glob("out_*.csv"))])
llm["label"] = llm["label"].str.strip()
assert llm["id"].is_unique and set(llm["id"]) == set(s["id"]) and set(llm["label"]) <= set(MAP), "LLM 출력 누락·중복·잘못된 라벨"
d = s.merge(llm, on="id")
d["llm"] = d["label"].map(MAP)
d["rule"] = d["etcRoof"].map(lambda x: classify_text(x)[0]).str.replace(r"\(.*\)", "", regex=True)
t = pd.read_parquet(D / "title_joined.parquet")
d["n"] = d["etcRoof"].map(t["etcRoof"].value_counts()).fillna(0).astype(int)
d["n_house"] = d["etcRoof"].map(t[t["house"]]["etcRoof"].value_counts()).fillna(0).astype(int)
d["same"] = d["rule"] == d["llm"]
d["rule_sl"] = d["rule"].isin(["슬레이트", "혼합"])
d["llm_sl"] = d["llm"].isin(["슬레이트", "혼합"])


def kappa(a, b, w) -> float:
    tot = w.sum()
    po = w[a == b].sum() / tot
    pe = sum((w[a == c].sum() / tot) * (w[b == c].sum() / tot) for c in set(a) | set(b))
    return (po - pe) / (1 - pe)


one = pd.Series(1, index=d.index)
L = ["# 지붕 자유기재 분류 — 규칙표와 LLM의 교차검증", "",
     "같은 문자열을 서로 다른 두 방법으로 분류해 얼마나 일치하는지 본 것이다. **정답과 비교한 정확도가 아니다.** 사람이 확인한 정답은 없다.", "",
     "## 방법", "",
     f"- 대상: 경산시 표제부 etcRoof 고유 문자열 {len(d):,}종 전부(빈값 제외). 표제부 {d['n'].sum():,}건, 그중 주택류 {d['n_house'].sum():,}건에 해당",
     "- 규칙표: `rules/roof_rules.csv` 를 순서대로 적용 (`src/normalize_roof.py`)",
     "- LLM: Claude Sonnet 하위 에이전트 3개가 문자열을 3묶음으로 나눠 직접 읽고 4분류(슬레이트만/혼합/비슬레이트/불명). 규칙표와 규칙 결과는 주지 않았고, 키워드·정규식 코드로 분류하지 말라고 지시함",
     "- 단, 규칙표를 만든 것도 같은 계열의 모델(Claude)이라 두 방법이 완전히 독립이라고 할 수는 없다. 같은 오해를 공유할 수 있다.", "",
     "## 일치율", "",
     "| 기준 | 4분류 일치 | Cohen's kappa | 슬레이트 포함 여부(2분류) 일치 |", "|---|---|---|---|"]
for name, w in (("고유 문자열", one), ("표제부 건수 가중", d["n"]), ("주택류 건수 가중", d["n_house"])):
    L.append(f"| {name} | {rate(int(w[d['same']].sum()), int(w.sum()))} | {kappa(d['rule'], d['llm'], w):.3f} | "
             f"{rate(int(w[d['rule_sl'] == d['llm_sl']].sum()), int(w.sum()))} |")
L += ["", "건수 가중의 신뢰구간은 같은 문자열이 반복되는 것을 독립 표본처럼 계산한 값이라 실제보다 좁다.", "",
      "교차표 (고유 문자열 수, 행=규칙표 · 열=LLM):", "", "| 규칙표↓ · LLM→ | " + " | ".join(ORDER) + " |", "|---" * 5 + "|"]
ct = pd.crosstab(d["rule"], d["llm"]).reindex(index=ORDER, columns=ORDER, fill_value=0)
L += [f"| {i} | " + " | ".join(str(int(ct.loc[i, c])) for c in ORDER) + " |" for i in ORDER]
L += ["", "교차표 (주택류 건수):", "", "| 규칙표↓ · LLM→ | " + " | ".join(ORDER) + " |", "|---" * 5 + "|"]
cw = d.pivot_table(index="rule", columns="llm", values="n_house", aggfunc="sum", fill_value=0).reindex(index=ORDER, columns=ORDER, fill_value=0)
L += [f"| {i} | " + " | ".join(f"{int(cw.loc[i, c]):,}" for c in ORDER) + " |" for i in ORDER]

dis = d[~d["same"]].sort_values("n", ascending=False)
sl = dis[dis["rule_sl"] != dis["llm_sl"]]
L += ["", "## 불일치", "",
      f"- 4분류가 다른 문자열: {len(dis)}종 (표제부 {int(dis['n'].sum()):,}건, 주택류 {int(dis['n_house'].sum()):,}건)",
      f"- 그중 **슬레이트 포함 여부가 갈리는** 문자열: {len(sl)}종 (표제부 {int(sl['n'].sum()):,}건, 주택류 {int(sl['n_house'].sum()):,}건)",
      f"  - 규칙표만 슬레이트로 본 것 {int((sl['rule_sl']).sum())}종 / LLM만 슬레이트로 본 것 {int((sl['llm_sl']).sum())}종", "",
      "슬레이트 포함 여부가 갈리는 문자열 (빈도순, 최대 40종):", "", "| 문자열 | 표제부 건수 | 규칙표 | LLM |", "|---|---|---|---|"]
L += [f"| `{r.etcRoof}` | {r.n} | {r.rule} | {r.llm} |" for r in sl.head(40).itertuples()]
L += ["", "그 밖의 불일치 (빈도순, 최대 30종):", "", "| 문자열 | 표제부 건수 | 규칙표 | LLM |", "|---|---|---|---|"]
L += [f"| `{r.etcRoof}` | {r.n} | {r.rule} | {r.llm} |" for r in dis[dis["rule_sl"] == dis["llm_sl"]].head(30).itertuples()]
L += ["", "## 읽는 법", "",
      "- 일치율이 높다는 것은 '규칙표가 LLM의 읽기와 같은 결과를 낸다'는 뜻이다. 둘 다 틀렸을 가능성은 이 비교로 배제되지 않는다.",
      "- 불일치 목록은 사람이 볼 가치가 있는 문자열을 추려 준다. 규칙표를 고칠지 여부는 목록을 보고 정한다(이 문서 작성 시점에는 규칙표를 고치지 않았다).", ""]
(ROOT / "reports" / "llm_crosscheck.md").write_text("\n".join(L), encoding="utf-8")
d.drop(columns=["label"]).to_csv(D / "llm" / "crosscheck.csv", index=False, encoding="utf-8-sig")
print("\n".join(L[14:20]))
print(ct.to_string())
print("불일치", len(dis), "| 슬레이트 여부 갈림", len(sl), int(sl["n"].sum()), int(sl["n_house"].sum()))
print(sl[["etcRoof", "n", "rule", "llm"]].head(25).to_string(index=False))
