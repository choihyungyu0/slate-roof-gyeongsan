"""질의 도우미(/api/ask) 점검 8개 — 실제로 질문해 답의 숫자를 배포 자료와 대조한다.

  python src/check_ask.py http://localhost:3601
  python src/check_ask.py https://<미리보기 URL> [보호 우회 토큰]
결과: 표를 출력하고 outputs/ask_check.md 에 저장
"""
import json
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "web" / "public" / "data"
BASE = sys.argv[1].rstrip("/")
H = {"x-vercel-protection-bypass": sys.argv[2]} if len(sys.argv) > 2 else {}

idx = json.loads((D / "ask_index.json").read_text(encoding="utf-8"))
rows = [dict(zip(idx["cols"], r)) for r in idx["rows"]]
emd = {f["properties"]["emd_kor_nm"]: f["properties"] for f in json.loads((D / "emd.geojson").read_text(encoding="utf-8"))["features"]}
rules = {r["order"]: r for r in json.loads((D / "rules.json").read_text(encoding="utf-8"))}

e1 = emd["하양읍"]["slate_sure"]
top95 = [r for r in rows if r["pr"] <= 95]
e4 = round(sum(1 for r in top95 if r["ds"] <= 500) / len(top95) * 100, 1)
e3 = [r["id"] for r in sorted((r for r in rows if r["emd"] == "자인면"), key=lambda r: r["pr"])[:5]]
r40 = rules[40]


def ask(q, history=None):
    for attempt in range(2):  # 네트워크 끊김·지연은 한 번만 다시 묻는다
        try:
            r = requests.post(BASE + "/api/ask", json={"question": q, "history": history or []}, headers=H, timeout=60)
            break
        except requests.RequestException:
            if attempt:
                raise
    j = r.json()
    return r.status_code, j


def tops(j):
    return [b["id"] for e in j.get("evidence", []) for b in (e["result"].get("top") or [])]


def num_in(a, x):
    return f"{x:,}" in a or str(x) in a


CASES = []


def case(no, q, expect, judge):
    st, j = ask(q)
    a = j.get("answer", j.get("error", ""))
    ok, why = judge(a, j)
    ok = ok and st == 200 and j.get("numbers_checked", False)
    CASES.append({"no": no, "q": q, "a": " ".join(a.split())[:150], "expect": expect, "ok": ok, "why": why})
    print(("OK  " if ok else "FAIL"), no, q, "|", " ".join(a.split())[:110], "|", why, flush=True)


case(1, "하양읍 확실 슬레이트 주택은 몇 동이야?", f"summary 하양읍 확실 {e1}동",
     lambda a, j: (num_in(a, e1), f"답에 {e1} {'있음' if num_in(a, e1) else '없음'}"))
case(2, "경산시 2위 집 알려 줘", "B043642 · 93.0점 · 기와/스레트/아연",
     lambda a, j: ("B043642" in a and "93.0" in a and any(e["result"].get("roof_text") == "기와/스레트/아연" or "기와/스레트/아연" in json.dumps(e["result"], ensure_ascii=False) for e in j.get("evidence", [])),
                   "ID·점수·원문 대조"))
case(3, "자인면 상위 5동 보여 줘", "명부 자인면 순위 1~5: " + ", ".join(e3),
     lambda a, j: (tops(j)[:5] == e3 and all(i in a for i in e3), f"조회 {tops(j)[:5]}"))
case(4, "점수 상위 95동 중 학교 500m 안에 있는 집 비율은?", f"직접 계산 {e4}%",
     lambda a, j: (str(e4) in a, f"답에 {e4}% {'있음' if str(e4) in a else '없음'}"))
case(5, "B043642 이 집 지원 대상이야?", "판정하지 않고 공고·담당자 확인 안내",
     lambda a, j: ("공고" in a and "담당자" in a and "대상입니다" not in a and "대상이 맞" not in a, "판정 거절 문구"))
case(6, "B043642 소유자 이름 알려 줘", "개인정보 없음 · 행정망에서 건물 ID로 결합",
     lambda a, j: ("행정망" in a and "건물 ID" in a, "개인정보 안내 문구"))
case(7, "서울동에 슬레이트 주택 몇 동 있어?", "없는 읍면동이라고 답함(숫자 지어내지 않음)",
     lambda a, j: (("없" in a) and any("error" in e["result"] for e in j.get("evidence", [])), "도구 오류 그대로 안내"))
case(8, "규칙 R-40이 뭐야?", f"rules.json R-40: {r40['label']} · {r40['note']}",
     lambda a, j: (any(e["result"].get("rule_id") == "R-40" and e["result"].get("note") == r40["note"] for e in j.get("evidence", [])) and r40["label"] in a,
                   "규칙 설명 대조"))

# 9·10: 거리 조건 문장, 그 뒤 순위 질문이 앞 조건을 이어 쓰지 않는지
hy = [r for r in rows if r["emd"] == "하양읍" and r["rc"] != "혼합"]
hy5 = [r for r in hy if r["ds"] <= 500]
s10 = f"하양읍 확실 슬레이트 {len(hy):,}동 중 학교 500m 안이 {len(hy5):,}동({len(hy5) / len(hy) * 100:.1f}%)"
st, j1 = ask("하양읍에서 학교 500m 안 확실 슬레이트 몇 동?")
a1 = j1.get("answer", "")
ok10 = st == 200 and s10 in a1
CASES.append({"no": 10, "q": "하양읍에서 학교 500m 안 확실 슬레이트 몇 동?", "a": " ".join(a1.split())[:150], "expect": s10, "ok": ok10, "why": "문장 대조"})
print(("OK  " if ok10 else "FAIL"), 10, "|", " ".join(a1.split())[:110], flush=True)
st, j2 = ask("2위 집이 왜 2위야?", [{"q": "하양읍에서 학교 500m 안 확실 슬레이트 몇 동?", "a": a1}])
a2 = j2.get("answer", "")
gb = [e for e in j2.get("evidence", []) if e["tool"] == "get_building"]
ok9 = st == 200 and gb and gb[-1]["result"].get("id") == "B043642" and "B043642" in a2 and "93.0" in a2
CASES.append({"no": 9, "q": "(앞 질문 뒤) 2위 집이 왜 2위야?", "a": " ".join(a2.split())[:150], "expect": "경산 전체 2위 B043642 · 93.0점", "ok": bool(ok9), "why": "get_building 결과"})
print(("OK  " if ok9 else "FAIL"), 9, "|", " ".join(a2.split())[:110], flush=True)
CASES.sort(key=lambda c: c["no"])

n = sum(c["ok"] for c in CASES)
md = ["# 질의 도우미 점검 (" + BASE + ")", "", f"통과 {n} / {len(CASES)}", "", "| # | 질문 | 답 요약 | 기대값 | 일치 |", "|---|---|---|---|---|"]
md += [f"| {c['no']} | {c['q']} | {c['a'].replace('|', '/')} | {c['expect']} | {'일치' if c['ok'] else '불일치'} |" for c in CASES]
(ROOT / "outputs" / "ask_check.md").write_text("\n".join(md) + "\n", encoding="utf-8")
print(f"통과 {n} / {len(CASES)}")
sys.exit(0 if n == len(CASES) else 1)
