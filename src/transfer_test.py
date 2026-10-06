"""확장성 시험: 경산시에서 만든 지붕 규칙표가 다른 시·군 표제부에도 통하는가 → reports/transfer_test.md

- 대상: data/interim/title_{시군구코드}.parquet (fetch_title.py --sigungu 로 수집)
- 1차: rules/roof_rules.csv 를 **수정 없이** 적용 → 규칙에 하나도 안 걸린(미분류) 표기 수
- 2차: rules/roof_rules_transfer.csv (LLM이 미분류 표기를 보고 제안한 추가 규칙)가 있으면 합쳐 다시 적용
- 미분류 표기 목록은 data/processed/transfer_unmatched.csv 로 저장(LLM에게 줄 입력)
"""
import re
from pathlib import Path

import pandas as pd

import normalize_roof as nr

ROOT = Path(__file__).resolve().parents[1]
INT, PRO = ROOT / "data" / "interim", ROOT / "data" / "processed"
TARGETS = [("47230", "영천시"), ("47820", "청도군")]
EXTRA = ROOT / "rules" / "roof_rules_transfer.csv"
HOUSE = ["단독주택", "공동주택"]
BASE = list(nr.COMPILED)


def compiled(extra: pd.DataFrame | None):
    rows = [(int(o), p, l) for o, p, l in BASE]
    if extra is not None:
        rows += [(int(r.order), re.compile(r.pattern, re.I), r.label) for r in extra.itertuples()]
    return [(str(o), p, l) for o, p, l in sorted(rows, key=lambda x: x[0])]


def run(t: pd.DataFrame, rules) -> dict:
    nr.COMPILED = rules
    t = t.copy()
    for c in ("roofCdNm", "etcRoof", "mainPurpsCdNm"):
        t[c] = t[c].fillna("").astype(str).str.strip()
    cls = {s: nr.classify_text(s) for s in t["etcRoof"].unique()}
    t["text_class"] = t["etcRoof"].map(lambda s: cls[s][0])
    t["hit"] = t["etcRoof"].map(lambda s: cls[s][1])
    t["roof_class"] = [nr.classify_building(c, k, s) for c, k, s in zip(t["roofCdNm"], t["text_class"], t["etcRoof"])]
    nz = t[t["etcRoof"] != ""]
    un = nz[nz["hit"] == ""]
    h = t[t["mainPurpsCdNm"].isin(HOUSE)]
    rc = h["roof_class"].value_counts()
    sure = int(rc.get("슬레이트", 0) + rc.get("코드만 슬레이트", 0))
    mx = sure + int(rc.get("혼합", 0))
    code = int((h["roofCdNm"] == "슬레이트").sum())
    return dict(rows=len(t), houses=len(h), uniq=int(nz["etcRoof"].nunique()), un_uniq=int(un["etcRoof"].nunique()), un_rows=int(len(un)),
                un_house_rows=int(un["mainPurpsCdNm"].isin(HOUSE).sum()), code=code, sure=sure, max=mx, miss=mx - code,
                ambiguous=int(((h["text_class"] == "불명(표기 모호)") & (h["roof_class"] == "불명")).sum()),
                unmatched=un["etcRoof"].value_counts(), cls=t[["mgmBldrgstPk", "roof_class"]] if "mgmBldrgstPk" in t else None)


extra = pd.read_csv(EXTRA, dtype=str) if EXTRA.exists() else None
res, un_all = [], []
for code, name in TARGETS:
    f = INT / f"title_{code}.parquet"
    if not f.exists():
        print(f"{name}: 자료 없음({f.name}) — 건너뜀")
        continue
    t = pd.read_parquet(f)
    a = run(t, compiled(None))
    b = run(t, compiled(extra)) if extra is not None else None
    res.append((name, a, b))
    un_all.append(a["unmatched"].rename("n").rename_axis("etcRoof").reset_index().assign(sgg=name))
    print(f"{name}: 표제부 {a['rows']:,} · 주택류 {a['houses']:,} · 고유 표기 {a['uniq']:,} · 미분류 {a['un_uniq']}종({a['un_rows']}건, 주택 {a['un_house_rows']}건)"
          f" · 코드 {a['code']:,} → 확실 {a['sure']:,} ~ 최대 {a['max']:,}" + (f" | 추가 규칙 적용 후 미분류 {b['un_uniq']}종" if b else ""))
