"""D. 지도: 읍면동 단계구분도·슬레이트 주택 점지도(PNG, 흑백) + QGIS 프로젝트(.qgz).

출력: outputs/maps/slate_choropleth.png, slate_points.png, slate_layers.gpkg, slate.qgz
"""
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.patches import Patch

ROOT = Path(__file__).resolve().parents[1]
INT, PRO, OUT = ROOT / "data" / "interim", ROOT / "data" / "processed", ROOT / "outputs" / "maps"
OUT.mkdir(parents=True, exist_ok=True)
plt.rcParams["font.family"] = "Malgun Gothic"
plt.rcParams["axes.unicode_minus"] = False

SOURCE = ("자료: 국토교통부 건축HUB 건축물대장 표제부(2026-10-05 조회), 브이월드 GIS건물통합정보(기준일 2026-09-09)·법정 읍면동 경계\n"
          "대장 지붕 기재 정규화 결과(주택류). 확실=슬레이트 단독 기재, 최대=혼합 기재(예: 기와/스레트) 포함. 지도 숫자는 확실~최대. 미등재 건축물 제외")
GREYS = ["#ffffff", "#d9d9d9", "#a6a6a6", "#6e6e6e", "#2b2b2b"]


def decorations(ax, gdf) -> None:
    """축척 막대·방위표·출처."""
    x0, y0, x1, y1 = gdf.total_bounds
    w = x1 - x0
    bar = 5000  # m (EPSG:5186 은 미터 단위)
    bx, by = x0 + w * 0.03, y0 + (y1 - y0) * 0.03
    ax.plot([bx, bx + bar], [by, by], color="k", lw=3, solid_capstyle="butt")
    ax.plot([bx, bx + bar / 2], [by, by], color="w", lw=1.4, solid_capstyle="butt")
    ax.text(bx, by + w * 0.012, "0", ha="center", fontsize=8)
    ax.text(bx + bar, by + w * 0.012, "5 km", ha="center", fontsize=8)
    nx, ny = x1 - w * 0.05, y1 - (y1 - y0) * 0.04
    ax.annotate("N", xy=(nx, ny), xytext=(nx, ny - (y1 - y0) * 0.09), ha="center", va="center", fontsize=11, fontweight="bold",
                arrowprops=dict(arrowstyle="-|>", color="k", lw=1.5))
    ax.set_axis_off()
    ax.set_aspect("equal")
    ax.figure.text(0.02, 0.012, SOURCE, fontsize=7, color="#333", va="bottom")


# 계급 경계: 동 지역(수십 동)과 읍면 지역(수백 동)의 차이가 커서 분위수 대신 고정 경계를 쓴다
BREAKS = [0, 25, 100, 600, 800, 1100]
LABELS = ["24동 이하", "25–99동", "100–599동", "600–799동", "800동 이상"]


emd = gpd.read_file(INT / "gs_emd.gpkg")
by = pd.read_csv(PRO / "slate_by_dong.csv", dtype={"emd_cd": str})
emd = emd.merge(by.drop(columns="emd_nm"), on="emd_cd", how="left")
emd[["houses", "slate_sure", "slate_houses", "slate_main"]] = emd[["houses", "slate_sure", "slate_houses", "slate_main"]].fillna(0).astype(int)
pts = gpd.read_file(PRO / "slate_houses.gpkg", layer="points")

brk = [float(v) for v in BREAKS]
assert emd["slate_houses"].max() < BREAKS[-1]
k = len(brk) - 1
emd["cls"] = np.clip(np.searchsorted(brk, emd["slate_houses"], side="right") - 1, 0, k - 1)
colors = GREYS[-k:] if k < 5 else GREYS
labels = LABELS

