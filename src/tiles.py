"""브이월드 WMTS 항공영상 타일 캐시 + 건물 폴리곤 지붕 크롭.

- 타일은 data/interim/tiles/{z}/{x}/{y}.jpeg 로 캐시, 새 요청 사이 0.25초 대기
- 크롭: 폴리곤 외접 사각형에 여백을 더한 정사각형 → size×size 로 리샘플
"""
import math
import os
import time
from io import BytesIO
from pathlib import Path

import requests
from dotenv import load_dotenv
from PIL import Image
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
TILE_DIR = ROOT / "data" / "interim" / "tiles"
TILE = 256
SLEEP = 0.25
R = 6378137.0
ORIGIN = math.pi * R

load_dotenv(ROOT / ".env")
_KEY = os.environ.get("VWORLD_KEY", "").strip()
_to3857 = Transformer.from_crs(5186, 3857, always_xy=True)
_session = requests.Session()
fetched = 0  # 이번 실행에서 새로 받은 타일 수


def get_tile(z: int, x: int, y: int) -> Image.Image | None:
    global fetched
    f = TILE_DIR / str(z) / str(x) / f"{y}.jpeg"
    if not f.exists():
        url = f"https://api.vworld.kr/req/wmts/1.0.0/{_KEY}/Satellite/{z}/{y}/{x}.jpeg"
        try:
            r = _session.get(url, timeout=30)
        except requests.RequestException:
            return None
        time.sleep(SLEEP)
        if r.status_code != 200 or not r.headers.get("Content-Type", "").startswith("image"):
            return None
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(r.content)
        fetched += 1
    try:
        return Image.open(BytesIO(f.read_bytes())).convert("RGB")
    except OSError:
        return None


def _px(mx: float, my: float, z: int) -> tuple[float, float]:
    """EPSG:3857 좌표 → 줌 z 전역 픽셀 좌표."""
    res = 2 * ORIGIN / (TILE * 2**z)
    return (mx + ORIGIN) / res, (ORIGIN - my) / res


def crop_polygon(geom, z: int = 19, margin_m: float = 2.0, size: int = 224) -> Image.Image | None:
    """EPSG:5186 폴리곤 → 지붕 크롭 이미지. 타일을 못 받으면 None."""
    minx, miny, maxx, maxy = geom.bounds
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    half = max(maxx - minx, maxy - miny) / 2 + margin_m
    xs, ys = _to3857.transform([cx - half, cx + half, cx - half, cx + half],
                               [cy - half, cy - half, cy + half, cy + half])
    px0, py0 = _px(min(xs), max(ys), z)
    px1, py1 = _px(max(xs), min(ys), z)
    tx0, ty0, tx1, ty1 = int(px0 // TILE), int(py0 // TILE), int(px1 // TILE), int(py1 // TILE)
    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * TILE, (ty1 - ty0 + 1) * TILE))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            t = get_tile(z, tx, ty)
            if t is None:
                return None
            canvas.paste(t, ((tx - tx0) * TILE, (ty - ty0) * TILE))
    box = (px0 - tx0 * TILE, py0 - ty0 * TILE, px1 - tx0 * TILE, py1 - ty0 * TILE)
    return canvas.crop(tuple(round(v) for v in box)).resize((size, size), Image.BICUBIC)
