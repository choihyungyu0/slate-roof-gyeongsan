"""1.5단계: 사람 판독 결과 분석 → reports/stage1_5.md

입력: data/labels/labels_*.csv (판독 도구에서 내려받은 파일. 열: rater,id,verdict,timestamp)
      data/labels/sample_key.csv (표본 열쇠), data/labels/sample_model_proba.csv (1단계 모델 확률)
판독 CSV가 없으면 설계와 대기 상태만 적은 보고서를 쓴다.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mlutil

ROOT = Path(__file__).resolve().parents[1]
LAB = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "labels"   # 인자로 다른 폴더를 주면 그 폴더의 판독 CSV 사용(검증용)
KEYDIR = ROOT / "data" / "labels"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / "reports" / "stage1_5.md"
VERDICTS = ["slate", "not_slate", "unreadable"]
KO = {"slate": "슬레이트", "not_slate": "슬레이트 아님", "unreadable": "판독불가"}


def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    """이항 비율의 95% Wilson 신뢰구간."""
    if n == 0:
        return float("nan"), float("nan")
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, c - h), min(1.0, c + h)


def rate(k: int, n: int) -> str:
    if n == 0:
        return "해당 없음 (0건)"
    lo, hi = wilson(k, n)
    return f"{k}/{n} = {k / n:.1%} (95% CI {lo:.1%}–{hi:.1%})"


def kappa(a: pd.Series, b: pd.Series, cats: list[str]) -> float:
    """Cohen's kappa (비가중)."""
    n = len(a)
    po = float((a.to_numpy() == b.to_numpy()).mean())
    pe = sum((a == c).mean() * (b == c).mean() for c in cats)
    return float("nan") if n == 0 or pe == 1 else (po - pe) / (1 - pe)


key = pd.read_csv(KEYDIR / "sample_key.csv", dtype=str)
key["register_slate"] = key["register_slate"].astype(int)
proba_f = KEYDIR / "sample_model_proba.csv"
proba = pd.read_csv(proba_f) if proba_f.exists() else None
files = sorted(LAB.glob("labels_*.csv"))

L: list[str] = ["# 지붕 아래 사람 — 1.5단계 판독 표본검증", ""]
L += ["## 표본 설계", "",
      f"- 대상: 자인면·하양읍의 주택 중 건물 폴리곤과 연결되고 도형 면적 20㎡ 이상인 것",
      f"- 층화 무작위 추출: 읍면 2곳 × 대장 지붕(슬레이트/비슬레이트) = 4개 층에서 각 75동, 합계 {len(key)}동 (난수 시드 20261005, 목록 `data/labels/sample_key.csv`)",
      "- 판독 영상: 브이월드 항공영상 줌 19(약 0.24m/화소), 대상 건물 주변 8m 여백. 촬영 시점 미확인",
      "- 판독자에게 대장 라벨·주소·지번은 보이지 않음(내부 ID만). 판정은 슬레이트 / 슬레이트 아님 / 판독불가",
      "- 표본 수: " + ", ".join(f"{r}·대장 {'슬레이트' if s else '비슬레이트'} {n}" for (r, s), n in key.groupby(["emd_nm", "register_slate"]).size().items()), ""]

if not files:
    L += ["## 결과", "", "**판독 대기 중.** `data/labels/` 에 판독 CSV(`labels_*.csv`)가 아직 없어 결과 수치는 없음.",
          "판독 도구: `labeling/index.html` (브라우저에서 바로 열기). 판독 후 내려받은 CSV를 `data/labels/` 에 넣고 "
          "`python src/analyze_labels.py` 를 실행하면 이 문서가 결과로 갱신됨.", ""]
    OUT.write_text("\n".join(L), encoding="utf-8")
    print("판독 CSV 없음 → 대기 상태 보고서 작성:", OUT)
    sys.exit(0)