# --- 단계구분도 ---
fig, ax = plt.subplots(figsize=(10, 9.2), dpi=200)
emd.plot(ax=ax, color=[colors[c] for c in emd["cls"]], edgecolor="k", linewidth=0.6)
big = emd[emd.geometry.area > 4e6]  # 좁은 동 지역은 글자가 겹쳐 생략
for _, r in big.iterrows():
    p = r.geometry.representative_point()
    dark = r["cls"] >= k - 2
    ax.text(p.x, p.y, f"{r['emd_kor_nm']}\n{r['slate_sure']:,}~{r['slate_houses']:,}", ha="center", va="center", fontsize=7.5,
            color="w" if dark else "k", fontweight="bold")
ax.legend(handles=[Patch(facecolor=colors[i], edgecolor="k", label=labels[i]) for i in range(k)],
          title="슬레이트 주택 수(최대, 대장 기준)", loc="lower right", frameon=True, edgecolor="k", fontsize=9, title_fontsize=9)
ax.set_title(f"경산시 읍면동별 대장 슬레이트 주택 수 — 확실 {int(emd['slate_sure'].sum()):,} ~ 최대 {int(emd['slate_houses'].sum()):,}동", fontsize=14, fontweight="bold", loc="left")
decorations(ax, emd)
fig.subplots_adjust(left=0.02, right=0.98, top=0.94, bottom=0.07)
fig.savefig(OUT / "slate_choropleth.png", facecolor="w")
plt.close(fig)

# --- 점지도 ---
fig, ax = plt.subplots(figsize=(10, 9.2), dpi=200)
emd.plot(ax=ax, color="w", edgecolor="#555", linewidth=0.5)
sure = pts["slate_sure"].astype(bool)
pts[~sure].plot(ax=ax, color="#9a9a9a", markersize=1.6, alpha=0.8, linewidth=0)
pts[sure].plot(ax=ax, color="k", markersize=1.6, alpha=0.8, linewidth=0)
for _, r in big.iterrows():
    p = r.geometry.representative_point()
    ax.text(p.x, p.y, r["emd_kor_nm"], ha="center", va="center", fontsize=7.5, color="#444",
            bbox=dict(boxstyle="round,pad=0.15", fc="w", ec="none", alpha=0.75))
ax.legend(handles=[plt.Line2D([], [], marker="o", ls="", color="k", markersize=4, label=f"슬레이트 단독 기재 ({int(sure.sum()):,}동)"),
                   plt.Line2D([], [], marker="o", ls="", color="#9a9a9a", markersize=4, label=f"혼합 기재 ({int((~sure).sum()):,}동)")],
          loc="lower right", frameon=True, edgecolor="k", fontsize=9)
ax.set_title(f"경산시 대장 슬레이트 주택 분포 — 건물 도형과 연결된 {len(pts):,}동", fontsize=14, fontweight="bold", loc="left")
decorations(ax, emd)
fig.subplots_adjust(left=0.02, right=0.98, top=0.94, bottom=0.07)
fig.savefig(OUT / "slate_points.png", facecolor="w")
plt.close(fig)

# --- QGIS 프로젝트 ---
gpkg = OUT / "slate_layers.gpkg"
gpkg.unlink(missing_ok=True)
emd.drop(columns="cls").to_file(gpkg, layer="emd_slate", driver="GPKG")
pts[["emd_nm", "mainPurpsCdNm", "roofCdNm", "roof_class", "year", "geometry"]].to_file(gpkg, layer="slate_points", driver="GPKG")

SRS = ("<spatialrefsys><proj4>+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs</proj4>"
       "<srid>5186</srid><authid>EPSG:5186</authid><description>Korea 2000 / Central Belt 2010</description>"
       "<projectionacronym>tmerc</projectionacronym><ellipsoidacronym>GRS80</ellipsoidacronym><geographicflag>false</geographicflag></spatialrefsys>")


def fill_symbol(name: str, rgb: str) -> str:
    return (f'<symbol type="fill" name="{name}" alpha="1" clip_to_extent="1"><layer class="SimpleFill" enabled="1" locked="0" pass="0">'
            f'<prop k="color" v="{rgb},255"/><prop k="outline_color" v="0,0,0,255"/><prop k="outline_width" v="0.2"/>'
            f'<prop k="style" v="solid"/><prop k="outline_style" v="solid"/></layer></symbol>')


