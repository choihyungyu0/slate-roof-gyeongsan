"""소개서용 시제품 캡처 10장 → outputs/figs/proto_01.png ~ proto_10.png (2400×1500)

배포본(https://slate-roof-gyeongsan.vercel.app)을 Playwright로 연다. 설치된 Chrome을 쓰므로 브라우저를 따로 받지 않는다.
화면 크기 1200×750 × 배율 2 = 2400×1500. 숫자·로직은 건드리지 않고 화면만 찍는다.
"""
import csv
import html
import io
import time
from pathlib import Path

import pandas as pd
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "outputs" / "figs"
URL = "https://slate-roof-gyeongsan.vercel.app"
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"]
TILES = 22  # 건물·항공영상이 다 그려질 때까지 기다리는 초

DOC = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
body{margin:0;background:%(bg)s;color:%(fg)s;font-family:%(font)s;padding:34px 40px;width:1120px;height:682px;overflow:hidden}
h1{font-size:19px;margin:0 0 4px} p{margin:0 0 14px;color:%(dim)s;font-size:12.5px;line-height:1.5}
table{border-collapse:collapse;width:100%%;font-size:%(fs)s;font-variant-numeric:tabular-nums}
th,td{padding:%(pad)s;border-bottom:1px solid %(line)s;text-align:left;white-space:nowrap}
th{color:%(dim)s;font-weight:600;border-bottom:1.5px solid %(fg)s} td.r,th.r{text-align:right}
.s{color:#e0551f;font-weight:700}.m{color:#b9770e;font-weight:700}.n{color:%(dim)s}.u{color:#7a6fd0;font-weight:700}
pre{margin:0 0 12px;color:%(dim)s;font-size:12.5px}
</style></head><body>%(body)s</body></html>"""
LIGHT = dict(bg="#ffffff", fg="#17181a", dim="#5d5f66", line="#dcdde1", font='"Malgun Gothic",sans-serif', fs="14px", pad="8px 10px")
TERM = dict(bg="#14161a", fg="#e9e8e3", dim="#9a9b98", line="#2b2f37", font='"D2Coding","Consolas","Malgun Gothic",monospace', fs="13.5px", pad="5.5px 10px")


def table(head: list[str], rows: list[list], right: set[int] = frozenset(), cls=None) -> str:
    th = "".join(f'<th class="{"r" if i in right else ""}">{html.escape(h)}</th>' for i, h in enumerate(head))
    trs = []
    for r in rows:
        tds = "".join(f'<td class="{"r" if i in right else ""} {cls(i, v) if cls else ""}">{html.escape(str(v))}</td>' for i, v in enumerate(r))
        trs.append(f"<tr>{tds}</tr>")
    return f"<table><thead><tr>{th}</tr></thead><tbody>{''.join(trs)}</tbody></table>"


def render(page, path: Path, theme: dict, body: str) -> None:
    page.set_content(DOC % {**theme, "body": body})
    page.wait_for_timeout(400)
    page.screenshot(path=str(path))


def ready_map(page) -> None:
    page.wait_for_selector(".legend", timeout=120000)
    page.wait_for_function("!document.querySelector('.loading') && document.querySelectorAll('.emdlabel').length > 0", timeout=180000)


def close_tour(page) -> None:
    page.evaluate("document.querySelector('.tour .tour-actions button')?.click()")
    page.wait_for_timeout(300)


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True, args=ARGS)
    ctx = browser.new_context(viewport={"width": 1200, "height": 750}, device_scale_factor=2, locale="ko-KR", accept_downloads=True)
    page = ctx.new_page()

    # 01 첫 화면
    page.goto(URL + "/")
    page.wait_for_function("document.querySelectorAll('tr.row').length === 36", timeout=120000)
    page.wait_for_timeout(TILES * 1000)
    page.screenshot(path=str(FIG / "proto_01.png"))
    print("01", page.evaluate("document.querySelector('.score').innerText.replace(/\\s+/g,' ')"))

    # 07 사용법 안내 첫 화면 (처음 방문이라 자동으로 뜬다) → 02 자인면 전체
    page.goto(URL + "/map")
    ready_map(page)
    page.wait_for_selector(".tour", timeout=20000)
    page.wait_for_timeout(TILES * 1000)
    page.screenshot(path=str(FIG / "proto_07.png"))
    print("07", page.evaluate("document.querySelector('.tour h2').innerText"))
    close_tour(page)
    page.wait_for_timeout(800)
    page.screenshot(path=str(FIG / "proto_02.png"))
    print("02", page.evaluate("document.querySelector('.legend').innerText.split('\\n').slice(0,2).join(' / ')"))

    # 04 찾아가는 신청 목록: 경산시 전체 상위 95동
    page.evaluate("[...document.querySelectorAll('.tabs button')][1].click()")
    page.wait_for_selector("table.visit tbody tr")
    page.wait_for_timeout(600)
    page.screenshot(path=str(FIG / "proto_04.png"))
    print("04", page.evaluate("[...document.querySelectorAll('aside .note')][1].innerText"))

    # 06 CSV 내보내기 (같은 상태: 경산시 전체 상위 95동)
    with page.expect_download() as dl:
        page.evaluate("document.querySelector('.filters button').click()")
    raw = Path(dl.value.path()).read_bytes().decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(raw)))
    print("06 CSV 열:", rows[0], "| 행 수", len(rows) - 1, "| 파일명", dl.value.suggested_filename)

    # 05 하양읍으로 필터
    page.select_option(".filters select >> nth=0", "하양읍")
    page.wait_for_timeout(700)
    page.screenshot(path=str(FIG / "proto_05.png"))
    print("05", page.evaluate("[...document.querySelectorAll('aside .note')][1].innerText"))

    # 03 건물 하나 선택: 자인면 목록에서 혼합 기재(예: 기와/스레트) 주택
    page.select_option(".filters select >> nth=0", "자인면")
    page.wait_for_timeout(500)
    idx = page.evaluate("[...document.querySelectorAll('table.visit tbody tr')].findIndex(r => r.cells[2].innerText === '혼합')")
    page.evaluate(f"document.querySelectorAll('table.visit tbody tr')[{idx}].click()")
    page.wait_for_timeout((TILES + 4) * 1000)
    panel = page.evaluate("document.querySelector('aside').innerText")
    page.screenshot(path=str(FIG / "proto_03.png"))
    print("03 패널:", " | ".join(s for s in panel.split("\n") if s.strip())[:420])

    # 08 다른 읍면: 하양읍 3D 지도 — 하양읍 목록 1순위 건물로 이동한 뒤 두 단계 축소해 주변을 함께 보여준다
    page.evaluate("[...document.querySelectorAll('.tabs button')][1].click()")
    page.select_option(".filters select >> nth=0", "하양읍")
    page.wait_for_timeout(500)
    page.evaluate("document.querySelector('table.visit tbody tr').click()")
    page.wait_for_timeout(5000)
    for _ in range(2):
        page.click(".maplibregl-ctrl-zoom-out")
        page.wait_for_timeout(900)
    page.wait_for_timeout((TILES + 4) * 1000)
    page.screenshot(path=str(FIG / "proto_08.png"))
    print("08", page.evaluate("document.querySelector('aside dl dd').innerText"))

    # 06 CSV를 표로 연 화면 (앞 15행)
    head, body_rows = rows[0], rows[1:16]
    right = {i for i, h in enumerate(head) if h not in ("읍면동", "분류", "지붕자유기재")}
    render(page, FIG / "proto_06.png", {**LIGHT, "fs": "12.5px", "pad": "8px 7px"},
           f"<h1>찾아가는 신청 목록 — CSV 내보내기 결과</h1><p>{html.escape(dl.value.suggested_filename)} · 전체 {len(rows) - 1}행 중 앞 15행 · "
           "주소·지번·소유자 열 없음(건물 위치 좌표까지만)</p>" + table(head, body_rows, right))

    # 09 정규화 근거: 자유기재 원문 → 분류 (예시 20행)
    s = pd.read_csv(ROOT / "data" / "processed" / "roof_strings_all.csv", dtype=str).fillna("")
    s["n"] = s["n"].astype(int)
    g = s[s["etcRoof"] != ""].groupby(["etcRoof", "text_class"], as_index=False)["n"].sum().sort_values("n", ascending=False)
    pick = pd.concat([g[g["text_class"] == "슬레이트"].head(6), g[g["text_class"] == "혼합"].head(6),
                      g[g["text_class"] == "비슬레이트"].head(5), g[g["text_class"].str.startswith("불명")].head(3)])
    cls = lambda i, v: {"슬레이트": "s", "혼합": "m", "비슬레이트": "n"}.get(v, "u") if i == 1 else ""
    render(page, FIG / "proto_09.png", {**TERM, "fs": "13px", "pad": "4.6px 10px"},
           "<pre>$ python src/normalize_roof.py    # rules/roof_rules.csv 23개 규칙을 순서대로 적용</pre>"
           f"<h1>대장 지붕 자유기재(etcRoof) 원문 → 정규화 분류</h1><p>경산시 표제부 49,728건 · 고유 표기 2,662종 전수 분류, 규칙에 안 걸린 표기 0종 · "
           "아래는 분류별 빈도 상위 예시 20행 (전체: data/processed/roof_strings_all.csv)</p>"
           + table(["자유기재 원문", "분류", "표제부 건수"], [[r.etcRoof, r.text_class, f"{r.n:,}"] for r in pick.itertuples()], {2}, cls))
    print("09 예시:", pick["text_class"].value_counts().to_dict())

    # 10 확장성 시험 결과 표
    md = (ROOT / "reports" / "transfer_test.md").read_text(encoding="utf-8").split("\n")
    i = next(k for k, l in enumerate(md) if l.startswith("| 시·군 | 표제부 건수"))
    tb = [[c.strip() for c in l.strip().strip("|").split("|")] for l in md[i:i + 5] if not l.startswith("|---")]
    render(page, FIG / "proto_10.png", {**LIGHT, "fs": "15px", "pad": "13px 10px"},
           "<h1>확장성 시험 — 경산시 규칙표를 다른 시·군에 그대로 적용</h1><p>경산시에서 만든 규칙표 23개를 고치지 않고 인접 시·군 건축물대장 표제부에 적용한 결과. "
           "대장 기재 기준, 현장 미확인. 추가 규칙 11개는 두 시·군의 미분류 표기 45종을 합쳐 한 번에 만든 것. 근거: reports/transfer_test.md</p>" + table(tb[0], tb[1:], {1}))
    print("10", tb[1:])
    browser.close()
print("저장:", *(f.name for f in sorted(FIG.glob("proto_*.png"))))