raters: dict[str, pd.DataFrame] = {}
for f in files:
    d = pd.read_csv(f, dtype=str, encoding="utf-8-sig")
    bad = set(d["verdict"]) - set(VERDICTS)
    unknown = set(d["id"]) - set(key["id"])
    if bad or unknown:
        raise SystemExit(f"{f.name}: 알 수 없는 판정값 {bad or ''} / 표본에 없는 ID {len(unknown)}개")
    for name, g in d.groupby("rater"):
        g = g.sort_values("timestamp").drop_duplicates("id", keep="last")
        raters[name] = pd.concat([raters[name], g]).drop_duplicates("id", keep="last") if name in raters else g
names = sorted(raters)
notes_f = KEYDIR / "rater_notes.json"
NOTES = json.loads(notes_f.read_text(encoding="utf-8")) if notes_f.exists() else {}


def block(title: str, m: pd.DataFrame) -> list[str]:
    """m: key + verdict 가 붙은 표. 한 판독 기준의 결과 블록."""
    out = [f"### {title}", "", f"판정 수 {len(m)} / 표본 {len(key)}" + ("" if len(m) == len(key) else " — **미완료 판독**"), ""]
    un = int((m["verdict"] == "unreadable").sum())
    rd = m[m["verdict"] != "unreadable"]
    s1, s0 = rd[rd["register_slate"] == 1], rd[rd["register_slate"] == 0]
    out += ["| 지표 | 값 |", "|---|---|",
            f"| 대장 미갱신 추정률 — 대장=슬레이트 중 판독=슬레이트 아님 (판독불가 제외) | {rate(int((s1['verdict'] == 'not_slate').sum()), len(s1))} |",
            f"| 숨은 슬레이트 추정률 — 대장=비슬레이트 중 판독=슬레이트 (판독불가 제외) | {rate(int((s0['verdict'] == 'slate').sum()), len(s0))} |",
            f"| 판독불가 비율 (전체) | {rate(un, len(m))} |",
            f"| 판독불가 비율 — 대장=슬레이트 | {rate(int(((m['verdict'] == 'unreadable') & (m['register_slate'] == 1)).sum()), int((m['register_slate'] == 1).sum()))} |",
            f"| 판독불가 비율 — 대장=비슬레이트 | {rate(int(((m['verdict'] == 'unreadable') & (m['register_slate'] == 0)).sum()), int((m['register_slate'] == 0).sum()))} |", ""]
    out += ["읍면별:", "", "| 읍면 | 대장 미갱신 추정률 | 숨은 슬레이트 추정률 | 판독불가 |", "|---|---|---|---|"]
    for r, g in m.groupby("emd_nm"):
        gr = g[g["verdict"] != "unreadable"]
        a, b_ = gr[gr["register_slate"] == 1], gr[gr["register_slate"] == 0]
        out.append(f"| {r} | {rate(int((a['verdict'] == 'not_slate').sum()), len(a))} | {rate(int((b_['verdict'] == 'slate').sum()), len(b_))} | {rate(int((g['verdict'] == 'unreadable').sum()), len(g))} |")
    out += ["", "대장 × 판독 교차표:", "", "| | 판독: 슬레이트 | 판독: 아님 | 판독불가 |", "|---|---|---|---|"]
    for s, lab in ((1, "대장: 슬레이트"), (0, "대장: 비슬레이트")):
        g = m[m["register_slate"] == s]
        out.append(f"| {lab} | " + " | ".join(str(int((g["verdict"] == v).sum())) for v in VERDICTS) + " |")
    out.append("")
    if proba is not None:
        e = rd.merge(proba, on="id")
        y, p = (e["verdict"] == "slate").astype(int).to_numpy(), e["proba"].to_numpy(float)
        if 0 < y.sum() < len(y):
            s = mlutil.prf(y, (p >= 0.5).astype(int))
            out += ["1단계 모델을 판독 결과(정답)로 다시 평가 (판독불가 제외, 임계값 0.5):", "",
                    "| n | 판독=슬레이트 | precision | recall | F1 | ROC-AUC |", "|---|---|---|---|---|---|",
                    f"| {len(y)} | {int(y.sum())} | {s['precision']:.3f} | {s['recall']:.3f} | {s['f1']:.3f} | {mlutil.roc_auc(y, p):.3f} |", "",
                    f"혼동행렬: TN {s['tn']} · FP {s['fp']} · FN {s['fn']} · TP {s['tp']}", "",
                    "주의: 자인면 표본 중 1단계 교차검증에 들어간 건물은 out-of-fold 확률, 그 밖(하양읍 전부 포함)은 자인면 982동으로 학습한 모델의 예측이라 조건이 섞여 있음.", ""]
        else:
            out += ["1단계 모델 재평가: 판독=슬레이트가 0건이거나 전부여서 계산 불가.", ""]
    return out