if not res:
    raise SystemExit("대상 자료가 없습니다")
un = pd.concat(un_all).groupby("etcRoof").agg(n=("n", "sum"), sgg=("sgg", lambda s: "·".join(sorted(set(s))))).reset_index().sort_values("n", ascending=False)
un.to_csv(PRO / "transfer_unmatched.csv", index=False, encoding="utf-8-sig")
print("미분류 표기(두 시군 합산, 고유):", len(un), "→", PRO / "transfer_unmatched.csv")
print(" | ".join(f"{r.etcRoof}×{r.n}" for r in un.head(80).itertuples()))

# 경산시에 추가 규칙을 적용하면 분류가 바뀌는가 (바뀌면 경산 수치의 재현성에 영향)
gs_changed = None
if extra is not None:
    g = pd.read_parquet(INT / "title_47290.parquet")
    ga, gb = run(g, compiled(None)), run(g, compiled(extra))
    gs_changed = int((ga["cls"]["roof_class"].to_numpy() != gb["cls"]["roof_class"].to_numpy()).sum())
    print("추가 규칙을 경산시에 적용했을 때 분류가 바뀌는 표제부:", gs_changed, "건 | 경산 확실~최대:", gb["sure"], "~", gb["max"])
nr.COMPILED = BASE

n_extra = 0 if extra is None else len(extra)
L = ["# 확장성 시험 — 경산시 규칙표를 다른 시·군에 그대로 적용", "",
     "경산시 표제부를 보고 만든 지붕 규칙표(`rules/roof_rules.csv`, 23개)를 **고치지 않고** 인접한 경북 시·군의 건축물대장 표제부에 적용했다. "
     "모든 수치는 대장 기재 기준이며 현장에서 확인한 값이 아니다.", "",
     "| 시·군 | 표제부 건수 | 고유 표기 | 경산 규칙 그대로 미분류 | 추가 규칙 수 | 코드 누락 비율 | 확실 ~ 최대 |", "|---|---|---|---|---|---|---|",
     "| 경산시(기준) | 49,728 | 2,662종 | 0종 | — | 34.1% (2,080 / 6,092) | 3,281 ~ 6,092동 |"]
for name, a, b in res:
    x = b or a
    L.append(f"| {name} | {a['rows']:,} | {a['uniq']:,}종 | {a['un_uniq']}종 ({a['un_uniq'] / a['uniq']:.1%}), {a['un_rows']}건 | "
             + (f"{n_extra}개 → 미분류 {b['un_uniq']}종" if b else "미적용") +
             f" | {x['miss'] / x['max']:.1%} ({x['miss']:,} / {x['max']:,}) | {x['sure']:,} ~ {x['max']:,}동 |")
L += ["", "- **미분류**: 규칙 23개 중 어느 것에도 걸리지 않은 자유기재 표기. 건수는 그 표기가 적힌 표제부 수(용도 무관).",
      "- **코드 누락 비율**: 지붕 코드=슬레이트만 세면 정규화 후 최대치에서 빠지는 주택 비율. 주택류(단독·공동주택) 기준.",
      "- **확실 ~ 최대**: 확실 = 슬레이트 단독 기재 + 코드만 슬레이트, 최대 = 확실 + 혼합 기재. 정의는 경산시와 같다.", ""]
