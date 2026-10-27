"""행정 화면 v2용 보조 집계 (점수·순위와 무관).

출력: web/public/data/review.json
  emd      읍면동별 대장 슬레이트 주택 중 '코드가 놓친 집'(지붕 코드는 슬레이트가 아닌데 자유기재에 슬레이트가 적힌 집, 최대 기준)
  amb      판정 보류(표기 모호) 주택: 전체 동수·종수, 그중 코드로도 확인되지 않아 집계에서 뺀 동수·종수, 표기별 동수
  old      1990년 이전 사용승인 주택 중 대장 슬레이트 비율 (연도만으로 고르면 얼마나 맞나)
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
t = pd.read_parquet(ROOT / "data" / "processed" / "title_joined.parquet")
h = t[t["house"]]

s = h[h["slate"]]
miss = s[~s["slate_code"].astype(bool)]
emd = miss.groupby("emd_nm").size().to_dict()
print("코드가 놓친 집 합계:", len(miss))  # proposal_numbers.md 3번 2,080동과 같아야 한다
assert len(miss) == 2080, len(miss)

a = h[h["text_class"] == "불명(표기 모호)"]
ax = a[~a["slate"]]
amb = {"n": int(len(a)), "kinds": int(a["etcRoof"].nunique()), "excluded": int(len(ax)), "excluded_kinds": int(ax["etcRoof"].nunique()),
       "rows": [{"text": k, "n": int(v), "excluded": int((ax["etcRoof"] == k).sum())} for k, v in a["etcRoof"].value_counts().items()]}

o = h[h["year"] < 1990]
old = {"n": int(len(o)), "max": int(o["slate"].sum()), "sure": int(o["slate_sure"].sum())}

out = {"emd": {k: int(v) for k, v in emd.items()}, "amb": amb, "old": old}
(ROOT / "web" / "public" / "data" / "review.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(amb["n"], amb["kinds"], amb["excluded"], amb["excluded_kinds"], old)
