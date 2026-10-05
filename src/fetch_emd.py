"""브이월드 2D데이터 API(LT_C_ADEMD_INFO, 법정 읍면동 경계)에서 경산시(47290)만 받아 저장.

→ data/interim/gs_emd.gpkg (EPSG:5186). 요청은 페이지당 1회, 1초 간격.
"""
import os
import time
from pathlib import Path

import geopandas as gpd
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "interim" / "gs_emd.gpkg"
load_dotenv(ROOT / ".env")
KEY = os.environ["VWORLD_KEY"]


def main() -> None:
    feats, page = [], 1
    while True:
        r = requests.get("https://api.vworld.kr/req/data", params={
            "service": "data", "request": "GetFeature", "data": "LT_C_ADEMD_INFO", "key": KEY,
            "domain": os.environ.get("VWORLD_DOMAIN", "http://localhost:3000"), "attrFilter": "emd_cd:like:47290",
            "format": "json", "size": 1000, "page": page, "crs": "EPSG:5186", "geometry": "true",
        }, timeout=60)
        js = r.json()["response"]
        if js.get("status") != "OK":
            raise SystemExit(f"브이월드 응답 오류: {js.get('status')} {js.get('error')}")
        feats += js["result"]["featureCollection"]["features"]
        if page >= int(js["page"]["total"]):
            break
        page += 1
        time.sleep(1)
    gdf = gpd.GeoDataFrame.from_features(feats, crs=5186)
    gdf.to_file(OUT, driver="GPKG", layer="emd")
    print(f"저장: {OUT}  {len(gdf)}개")
    print(gdf.drop(columns="geometry").to_string())


if __name__ == "__main__":
    main()
