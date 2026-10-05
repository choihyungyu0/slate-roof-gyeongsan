# 프로젝트: 지붕 아래 사람 — 경산 석면 슬레이트 지붕 AI 탐지
공모전: 제3회 미래융합인재 발굴 SW 챌린지 (AI 및 빅데이터 분야)
서류 마감 2026-10-07, 본선 시연 2026-10-28.
목표: 경산시(시군구코드 47290) 주택 중 석면 슬레이트 지붕 후보를 항공영상 AI로 찾고,
건축물대장 지붕 정보와 비교해 "숨은 슬레이트"와 "대장 미갱신"을 찾아낸다.

## 0. 환경 설정
- 프로젝트 루트의 .env. 키 값은 절대 출력·커밋하지 말 것. .gitignore 에 .env, data/ 포함
  - VWORLD_KEY   : 브이월드 개발키 (WMTS/WMS/2D데이터/지오코더/배경지도 허용, 서비스URL http://localhost:3000)
  - BLD_API_KEY  : 공공데이터포털 일반 인증키(Decoding). 건축HUB 건축물대장정보 서비스용
- Python 가상환경(.venv, 이 PC는 3.14만 설치되어 3.14 사용): geopandas, pyogrio, shapely, rasterio, pyproj,
  requests, python-dotenv, pandas, numpy, pillow, timm, torch(CPU), scikit-learn, matplotlib, tqdm
- 폴더: data/raw, data/interim, data/processed, outputs/maps, outputs/figs, reports, src

## 1. 입력 데이터
1) data/raw/ 안의 GIS건물통합정보 경상북도 SHP zip (브이월드, 기준일 2026-09-09)
   - 압축 해제 후 PNU 앞 5자리 47290(경산시)만 필터 → data/interim/gs_buildings.gpkg
   - 컬럼 정의서가 없으면 컬럼명·샘플 값을 출력해서 각 컬럼 의미를 추정하지 말고 사용자에게 보고
   - 좌표계 확인(Bessel TM 계열일 수 있음) 후 EPSG:5186으로 통일
2) 건축물대장 표제부 API (BLD_API_KEY)
   - Base: https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo
   - 파라미터: serviceKey, sigunguCd=47290, bjdongCd(5자리), numOfRows=100, pageNo, _type=json
     (bun, ji 생략 시 법정동 전체 조회 가능한지 먼저 1건으로 테스트하고 결과 보고)
   - 법정동 목록은 1)의 PNU 6~10자리에서 추출
   - 개발계정 일일 트래픽 10,000건. 호출 간 0.2초 이상 쉬고, 진행상황을 data/interim/ 에 캐시해서 재실행 시 이어받기
   - 필요한 필드: mgmBldrgstPk, platPlc, bun, ji, sigunguCd, bjdongCd, mainPurpsCdNm, etcPurps,
     strctCdNm, roofCdNm, etcRoof, useAprDay, archArea, grndFlrCnt
   - 저장: data/interim/title_47290.parquet
3) 브이월드 항공영상 WMTS (VWORLD_KEY)
   - https://api.vworld.kr/req/wmts/1.0.0/{VWORLD_KEY}/Satellite/{z}/{y}/{x}.jpeg
   - 1단계는 읍면 1곳(자인면 우선, 슬레이트 건수가 적으면 건수가 가장 많은 읍면)만, 줌 18~19
   - 요청 간 간격을 두고, 받은 타일은 캐시. 대량 수집 금지

## 2. 1단계 작업 (서류용)
A. 지붕 값 확인 (가장 먼저)
   - roofCdNm, etcRoof 의 고유값과 빈도를 출력
   - "슬레이트"가 어떤 형태로 들어있는지 보고 (코드명/자유텍스트/오탈자 등). 추측 금지
B. 슬레이트 주택 집계
   - 주용도가 단독주택·다가구·다세대 등 주택류이고 지붕이 슬레이트인 건물
   - 읍면동별 건수, 사용승인연도 분포 → data/processed/slate_by_dong.csv
   - 경산시 2026년 슬레이트 지원 물량(주택 철거 95동)으로 나누면 몇 년 걸리는지 계산
C. 공간 조인
   - 표제부 ↔ 건물 폴리곤 조인 (PNU 또는 건축물대장 PK 기준, 가능한 키를 찾아서)
   - 매칭률을 반드시 보고. 매칭 안 된 건물 수도 보고
D. 지도
   - 읍면동별 슬레이트 주택 수 단계구분도(흑백 계열, 범례·축척·방위·출처 표기) → outputs/maps/slate_choropleth.png
   - 건물 단위 점지도(슬레이트 주택만) → outputs/maps/slate_points.png
   - 같은 레이어를 QGIS 프로젝트로 저장 → outputs/maps/slate.qgz
E. 소규모 분류 시험 (읍면 1곳)
   - 건물 폴리곤으로 지붕 이미지 크롭(여백 2m, 224px 정사각)
   - 라벨: 대장 슬레이트=1, 같은 읍면의 다른 주택=0 (약한 라벨임을 보고서에 명시). 클래스 균형 맞추기
   - timm 사전학습 모델(efficientnet_b0 등) 특징 + 로지스틱 회귀, 5-fold 교차검증
   - precision / recall / F1 / ROC-AUC / 혼동행렬을 있는 그대로 보고. 수치 부풀리지 말 것
   - "대장=슬레이트인데 모델=아님" 상위 20개, "대장=아님인데 모델=슬레이트" 상위 20개를 이미지 그리드로 저장
     → outputs/figs/disagree_*.png (숨은 슬레이트 / 대장 미갱신 후보 근거 자료)
F. 보고서 reports/stage1.md
   - 데이터 출처·기준일, 건수, 매칭률, 성능, 한계(색칠된 슬레이트, 그림자, 라벨 노이즈, 무허가 건축물 누락)
   - 소개서에 바로 쓸 핵심 수치 5개를 맨 위에 요약

## 3. 원칙
- 확인 안 된 값은 "미확인"으로 표기. 그럴듯한 숫자를 만들어내지 말 것
- 소유자 등 개인정보는 다루지 않음. 공개 산출물은 건물 위치 또는 읍면동 집계까지만
- 각 단계(A~F)가 끝날 때마다 산출물 경로와 핵심 수치를 짧게 보고하고 다음으로 진행
- A에서 슬레이트 값이 거의 없거나 판별 불가하면 즉시 멈추고 보고

## 4. 2단계 (본선용, 나중에 별도 지시)
Next.js + MapLibre 웹 데모: 브이월드 항공영상 위에 후보 지붕 표시, 우선순위 점수
(노후도·면적·학교/경로당 거리), 읍면동 담당자용 "찾아가는 신청 목록" 화면, Vercel 배포.
