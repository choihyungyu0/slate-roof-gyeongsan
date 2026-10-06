"""건축HUB 건축인허가정보 API에서 경산시(47290) 대수선·철거멸실관리대장을 법정동 단위로 수집.

  python src/fetch_permit.py --check     # 키가 이 서비스에 등록됐는지만 확인
  python src/fetch_permit.py             # 수집(페이지 캐시, 이어받기)
캐시: data/interim/permit_pages/{op}/{bjdong}_{page}.json → data/interim/permit_{op}.parquet
키 값은 출력하지 않는다.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import pandas as pd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
INT = ROOT / "data" / "interim"
BASE = "https://apis.data.go.kr/1613000/ArchPmsHubService"
OPS = {"imprpr": "getApImprprInfo", "demol": "getApDemolExtngMgmRgstInfo"}
SIGUNGU, ROWS, SLEEP = "47290", 100, 0.25
load_dotenv(ROOT / ".env")
KEY = os.environ.get("BLD_API_KEY", "").strip()


def call(op: str, bjdong: str, page: int, rows: int = ROWS):
    params = {"serviceKey": KEY, "sigunguCd": SIGUNGU, "bjdongCd": bjdong, "numOfRows": rows, "pageNo": page, "_type": "json"}
    err = ""
    for attempt in range(3):
        try:
            r = requests.get(f"{BASE}/{op}", params=params, timeout=40)
        except requests.RequestException as e:
            err = type(e).__name__
        else:
            if r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    err = "non-JSON"
            else:
                err = f"HTTP {r.status_code} " + ("미등록 키" if "NOT_REGISTERED" in r.text else "")
                if r.status_code == 403:
                    break
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"{op} {bjdong} p{page} 실패 — {err}")


def items(js: dict) -> tuple[list[dict], int]:
    resp = js.get("response", {})
    if str(resp.get("header", {}).get("resultCode")) not in ("00", "0"):
        raise RuntimeError(f"API 오류 응답: {resp.get('header')}")
    body = resp.get("body") or {}
    it = body.get("items") or {}
    it = it.get("item", []) if isinstance(it, dict) else []
    return ([it] if isinstance(it, dict) else it), int(body.get("totalCount") or 0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if not KEY:
        sys.exit(".env 에 BLD_API_KEY 가 없습니다")
    if args.check:
        try:
            for name, op in OPS.items():
                it, total = items(call(op, "10900", 1, rows=1))
                print(name, "OK total", total, "| fields:", sorted(it[0].keys()) if it else None)
        except RuntimeError as e:
            print("NOT READY:", e)
            sys.exit(2)
        return
    import geopandas as gpd

    dongs = sorted(gpd.read_file(INT / "gs_buildings.gpkg", columns=["PNU"], ignore_geometry=True)["PNU"].astype(str).str[5:10].unique())
    for name, op in OPS.items():
        d = INT / "permit_pages" / name
        d.mkdir(parents=True, exist_ok=True)
        rows, calls = [], 0
        for b in dongs:
            page, total = 1, None
            while total is None or (page - 1) * ROWS < total:
                f = d / f"{b}_{page:04d}.json"
                if f.exists():
                    js = json.loads(f.read_text(encoding="utf-8"))
                else:
                    js = call(op, b, page)
                    calls += 1
                    time.sleep(SLEEP)
                    f.write_text(json.dumps(js, ensure_ascii=False), encoding="utf-8")
                it, total = items(js)
                rows += it
                page += 1
        df = pd.DataFrame(rows)
        for c in df.columns:
            df[c] = df[c].map(lambda v: "" if v is None else str(v))
        df.to_parquet(INT / f"permit_{name}.parquet", index=False)
        print(f"{name}: {len(df):,}건 (새 호출 {calls})")


if __name__ == "__main__":
    main()
