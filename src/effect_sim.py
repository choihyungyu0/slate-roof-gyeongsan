"""기대효과 비교: 연 95동을 무작위로 배정할 때 vs 우선순위 점수 상위 95동 → reports/effect_sim.md

A안) 무작위: 확실 3,281동에서 95동을 무작위로 뽑기를 1,000회 반복한 평균 (신청순을 무작위로 가정)
B안) 우선순위 점수 상위 95동 (위치가 연결된 4,644동 안에서의 순위)
새 자료 없이 data/processed/priority_scores.csv 와 title_joined.parquet 만 쓴다.
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
PRO = ROOT / "data" / "processed"
N, REPS, SEED, RADIUS = 95, 1000, 20261006, 500

t = pd.read_parquet(PRO / "title_joined.parquet")
h = t[t["house"] & t["slate"]].copy()
ps = pd.read_csv(PRO / "priority_scores.csv", dtype={"gis_bld_id": str})
ps = ps[ps["located"]].drop_duplicates("gis_bld_id")
h = h.merge(ps[["gis_bld_id", "rank", "score", "dist_school_m", "dist_daycare_m", "dist_senior_m"]], on="gis_bld_id", how="left")
h["area"] = pd.to_numeric(h["archArea"], errors="coerce")
pool_a = h[h["slate_sure"]]
plan_b = h[h["rank"] <= N]
assert len(plan_b) == N, len(plan_b)


def metrics(d: pd.DataFrame) -> dict:
    yk = d["year"].notna()
    loc = d["dist_school_m"].notna()
    out = {"1990년 이전 사용승인 비율(연도 확인분)": (d["year"] < 1990).sum() / yk.sum() * 100,
           "평균 사용승인연도(연도 확인분)": d.loc[yk, "year"].mean(),
           "연도 불명 동수": float((~yk).sum()),
           "건축면적 합계(㎡)": d["area"].sum(),
           "위치가 있는 동수": float(loc.sum())}
    for k, name in (("school", "학교"), ("daycare", "어린이집"), ("senior", "경로당")):
        out[f"{name} {RADIUS}m 안 비율(위치 있는 동 중)"] = (d.loc[loc, f"dist_{k}_m"] <= RADIUS).mean() * 100
    near = (d.loc[loc, ["dist_school_m", "dist_daycare_m"]] <= RADIUS).any(axis=1)
    out[f"학교 또는 어린이집 {RADIUS}m 안 비율(위치 있는 동 중)"] = near.mean() * 100
    return out


rng = np.random.default_rng(SEED)
runs = pd.DataFrame([metrics(pool_a.iloc[rng.choice(len(pool_a), N, replace=False)]) for _ in range(REPS)])
a_mean, a_lo, a_hi = runs.mean(), runs.quantile(0.025), runs.quantile(0.975)
b = pd.Series(metrics(plan_b))


def fmt(k: str, v: float) -> str:
    if "비율" in k:
        return f"{v:.1f}%"
    if "연도(" in k:
        return f"{v:.0f}년"
    if "㎡" in k:
        return f"{v:,.0f}"
    return f"{v:.1f}"


L = ["# 기대효과 비교 — 무작위 배정 vs 우선순위 점수", "",
     f"연 {N}동(2026년 경산시 주택 슬레이트 철거 지원 물량, 아주경제 2026.4.11 보도)을 어느 집에 쓰느냐에 따라 대상 집단이 어떻게 달라지는지 지금 자료로만 비교했다.", "",
     f"- **A안 무작위**: 확실 {len(pool_a):,}동에서 {N}동을 무작위로 뽑기를 {REPS:,}회 반복한 평균(괄호는 반복의 95% 구간). 신청순이 무작위라고 가정한 것",
     f"- **B안 점수 순**: 우선순위 점수 상위 {N}동 (건물 도형과 연결된 4,644동 안에서의 순위)", "",
     "| 지표 | A안 무작위 | B안 점수 상위 95동 |", "|---|---|---|"]
for k in b.index:
    L.append(f"| {k} | {fmt(k, a_mean[k])} ({fmt(k, a_lo[k])}~{fmt(k, a_hi[k])}) | {fmt(k, b[k])} |")
k1, k2, k3 = "1990년 이전 사용승인 비율(연도 확인분)", f"학교 또는 어린이집 {RADIUS}m 안 비율(위치 있는 동 중)", "건축면적 합계(㎡)"
line = (f"같은 {N}동을 쓰더라도 점수 순으로 고르면 학교·어린이집 {RADIUS}m 안에 있는 주택 비율이 {a_mean[k2]:.0f}%에서 {b[k2]:.0f}%로, "
        f"1990년 이전 주택 비율이 {a_mean[k1]:.0f}%에서 {b[k1]:.0f}%로 달라진다(대장 기재 기준 모의 계산, 가중치는 기본값).")
L += ["", "## 소개서용 문장", "", line, "",
      "## 한계", "",
      "- **이 비교는 순환적이다.** 점수가 노후도·면적·시설 거리로 만들어졌으므로, 점수 상위 집단이 그 지표에서 높게 나오는 것은 당연하다. 이 표는 '점수가 효과가 있다'는 증명이 아니라 '점수대로 고르면 대상 집단이 이만큼 달라진다'는 설명이다.",
      "- 가중치와 거리 기준은 임의로 정한 기본값이다. 가중치를 바꾸면 B안의 수치가 달라진다.",
      "- 실제 신청순은 무작위가 아닐 수 있다(정보를 먼저 접한 집, 자부담 여력이 있는 집이 먼저 신청할 수 있음). A안은 가정이다.",
      f"- A안은 확실 {len(pool_a):,}동에서, B안은 위치가 있는 4,644동(혼합 기재 포함)에서 골라 모집단이 다르다. 거리 지표는 A안에서도 위치가 있는 동만으로 계산했다(무작위 95동 중 평균 {a_mean['위치가 있는 동수']:.0f}동).",
      f"- 건축면적 합계의 A안 평균은 대장에 건축면적이 매우 크게 적힌 주택(최대 {pool_a['area'].max():,.0f}㎡) 몇 동 때문에 반복마다 크게 흔들린다. 반복의 중앙값은 {runs[k3].median():,.0f}㎡로 B안과 비슷하다. 면적 지표로는 두 안의 차이를 말할 수 없다.",
      "- 건축면적은 지붕 면적의 근사이고, 모든 값은 대장 기재 기준이다. 실제 슬레이트 여부·거주 여부는 반영되지 않았다.", ""]
(ROOT / "reports" / "effect_sim.md").write_text("\n".join(L), encoding="utf-8")
print("\n".join(L[7:18])); print(line)
