"""소개서용 그림 2장 (흑백, 300dpi).

- proposal_fig1.png: 읍면동별 대장 슬레이트 주택 수 단계구분도
- proposal_fig2.png: 대장과 영상이 다른 지붕 예시 3컷 (주소·지번 없음). 참고용 컬러판 proposal_fig2_color.png
  예시 3동은 자인면 후보 영상을 육안으로 보고 고른 것이며 현장 확인을 거치지 않았다.
"""
import os
from pathlib import Path

os.environ.setdefault("TILES_OFFLINE", "1")  # 예시 3동은 이미 받아 둔 타일만 사용

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from matplotlib.patches import Patch
from PIL import ImageDraw, ImageOps

import tiles

ROOT = Path(__file__).resolve().parents[1]
INT, PRO, FIG = ROOT / "data" / "interim", ROOT / "data" / "processed", ROOT / "outputs" / "figs"
plt.rcParams["font.family"] = "Malgun Gothic"

BREAKS = [0, 25, 100, 600, 800, 1100]
LABELS = ["24동 이하", "25–99동", "100–599동", "600–799동", "800동 이상"]
GREYS = ["#ffffff", "#d9d9d9", "#a6a6a6", "#6e6e6e", "#2b2b2b"]

# ---------- 그림 1 ----------
emd = gpd.read_file(ROOT / "outputs" / "maps" / "slate_layers.gpkg", layer="emd_slate")
emd["cls"] = pd.cut(emd["slate_houses"], BREAKS, right=False, labels=False)
fig, ax = plt.subplots(figsize=(6.3, 6.6), dpi=300)
emd.plot(ax=ax, color=[GREYS[c] for c in emd["cls"]], edgecolor="k", linewidth=0.5)
for _, r in emd[emd.geometry.area > 4e6].iterrows():
    p = r.geometry.representative_point()
    ax.text(p.x, p.y, f"{r['emd_kor_nm']}\n{r['slate_sure']:,}~{r['slate_houses']:,}", ha="center", va="center", fontsize=6.5,
            color="w" if r["cls"] >= 3 else "k", fontweight="bold")
x0, y0, x1, y1 = emd.total_bounds
bx, by = x0 + (x1 - x0) * 0.02, y0 + (y1 - y0) * 0.03
ax.plot([bx, bx + 5000], [by, by], color="k", lw=2.5, solid_capstyle="butt")
ax.text(bx, by + 500, "0", ha="center", fontsize=6.5)
ax.text(bx + 5000, by + 500, "5 km", ha="center", fontsize=6.5)
nx, ny = x1 - (x1 - x0) * 0.04, y1 - (y1 - y0) * 0.03
ax.annotate("N", xy=(nx, ny), xytext=(nx, ny - (y1 - y0) * 0.08), ha="center", va="center", fontsize=9, fontweight="bold",
            arrowprops=dict(arrowstyle="-|>", color="k", lw=1.2))
ax.legend(handles=[Patch(facecolor=GREYS[i], edgecolor="k", label=LABELS[i]) for i in range(5)], title="슬레이트 주택 수(최대)",
          loc="lower right", frameon=True, edgecolor="k", fontsize=7, title_fontsize=7.5)
ax.set_axis_off()
ax.set_aspect("equal")
ax.set_title(f"경산시 읍면동별 대장 슬레이트 주택 수 (확실 {int(emd['slate_sure'].sum()):,} ~ 최대 {int(emd['slate_houses'].sum()):,}동)", fontsize=10, fontweight="bold", loc="left")
fig.text(0.02, 0.012, "자료: 국토교통부 건축HUB 건축물대장 표제부(2026-10-05 조회), 브이월드 법정 읍면동 경계.\n"
         "대장 지붕 기재 정규화 결과(현장 미확인). 확실=슬레이트 단독 기재, 최대=혼합 기재 포함. 지도 숫자는 확실~최대. 미등재 건축물 제외.", fontsize=5.8, color="#222", va="bottom")
fig.subplots_adjust(left=0.02, right=0.98, top=0.95, bottom=0.07)
fig.savefig(FIG / "proposal_fig1.png", facecolor="w")
plt.close(fig)

# ---------- 그림 2 ----------
# (GIS건물통합식별번호, 제목, 대장 기재) — 육안으로 고른 예시
EXAMPLES = [
    ("1930182890592562295300000000", "① 코드는 기와, 자유기재에 스레트", "대장 지붕코드: 기와\n대장 자유기재: 기와/스레트"),
    ("1979183474312587441800000000", "② 대장은 슬레이트, 영상은 다른 지붕", "대장: 슬레이트(스레트)\n영상: 칼라강판으로 보이는 지붕"),
    ("1989184680092569745000000000", "③ 대장과 영상이 같은 경우", "대장: 슬레이트(스레트)\n영상: 슬레이트로 보이는 지붕"),
]
t = pd.read_parquet(PRO / "title_joined.parquet").set_index("gis_bld_id")
geom = gpd.read_file(INT / "gs_buildings.gpkg")[["gis_bld_id", "geometry"]].drop_duplicates("gis_bld_id").set_index("gis_bld_id").geometry
for g, _, _ in EXAMPLES:  # 캡션과 대장 기재가 어긋나지 않는지 확인
    print(g[-10:], t.loc[g, ["roofCdNm", "etcRoof", "emd_nm"]].tolist())
assert t.loc[EXAMPLES[0][0], "roofCdNm"] == "기와" and t.loc[EXAMPLES[0][0], "etcRoof"] == "기와/스레트"
assert all(t.loc[g, "roofCdNm"] == "슬레이트" and t.loc[g, "etcRoof"] == "스레트" for g, _, _ in EXAMPLES[1:])

for name, gray in (("proposal_fig2.png", True), ("proposal_fig2_color.png", False)):
    fig, axes = plt.subplots(1, 3, figsize=(7.2, 3.35), dpi=300)
    for ax, (g, title, cap) in zip(axes, EXAMPLES):
        im, ring = tiles.crop_context(geom[g], z=19, margin_m=5.0, size=600)
        if gray:
            im = ImageOps.grayscale(im).convert("RGB")
        d = ImageDraw.Draw(im)
        d.line(ring, fill=(0, 0, 0), width=6)
        d.line(ring, fill=(255, 255, 255), width=2)
        ax.imshow(im)
        ax.set_title(title, fontsize=8, fontweight="bold")
        ax.set_xlabel(cap, fontsize=7.2, labelpad=5)
        ax.set_xticks([]), ax.set_yticks([])
    fig.text(0.5, 0.012, "자료: 브이월드 항공영상(국토교통부), 건축물대장 표제부(2026-10-05 조회). 경산시 자인면 주택 예시, 흰 선은 건물 도형.\n"
             "영상 해석은 육안 판독이며 현장 확인을 거치지 않음.", ha="center", va="bottom", fontsize=5.8, color="#222")
    fig.subplots_adjust(left=0.01, right=0.99, top=0.93, bottom=0.2, wspace=0.04)
    fig.savefig(FIG / name, facecolor="w")
    plt.close(fig)
print("저장:", *(p.name for p in sorted(FIG.glob("proposal_*"))))
