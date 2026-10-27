"""행정안전부 행정동별(통반단위) 성/연령별 주민등록 인구수 → 경산시 행정동별 65세 이상 비율.

API: apis.data.go.kr/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn (BLD_API_KEY, 키 값 출력 안 함)
lv=3(행정동 합계)로 경산시(4729000000) 행정동별 연령 인구를 받아 65세 이상 비율을 계산한다.
  python src/fetch_population.py --check   # 키 등록 여부만 확인
출력: data/processed/elderly_by_admdong.csv
"""
import json
import os
import sys
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
KEY = os.environ["BLD_API_KEY"]
URL = "https://apis.data.go.kr/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn"


def call(ym: str, page: int = 1):
    r = requests.get(URL, params={"serviceKey": KEY, "admmCd": "4729000000", "srchFrYm": ym, "srchToYm": ym, "lv": "3",
                                  "regSeCd": "1", "type": "JSON", "numOfRows": 100, "pageNo": page}, timeout=40)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code} " + ("미등록 키" if "NOT_REGISTERED" in r.text else r.text[:120].replace(KEY, "***")))
    return r.json()


if __name__ == "__main__":
    yms = [f"{y}{m:02d}" for y in (2026, 2025) for m in range(12, 0, -1)]
    js, ym = None, None
    for ym in yms:
        try:
            js = call(ym)
        except RuntimeError as e:
            print("NOT READY:", e); sys.exit(2)
        items = (js.get("Response") or js.get("response") or {}).get("items") or {}
        if items:
            break
    if "--check" in sys.argv:
        print("OK", ym, json.dumps(js, ensure_ascii=False)[:600]); sys.exit(0)
    print(json.dumps(js, ensure_ascii=False)[:1500])


def build(ym: str) -> pd.DataFrame:
    rows = (call(ym)["Response"]["items"]["item"])
    rows = [rows] if isinstance(rows, dict) else rows
    out = []
    for r in rows:
        tot = int(r["totNmprCnt"])
        old = sum(int(r.get(f"{s}{a}AgeNmprCnt") or 0) for s in ("male", "feml") for a in (70, 80, 90, 100))
        s60 = sum(int(r.get(f"{s}60AgeNmprCnt") or 0) for s in ("male", "feml"))
        out.append({"admmCd": r.get("admmCd"), "dongNm": r["dongNm"], "ym": ym, "total": tot, "age70p": old, "age60s": s60,
                    "ratio70p": round(old / tot * 100, 1) if tot else None})
    return pd.DataFrame(out)
