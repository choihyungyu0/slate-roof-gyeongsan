"""GIS건물통합정보(AL_D010, 경북) → 경산시(47290)만 필터 → data/interim/gs_buildings.gpkg (EPSG:5186).

컬럼명은 data/raw 의 「국가중점데이터_컬럼정의서(26.08.19)」 AL_D010 정의를 그대로 따른다.
"""
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pyogrio

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "raw" / "AL_D010_47"
OUT = ROOT / "data" / "interim" / "gs_buildings.gpkg"
SIGUNGU = "47290"

# 컬럼정의서(AL_D010) 기준
COLS = {
    "A0": "src_fid",        # 원천도형ID
    "A1": "gis_bld_id",     # GIS건물통합식별번호
    "A2": "PNU",            # 고유번호
    "A3": "bjd_cd",         # 법정동코드
    "A4": "bjd_nm",         # 법정동명
    "A5": "jibun",          # 지번
    "A6": "spcl_cd",        # 특수지코드
    "A7": "spcl_nm",        # 특수지구분명
    "A8": "purps_cd",       # 건축물용도코드
    "A9": "purps_nm",       # 건축물용도명
    "A10": "strct_cd",      # 건축물구조코드
    "A11": "strct_nm",      # 건축물구조명
    "A12": "arch_area",     # 건축물면적(㎡)
    "A13": "use_apr_day",   # 사용승인일자
    "A14": "tot_area",      # 연면적
    "A15": "plat_area",     # 대지면적(㎡)
    "A16": "height",        # 높이(m)
    "A17": "bc_rat",        # 건폐율(%)
    "A18": "vl_rat",        # 용적율(%)
    "A19": "bld_id",        # 건축물ID
    "A20": "viol_yn",       # 위반건축물여부
    "A21": "ref_key",       # 참조체계연계키
    "A22": "data_ymd",      # 데이터기준일자
    "A23": "src_sgg_cd",    # 원천시도시군구코드
    "A24": "bld_nm",        # 건물명
    "A25": "dong_nm",       # 건물동명
    "A26": "grnd_flr",      # 지상층_수
    "A27": "ugrnd_flr",     # 지하층_수
    "A28": "chg_ymd",       # 데이터생성변경일자
}


def main() -> None:
    parts = []
    for shp in sorted(SRC.glob("*.shp")):
        info = pyogrio.read_info(shp, encoding="cp949")
        g = gpd.read_file(shp, where=f"A2 LIKE '{SIGUNGU}%'", encoding="cp949", engine="pyogrio")
        print(f"{shp.name}: 전체 {info['features']:,} → 경산 {len(g):,}  crs={g.crs.to_epsg() if g.crs else None}")
        parts.append(g)
    gdf = pd.concat(parts, ignore_index=True)
    print("원본 CRS:", gdf.crs.name, "/ EPSG", gdf.crs.to_epsg())
    gdf = gdf.rename(columns=COLS).to_crs(5186)
    print("합계:", f"{len(gdf):,}", "| gis_bld_id 중복:", int(gdf["gis_bld_id"].duplicated().sum()),
          "| 도형 무효:", int((~gdf.geometry.is_valid).sum()), "| 빈 도형:", int(gdf.geometry.is_empty.sum()))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(OUT, driver="GPKG", layer="buildings")
    print("저장:", OUT)
    print("법정동 수:", gdf["bjd_cd"].nunique(), "| PNU 길이 분포:", gdf["PNU"].str.len().value_counts().to_dict())
    print("용도 상위:", gdf["purps_nm"].value_counts(dropna=False).head(12).to_dict())
    print("데이터기준일자:", gdf["data_ymd"].value_counts().head(3).to_dict())
    print("ref_key 결측:", int(gdf["ref_key"].isna().sum()), "| bld_id 결측:", int(gdf["bld_id"].isna().sum()))
    print(gdf.drop(columns="geometry").head(3).T.to_string())


if __name__ == "__main__":
    main()
