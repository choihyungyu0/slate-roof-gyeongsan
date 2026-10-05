"""자유기재란(etcRoof) 텍스트 분류 검증용 표본.

- 표제부 전체(용도 무관)의 etcRoof 고유 문자열에서 무작위 300개 (시드 고정, 빈값 제외)
- data/labels/text_to_label.csv : 사람이 채울 파일 (문자열, 빈도, 판정칸). 규칙의 판정은 넣지 않음
- data/labels/text_sample_key.csv : 같은 300개에 대한 현재 규칙(SLATE_RE)의 판정
"""
import re
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
LAB = ROOT / "data" / "labels"
SEED, N = 20261005, 300
SLATE_RE = re.search(r'^SLATE_RE = r"(.*)"$', (ROOT / "src" / "analyze.py").read_text(encoding="utf-8"), re.M).group(1)

t = pd.read_parquet(ROOT / "data" / "interim" / "title_47290.parquet")
vc = t["etcRoof"].fillna("").str.strip().loc[lambda s: s != ""].value_counts()
out = LAB / "text_to_label.csv"
if out.exists():
    raise SystemExit(f"이미 있음(라벨링 중일 수 있어 덮어쓰지 않음): {out}")
pick = np.sort(np.random.default_rng(SEED).choice(len(vc), N, replace=False))
s = vc.iloc[pick].rename_axis("etcRoof").reset_index(name="n")
s = s.iloc[np.random.default_rng(SEED + 1).permutation(N)].reset_index(drop=True)
s.insert(0, "id", [f"T{i + 1:03d}" for i in range(N)])
s.assign(**{"판정(1=슬레이트 포함, 0=슬레이트 아님, ?=모르겠음)": ""}).to_csv(out, index=False, encoding="utf-8-sig")
s.assign(rule_slate=s["etcRoof"].str.contains(SLATE_RE, case=False, regex=True).astype(int)).to_csv(LAB / "text_sample_key.csv", index=False, encoding="utf-8-sig")
print(f"고유 문자열 {len(vc):,}종 중 {N}개 추출 → {out}")
print(f"표본이 덮는 표제부 건수: {int(s['n'].sum()):,} / {int(vc.sum()):,}")
print("빈도 분포: 1회", int((s.n == 1).sum()), "| 2~9회", int(s.n.between(2, 9).sum()), "| 10회 이상", int((s.n >= 10).sum()))
