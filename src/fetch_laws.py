"""근거 법령 조문을 국가법령정보센터 Open API로 조회해 정적 JSON으로 저장 (빌드 전에 1회 실행).

- 조문 번호·제목은 API 응답 그대로 쓴다. 못 찾은 항목은 넣지 않고 화면에 출력해 보고한다.
- 인증값 OC는 .env 의 LAW_OC. 신청 시 등록한 도메인을 Referer로 보낸다. 값은 출력하지 않는다.
출력: web/public/data/legal_basis.json
"""
import datetime as dt
import json
import os
import re
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
OC = os.environ["LAW_OC"]
H = {"Referer": "https://slate-roof-gyeongsan.vercel.app/"}
BASE = "http://www.law.go.kr/DRF"

# (법령명, 조문 고르는 방법, 쓰이는 곳)  방법: 조문 번호(정수) 또는 조문 제목·본문에서 찾을 정규식
TARGETS = [
    ("개인정보 보호법", 18, "명부·안내: 개인정보의 목적 외 이용·제공 제한"),
    ("석면안전관리법", r"슬레이트|비용 지원|비용의 지원", "안내문: 슬레이트 처리 지원"),
    ("사회보장급여의 이용ㆍ제공 및 수급권자 발굴에 관한 법률", r"발굴", "명부·안내: 지원대상자 발굴"),
]


def law_body(name: str) -> dict:
    s = requests.get(f"{BASE}/lawSearch.do", params={"OC": OC, "target": "law", "type": "JSON", "query": name, "display": 20}, headers=H, timeout=30).json()
    laws = s["LawSearch"].get("law") or []
    laws = laws if isinstance(laws, list) else [laws]
    hit = next(x for x in laws if x["법령명한글"] == name and x["현행연혁코드"] == "현행")
    b = requests.get(f"{BASE}/lawService.do", params={"OC": OC, "target": "law", "type": "JSON", "MST": hit["법령일련번호"]}, headers=H, timeout=60).json()
    return {"mst": hit["법령일련번호"], "id": hit.get("법령ID"), "body": b["법령"]}


def text(u) -> str:
    if isinstance(u, list):
        return " ".join(text(x) for x in u)
    if isinstance(u, dict):
        return " ".join(text(v) for v in u.values())
    return str(u or "")


out, missing = [], []
today = dt.date.today().isoformat()
for name, pick, use in TARGETS:
    try:
        lb = law_body(name)
    except (StopIteration, KeyError, ValueError) as e:
        missing.append(f"{name}: 법령을 찾지 못함 ({type(e).__name__})")
        continue
    arts = lb["body"]["조문"]["조문단위"]
    arts = [a for a in arts if a.get("조문여부") == "조문"]
    if isinstance(pick, int):
        sel = [a for a in arts if a["조문번호"] == str(pick) and not a.get("조문가지번호")]
    else:
        sel = [a for a in arts if re.search(pick, a.get("조문제목") or "")]
    if not sel:
        missing.append(f"{name}: '{pick}' 조문 없음")
    for a in sel:
        no = f"제{a['조문번호']}조" + (f"의{a['조문가지번호']}" if a.get("조문가지번호") else "")
        out.append({"law": name, "article": no, "title": a.get("조문제목") or "", "use": use, "fetched": today,
                    "url": f"https://www.law.go.kr/법령/{name}/{no}"})
(ROOT / "web" / "public" / "data" / "legal_basis.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
for o in out:
    print(o["law"], o["article"], o["title"])
print("못 찾음:", missing or "없음")
