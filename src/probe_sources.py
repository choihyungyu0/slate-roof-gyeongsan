"""추가 공공데이터가 이 프로젝트의 키로 실제 조회되는지 확인 (키 값은 출력하지 않음)."""
import os

import requests
from dotenv import load_dotenv

load_dotenv(".env")
V, B, D = os.environ["VWORLD_KEY"], os.environ["BLD_API_KEY"], os.environ["VWORLD_DOMAIN"]


def show(n, r):
    t = r.text.replace(V, "***").replace(B, "***")
    print(n, r.status_code, t[:300].replace("\n", " "))


# 개별주택가격 (브이월드 국가중점 데이터)
r = requests.get("https://api.vworld.kr/ned/data/getIndvdHousingPriceAttr",
                 params={"key": V, "domain": D, "pnu": "4729025321100760000", "format": "json", "numOfRows": 3, "pageNo": 1}, timeout=30)
show("vworld-housing", r)
# 개별주택가격 (공공데이터포털 국토교통부 서비스)
r = requests.get("https://apis.data.go.kr/1611000/nsdi/IndvdHousingPriceService/attr/getIndvdHousingPriceAttr",
                 params={"serviceKey": B, "pnu": "4729025321100760000", "format": "json", "numOfRows": 3, "pageNo": 1}, timeout=30)
show("datagokr-housing", r)
# 주민등록 연령별 인구 (행정안전부)
for u in ["https://apis.data.go.kr/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn",
          "https://apis.data.go.kr/1741000/stdgSexdAgePpltn/selectStdgSexdAgePpltn"]:
    r = requests.get(u, params={"serviceKey": B, "admmCd": "4729025000", "stdgCd": "4729025000", "srchFrYm": "202609", "srchToYm": "202609",
                                "lv": "3", "regSeCd": "1", "type": "JSON", "numOfRows": 5, "pageNo": 1}, timeout=30)
    show("pop " + u.split("/")[-1], r)