def hex_rgb(h: str) -> str:
    return ",".join(str(int(h[i:i + 2], 16)) for i in (1, 3, 5))


ranges = "".join(f'<range lower="{brk[i]}" upper="{brk[i + 1]}" symbol="{i}" label="{escape(labels[i])}" render="true"/>' for i in range(k))
symbols = "".join(fill_symbol(str(i), hex_rgb(colors[i])) for i in range(k))
x0, y0, x1, y1 = emd.total_bounds


def maplayer(lid: str, name: str, layer: str, geom: str, renderer: str) -> str:
    return (f'<maplayer type="vector" geometry="{geom}" hasScaleBasedVisibilityFlag="0"><id>{lid}</id>'
            f'<datasource>./slate_layers.gpkg|layername={layer}</datasource><layername>{escape(name)}</layername>'
            f'<srs>{SRS}</srs><provider encoding="UTF-8">ogr</provider>{renderer}</maplayer>')


poly_r = (f'<renderer-v2 type="graduatedSymbol" attr="slate_houses" graduatedMethod="GraduatedColor" symbollevels="0" enableorderby="0" forceraster="0">'
          f'<ranges>{ranges}</ranges><symbols>{symbols}</symbols></renderer-v2>')
pt_r = ('<renderer-v2 type="singleSymbol" symbollevels="0" enableorderby="0" forceraster="0"><symbols>'
        '<symbol type="marker" name="0" alpha="0.8" clip_to_extent="1"><layer class="SimpleMarker" enabled="1" locked="0" pass="0">'
        '<prop k="name" v="circle"/><prop k="color" v="0,0,0,255"/><prop k="outline_style" v="no"/><prop k="size" v="0.9"/>'
        '<prop k="size_unit" v="MM"/></layer></symbol></symbols></renderer-v2>')
L1, L2 = "emd_slate_0001", "slate_points_0002"
qgs = f'''<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis projectname="경산시 슬레이트 지붕 주택" version="3.28.0-Firenze">
  <title>경산시 슬레이트 지붕 주택</title>
  <projectCrs>{SRS}</projectCrs>
  <layer-tree-group>
    <layer-tree-layer id="{L2}" name="슬레이트 주택(점)" source="./slate_layers.gpkg|layername=slate_points" providerKey="ogr" checked="Qt::Checked" expanded="1"/>
    <layer-tree-layer id="{L1}" name="읍면동별 슬레이트 주택 수" source="./slate_layers.gpkg|layername=emd_slate" providerKey="ogr" checked="Qt::Checked" expanded="1"/>
  </layer-tree-group>
  <mapcanvas name="theMapCanvas" annotationsVisible="1">
    <units>meters</units>
    <extent><xmin>{x0}</xmin><ymin>{y0}</ymin><xmax>{x1}</xmax><ymax>{y1}</ymax></extent>
    <rotation>0</rotation>
    <destinationsrs>{SRS}</destinationsrs>
  </mapcanvas>
  <projectlayers>
    {maplayer(L1, "읍면동별 슬레이트 주택 수", "emd_slate", "Polygon", poly_r)}
    {maplayer(L2, "슬레이트 주택(점)", "slate_points", "Point", pt_r)}
  </projectlayers>
  <layerorder><layer id="{L1}"/><layer id="{L2}"/></layerorder>
  <properties><Paths><Absolute type="bool">false</Absolute></Paths></properties>
</qgis>
'''
import xml.dom.minidom

xml.dom.minidom.parseString(qgs.split("\n", 1)[1].encode("utf-8"))  # 문법 검증
with zipfile.ZipFile(OUT / "slate.qgz", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("slate.qgs", qgs)
print("계급 경계:", brk, labels)
print("저장:", *(p.name for p in sorted(OUT.iterdir())))