L += ["## 경산 규칙을 그대로 적용했을 때 (추가 규칙 전)", "", "| 시·군 | 주택류 | 코드 집계 | 확실 | 최대 | 코드 누락 | 표기 모호로 제외 | 미분류가 걸린 주택 |", "|---|---|---|---|---|---|---|---|"]
for name, a, _ in res:
    L.append(f"| {name} | {a['houses']:,} | {a['code']:,} | {a['sure']:,} | {a['max']:,} | {a['miss']:,} ({a['miss'] / a['max']:.1%}) | {a['ambiguous']:,} | {a['un_house_rows']:,} |")
L += ["", "## 시·군마다 코드 누락 비율이 크게 다르다", "",
      "- 청도군은 코드 누락이 0.6%뿐이다. 지붕 코드가 슬레이트인 주택의 자유기재가 거의 전부 표준 표기 `슬레이트`(8,678동)이고, 자유기재에 구분자(/ ,)가 들어간 주택이 0.3%에 그친다. 대장 지붕 기재가 이미 코드와 같게 정리돼 있어 자유기재를 읽어도 새로 찾아지는 주택이 거의 없다.",
      "- 영천시(26.5%)와 경산시(34.1%)는 `스레트`·`스레이트` 같은 변형 표기와 혼합 기재가 많다(구분자 비율 영천 11.0%, 경산 16.5%). 자유기재 정규화의 효과는 이런 시·군에서 난다.",
      "- 따라서 '코드만 세면 3분의 1을 놓친다'는 경산시의 결과를 다른 시·군에 그대로 일반화하면 안 된다. 시·군별 대장 정리 상태에 따라 0.6%에서 34.1%까지 차이가 난다(세 곳 기준).",
      "- 청도군의 대장이 왜 이렇게 정리돼 있는지(일제 정비 여부 등)는 확인하지 못했다."]
L += ["", "## 미분류 표기와 추가 규칙", ""]
if extra is None:
    L += [f"두 시·군 합쳐 미분류 표기 {len(un)}종. 추가 규칙은 아직 만들지 않았다. 목록: `data/processed/transfer_unmatched.csv`", ""]
else:
    L += [f"- 두 시·군 합쳐 미분류 표기 {len(un)}종을 LLM(Claude 하위 에이전트)에게 주고 규칙 추가안을 받아 `rules/roof_rules_transfer.csv` 에 {n_extra}개 규칙으로 정리했다. 경산 규칙표 자체는 고치지 않았다.",
          "- 추가 규칙 적용 후 미분류: " + ", ".join(f"{name} {b['un_uniq']}종" for name, _, b in res),
          f"- 같은 추가 규칙을 경산시에 적용하면 분류가 바뀌는 표제부는 {gs_changed}건이다.", "",
          "| 추가 규칙(패턴) | 분류 | 설명 |", "|---|---|---|"]
    L += [f"| `{r.pattern}` | {r.label} | {r.note} |" for r in extra.itertuples()] + [""]
L += ["경산 규칙 그대로일 때의 미분류 표기 (빈도순, 최대 40종):", "", "| 표기 | 건수 | 시·군 |", "|---|---|---|"]
L += [f"| `{r.etcRoof}` | {r.n} | {r.sgg} |" for r in un.head(40).itertuples()]
L += ["", "## 한계", "",
      "- 인접한 경북 시·군 두 곳만 시험했다. 표기 관행이 다른 지역(다른 시·도, 대도시)에서도 같은 결과가 나온다고 말할 수 없다.",
      "- '미분류 0'은 모든 표기가 규칙에 걸렸다는 뜻이지, 분류가 옳다는 뜻이 아니다. 두 시·군의 분류 결과를 사람이 검토하지 않았고 LLM 교차검증도 하지 않았다.",
      "- 추가 규칙은 LLM이 제안한 것을 그대로 넣었으며 사람이 검수하지 않았다.",
      "- 대장 기재 기준이며 현장 미확인. 미등재 건축물은 포함되지 않는다.", ""]
(ROOT / "reports" / "transfer_test.md").write_text("\n".join(L), encoding="utf-8")
print("보고서:", ROOT / "reports" / "transfer_test.md")
