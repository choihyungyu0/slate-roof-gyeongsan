"""개별주택가격(국토교통부, 브이월드 국가중점 데이터 API)을 명부 4,644동의 필지(PNU)로 수집.

- 필지마다 가장 최근 기준연도의 공시가격을 쓴다. 한 필지에 여러 주택(동)이 있으면 그 해의 최솟값을 쓴다.
- 응답의 지번·건물명 같은 열은 저장하지 않는다(PNU·기준연도·가격만).
- 캐시: data/interim/housing_price/{PNU}.json → data/processed/housing_price.csv
키 값은 출력하지 않는다.
"""
import json
import os
import time
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "interim" / "housing_price"
CACHE.mkdir(parents=True, exist_ok=True)
load_dotenv(ROOT / ".env")
KEY, DOMAIN = os.environ["VWORLD_KEY"], os.environ["VWORLD_DOMAIN"]
URL = "https://api.vworld.kr/ned/data/getIndvdHousingPriceAttr"

ps = pd.read_csv(ROOT / "data" / "processed" / "priority_scores.csv", dtype={"gis_bld_id": str})
ps = ps[ps["located"]]
t = pd.read_parquet(ROOT / "data" / "processed" / "title_joined.parquet")[["gis_bld_id", "PNU"]].dropna().drop_duplicates("gis_bld_id")
pnus = sorted(set(ps.merge(t, on="gis_bld_id")["PNU"]))
print("명부 필지 수:", len(pnus))

calls = 0
for p in pnus:
    f = CACHE / f"{p}.json"
    if f.exists():
        continue
    for attempt in range(3):
        try:
            r = requests.get(URL, params={"key": KEY, "domain": DOMAIN, "pnu": p, "format": "json", "numOfRows": 100, "pageNo": 1}, timeout=40)
            js = r.json()
            break
        except (requests.RequestException, ValueError):
            time.sleep(3 * (attempt + 1))
    else:
        print("실패:", p)
        continue
    rows = (js.get("indvdHousingPrices") or {}).get("field") or []
    keep = [{"stdrYear": x.get("stdrYear"), "housePc": x.get("housePc")} for x in rows]
    f.write_text(json.dumps(keep), encoding="utf-8")
    calls += 1
    time.sleep(0.2)
    if calls % 500 == 0:
        print("호출", calls)

out = []
for p in pnus:
    f = CACHE / f"{p}.json"
    rows = json.loads(f.read_text(encoding="utf-8")) if f.exists() else []
    rows = [r for r in rows if r.get("stdrYear") and r.get("housePc")]
    if not rows:
        continue
    y = max(int(r["stdrYear"]) for r in rows)
    price = min(int(r["housePc"]) for r in rows if int(r["stdrYear"]) == y)
    out.append({"PNU": p, "year": y, "price": price})
d = pd.DataFrame(out)
d.to_csv(ROOT / "data" / "processed" / "housing_price.csv", index=False)
print(f"공시가격 있는 필지 {len(d):,} / {len(pnus):,}", "| 기준연도 분포:", d["year"].value_counts().head(4).to_dict() if len(d) else {})
