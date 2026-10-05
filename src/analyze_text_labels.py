"""자유기재란(etcRoof) 텍스트 분류 정확도 → reports/text_classifier.md

입력: data/labels/text_to_label.csv (사람이 판정칸을 채운 것. 1=슬레이트 포함, 0=아님, ?=모르겠음)
      data/labels/text_sample_key.csv (같은 문자열에 대한 규칙 판정)
- 규칙(정규식 SLATE_RE): 사람 판정을 정답으로 precision/recall/F1 — 고유 문자열 기준과 빈도 가중(표제부 건수) 기준
- 모델(문자 1~3-gram + 로지스틱 회귀): 같은 300개에서 5-fold 교차검증. 표본이 작아 참고용
"""
import sys
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mlutil
from mlutil import rate

ROOT = Path(__file__).resolve().parents[1]
LAB = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "labels"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "reports" / "text_classifier.md"

d = pd.read_csv(LAB / "text_to_label.csv", dtype=str, encoding="utf-8-sig").fillna("")
key = pd.read_csv(ROOT / "data" / "labels" / "text_sample_key.csv", dtype=str, encoding="utf-8-sig")
vcol = [c for c in d.columns if c.startswith("판정")][0]
d["v"] = d[vcol].str.strip()
d = d.merge(key[["id", "rule_slate"]], on="id")
d["n"] = d["n"].astype(int)
d["rule"] = d["rule_slate"].astype(int)

L = ["# 자유기재란(etcRoof) 텍스트 분류 검증", "",
     f"- 표본: 경산시 표제부 etcRoof 고유 문자열 중 무작위 {len(d)}개 (시드 20261005). 이 표본이 덮는 표제부는 {d['n'].sum():,}건",
     "- 정답: 사람이 문자열만 보고 내린 판정(1=슬레이트 포함, 0=아님, ?=모르겠음). 규칙의 판정은 라벨링 파일에 넣지 않음", ""]
done = d[d["v"].isin(["0", "1", "?"])]
if len(done) == 0:
    L += ["**라벨링 대기 중.** `data/labels/text_to_label.csv` 의 판정칸이 비어 있어 결과 수치는 없음.", ""]
    OUT.write_text("\n".join(L), encoding="utf-8")
    print("판정 없음 → 대기 상태 보고서:", OUT)
    sys.exit(0)

e = done[done["v"] != "?"].copy()
e["y"] = e["v"].astype(int)
L += [f"판정 {len(done)}/{len(d)}개 (모르겠음 {int((done['v'] == '?').sum())}개는 평가에서 제외)" + ("" if len(done) == len(d) else " — **미완료**"), ""]


def weighted(y, p, w) -> dict:
    tp, fp = int(w[(p == 1) & (y == 1)].sum()), int(w[(p == 1) & (y == 0)].sum())
    fn, tn = int(w[(p == 0) & (y == 1)].sum()), int(w[(p == 0) & (y == 0)].sum())
    return dict(tp=tp, fp=fp, fn=fn, tn=tn)


def table(name: str, y, p, w) -> list[str]:
    out = [f"### {name}", "", "| 기준 | precision | recall | 정확도 | TP·FP·FN·TN |", "|---|---|---|---|---|"]
    for lab, c in (("고유 문자열", weighted(y, p, np.ones(len(y), dtype=int))), ("빈도 가중(표제부 건수)", weighted(y, p, w))):
        out.append(f"| {lab} | {rate(c['tp'], c['tp'] + c['fp'])} | {rate(c['tp'], c['tp'] + c['fn'])} | "
                   f"{rate(c['tp'] + c['tn'], sum(c.values()))} | {c['tp']}·{c['fp']}·{c['fn']}·{c['tn']} |")
    return out + [""]


y, w = e["y"].to_numpy(), e["n"].to_numpy()
L += ["## 결과", ""] + table("규칙(정규식)", y, e["rule"].to_numpy(), w)
L += ["빈도 가중 기준의 신뢰구간은 건수를 독립 표본처럼 계산한 것이라 실제보다 좁음(같은 문자열이 반복됨). 고유 문자열 기준을 우선할 것.", ""]
bad = e[e["rule"] != e["y"]]
L += [f"규칙과 사람 판정이 다른 문자열 {len(bad)}개:", ""] + ([f"- `{r.etcRoof}` (빈도 {r.n}) — 사람 {r.y}, 규칙 {r.rule}" for r in bad.itertuples()] or ["- 없음"]) + [""]

if 5 <= y.sum() <= len(y) - 5:
    grams = [Counter(g for k in (1, 2, 3) for g in (s[i:i + k] for i in range(len(s) - k + 1))) for s in e["etcRoof"]]
    vocab = {g: i for i, g in enumerate(sorted({g for c in grams for g in c}))}
    X = np.zeros((len(e), len(vocab)))
    for r, c in enumerate(grams):
        for g, v in c.items():
            X[r, vocab[g]] = v
    p = np.zeros(len(y))
    for tr, te in mlutil.stratified_group_kfold(y, np.arange(len(y)), k=5, seed=42):
        a, b = mlutil.standardize(X[tr], X[te])
        p[te] = mlutil.fit_predict_logreg(a, y[tr], b, C=0.1)
    L += table("모델(문자 1~3-gram + 로지스틱 회귀, 5-fold 교차검증)", y, (p >= 0.5).astype(int), w)
    L += [f"ROC-AUC {mlutil.roc_auc(y, p):.3f}. 학습 표본이 {len(y)}개뿐이라 참고용.", ""]
else:
    L += ["모델 교차검증: 한쪽 클래스가 5개 미만이라 생략.", ""]
L += ["## 한계", "", f"- 고유 문자열 {len(d)}개 표본. 드문 표기(1회 등장)가 대부분이라 고유 문자열 기준 수치는 희귀 표기 쪽 성능을 주로 반영함.",
      "- 정답은 문자열만 본 사람 판정이며 실제 지붕 재료를 확인한 것이 아님. '스레트기와' 같은 표기는 석면 슬레이트인지 문자열만으로 알 수 없음.",
      "- 경산시 표제부에서만 뽑았으므로 다른 지역 표기에는 일반화되지 않을 수 있음.", ""]
OUT.write_text("\n".join(L), encoding="utf-8")
print("보고서 작성:", OUT)
