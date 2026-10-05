"""건축물대장 표제부(getBrTitleInfo) 경산시(47290) 수집.

사용:
  python src/fetch_title.py --test 25010        # 법정동 1곳·1건만 호출해 bun/ji 생략 조회 가능 여부 확인
  python src/fetch_title.py                     # gs_buildings.gpkg 의 법정동 전체 수집 (이어받기)

- 페이지 단위 응답을 data/interim/title_pages/{bjdong}_{page}.json 으로 캐시 → 재실행 시 이어받기
- 일일 트래픽(개발계정 10,000건) 보호: 실행당 호출 수 상한(--max-calls), 호출 간 0.25초 대기
- 키 값은 로그·예외 메시지에 출력하지 않는다
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
INTERIM = ROOT / "data" / "interim"
PAGES = INTERIM / "title_pages"
OUT = INTERIM / "title_47290.parquet"
BASE = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo"
SIGUNGU = "47290"
ROWS = 100
SLEEP = 0.25
FIELDS = [
    "mgmBldrgstPk", "platPlc", "bun", "ji", "sigunguCd", "bjdongCd", "platGbCd",
    "mainPurpsCdNm", "etcPurps", "strctCdNm", "roofCdNm", "etcRoof",
    "useAprDay", "archArea", "grndFlrCnt",
    "roofCd", "regstrKindCdNm", "mainAtchGbCdNm", "totArea",
]

load_dotenv(ROOT / ".env")
KEY = os.environ.get("BLD_API_KEY", "").strip()


def call(bjdong: str, page: int, rows: int = ROWS) -> dict:
    params = {
        "serviceKey": KEY, "sigunguCd": SIGUNGU, "bjdongCd": bjdong,
        "numOfRows": rows, "pageNo": page, "_type": "json",
    }
    for attempt in range(3):
        try:
            r = requests.get(BASE, params=params, timeout=30)
        except requests.RequestException as e:
            # 예외 문자열에 URL(키 포함)이 들어가므로 종류만 남긴다
            err = type(e).__name__
        else:
            if r.status_code == 200:
                try:
                    return r.json()
                except ValueError:
                    err = "non-JSON: " + r.text[:200].replace(KEY, "***")
            else:
                err = f"HTTP {r.status_code}: " + r.text[:200].replace(KEY, "***")
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"bjdong={bjdong} page={page} 실패 — {err}")


def parse(js: dict) -> tuple[list[dict], int]:
    resp = js.get("response", {})
    header = resp.get("header", {})
    if str(header.get("resultCode")) not in ("00", "0"):
        raise RuntimeError(f"API 오류 응답: {header}")
    body = resp.get("body", {}) or {}
    total = int(body.get("totalCount") or 0)
    items = body.get("items") or {}
    item = items.get("item", []) if isinstance(items, dict) else []
    if isinstance(item, dict):
        item = [item]
    return item, total


def bjdong_list() -> list[str]:
    import geopandas as gpd

    gdf = gpd.read_file(INTERIM / "gs_buildings.gpkg", columns=["PNU"], ignore_geometry=True)
    return sorted(gdf["PNU"].astype(str).str[5:10].unique())


def build_parquet() -> None:
    rows = []
    for f in sorted(PAGES.glob("*.json")):
        items, _ = parse(json.loads(f.read_text(encoding="utf-8")))
        rows.extend(items)
    df = pd.DataFrame(rows)
    keep = [c for c in FIELDS if c in df.columns]
    missing = [c for c in FIELDS if c not in df.columns]
    # PK 등 숫자·문자가 섞여 오는 필드가 있어 면적·층수 외에는 문자열로 통일
    num = ["archArea", "totArea", "grndFlrCnt"]
    df = df[keep].copy()
    for c in df.columns:
        df[c] = pd.to_numeric(df[c], errors="coerce") if c in num else df[c].map(lambda v: "" if v is None else str(v))
    df = df.drop_duplicates(subset="mgmBldrgstPk")
    df.to_parquet(OUT, index=False)
    print(f"저장: {OUT}  {len(df):,}행  (응답에 없는 필드: {missing or '없음'})")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", metavar="BJDONG", help="법정동 1곳을 1건만 조회해 응답 구조 확인")
    ap.add_argument("--max-calls", type=int, default=9000)
    args = ap.parse_args()
    if not KEY:
        sys.exit(".env 에 BLD_API_KEY 가 없습니다")

    if args.test:
        js = call(args.test, 1, rows=1)
        items, total = parse(js)
        print(f"bun/ji 생략 조회: totalCount={total}, 반환 {len(items)}건")
        if items:
            print("응답 필드:", sorted(items[0].keys()))
            print({k: items[0].get(k) for k in FIELDS})
        return

    PAGES.mkdir(parents=True, exist_ok=True)
    calls = 0
    dongs = bjdong_list()
    print(f"법정동 {len(dongs)}곳")
    for d in dongs:
        page, total = 1, None
        while total is None or (page - 1) * ROWS < total:
            f = PAGES / f"{d}_{page:04d}.json"
            if f.exists():
                js = json.loads(f.read_text(encoding="utf-8"))
            else:
                if calls >= args.max_calls:
                    print(f"호출 상한 {args.max_calls} 도달 — 중단 (다시 실행하면 이어받음)")
                    return
                js = call(d, page)
                calls += 1
                time.sleep(SLEEP)
            _, total = parse(js)
            if not f.exists():
                f.write_text(json.dumps(js, ensure_ascii=False), encoding="utf-8")
            page += 1
        print(f"  {d}: {total:,}건  (누적 호출 {calls})")
    build_parquet()


if __name__ == "__main__":
    main()