L += ["## 결과", "", f"판독자 {len(names)}명: " + ", ".join(f"{n}({len(raters[n])}건)" for n in names), ""]
merged = {n: key.merge(raters[n][["id", "verdict"]], on="id") for n in names}
for n in names:
    b_ = block(f"판독자 {n}", merged[n])
    if n in NOTES:
        b_[2:2] = [f"> **판독자 주석**: {NOTES[n]}", ""]
    L += b_

L += ["## 판독자 간 일치도", ""]
if len(names) < 2:
    L += ["판독자가 1명이라 계산할 수 없음. 두 번째 판독자의 CSV를 추가하면 Cohen's kappa가 계산됨.", ""]
else:
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b_ = names[i], names[j]
            c = raters[a][["id", "verdict"]].merge(raters[b_][["id", "verdict"]], on="id", suffixes=("_a", "_b"))
            both = c[(c["verdict_a"] != "unreadable") & (c["verdict_b"] != "unreadable")]
            L += [f"### {a} × {b_}", "", f"- 공통 판정 {len(c)}건",
                  f"- 3범주 일치율 {(c['verdict_a'] == c['verdict_b']).mean():.1%}, Cohen's kappa {kappa(c['verdict_a'], c['verdict_b'], VERDICTS):.3f}",
                  f"- 둘 다 판독 가능한 {len(both)}건의 2범주 일치율 {(both['verdict_a'] == both['verdict_b']).mean():.1%}, kappa {kappa(both['verdict_a'], both['verdict_b'], VERDICTS[:2]):.3f}", "",
                  "| | " + " | ".join(f"{b_}: {KO[v]}" for v in VERDICTS) + " |", "|---|---|---|---|"]
            for va in VERDICTS:
                L.append(f"| {a}: {KO[va]} | " + " | ".join(str(int(((c["verdict_a"] == va) & (c["verdict_b"] == vb)).sum())) for vb in VERDICTS) + " |")
            L.append("")
            agree = c[c["verdict_a"] == c["verdict_b"]].rename(columns={"verdict_a": "verdict"})[["id", "verdict"]]
            L += block(f"두 판독자가 같은 판정을 내린 표본만 ({a} = {b_})", key.merge(agree, on="id"))

L += ["## 한계", "",
      f"- **표본이 작음**: 층당 75동, 합계 {len(key)}동. 신뢰구간이 넓으며(표 참조) 읍면별 수치는 더 불안정함.",
      "- 표본은 자인면·하양읍 두 곳뿐이며 층별 동수 추출이라, 합친 비율은 두 읍면의 실제 주택 수 비중을 반영한 가중 추정이 아님. 경산시 전체로 일반화할 수 없음.",
      "- 판독자가 모두 AI이면 이 결과는 사람 판독 검증이 아님. 사람 판독자 CSV를 추가해 일치도를 확인해야 함." if all("(AI)" in n for n in names) else "- 판독자 구성: " + ", ".join(names),
      "- 정답은 현장 조사가 아니라 0.24m급 항공영상 육안 판독임. 도색·덧씌움 슬레이트는 영상으로 구분되지 않을 수 있고, 영상 촬영 시점(미확인)과 대장 조회 시점(2026-10-05)이 다름.",
      "- 표본은 건물 도형과 연결된 주택에서만 뽑았으므로 대장-도형 불일치 건물과 미등재 건축물은 포함되지 않음.",
      "- '대장 미갱신 추정률'·'숨은 슬레이트 추정률'은 판독 결과와 대장 기재가 다른 비율을 뜻하며, 원인(개량·철거·기재 오류·동 오배정)은 구분하지 않음.", ""]
OUT.write_text("\n".join(L), encoding="utf-8")
print("보고서 작성:", OUT)
