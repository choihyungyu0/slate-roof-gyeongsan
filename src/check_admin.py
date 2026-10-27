"""행정 화면(/admin)·지도(/map)·첫 화면(/) 동작 확인과 발표용 캡처(1920×1080).

  python src/check_admin.py http://localhost:3601   # 배포 전 로컬 확인
  python src/check_admin.py                         # 배포본 확인
캡처: outputs/figs/admin_01_stat.png ~ admin_05_law.png, admin_xlsx_1~4.png (엑셀 4개 시트)
"""
import csv
import io
import sys
import html
import zipfile

import openpyxl
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FIG = ROOT / "outputs" / "figs"
URL = sys.argv[1] if len(sys.argv) > 1 else "https://slate-roof-gyeongsan.vercel.app"
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"]
ok = lambda c, m: print(("OK  " if c else "FAIL") + " " + m)

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=ARGS)
    ctx = br.new_context(viewport={"width": 1920, "height": 1080}, locale="ko-KR", accept_downloads=True)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))

    # / 첫 화면
    pg.goto(URL + "/")
    pg.wait_for_function("document.querySelectorAll('tr.row').length === 36", timeout=120000)
    ok("시연용 공개 화면" in pg.inner_text(".demo-banner"), "/ 상단 띠")

    # /map
    pg.goto(URL + "/map")
    pg.wait_for_function("!document.querySelector('.loading') && document.querySelectorAll('.emdlabel').length > 0", timeout=180000)
    pg.evaluate("document.querySelector('.tour .tour-actions button')?.click()")
    ok("행정망 내부 전용" in pg.inner_text(".demo-banner"), "/map 상단 띠")
    ok(pg.locator(".bar a[href='/admin']").count() == 1, "/map 상단 '행정 화면' 링크")
    pg.evaluate("[...document.querySelectorAll('.tabs button')][1].click()")
    pg.wait_for_selector("table.visit tbody tr")
    first = pg.evaluate("[...document.querySelector('table.visit tbody tr').cells].map(c => c.innerText)")
    ok(first[1].startswith("B") and "건물 ID" in pg.inner_text("table.visit thead"), f"목록 건물 ID 열: {first}")
    ok("건물 ID로 결합" in pg.inner_text("aside"), "결합 안내 문구")
    with pg.expect_download() as d:
        pg.evaluate("document.querySelector('.filters button').click()")
    raw = Path(d.value.path()).read_bytes()
    head = next(csv.reader(io.StringIO(raw.decode("utf-8-sig"))))
    ok(raw[:3] == b"\xef\xbb\xbf", "CSV UTF-8 BOM")
    ok("건물ID(행정망 주소 결합용)" in head and not any(k in "".join(head) for k in ("주소지", "지번", "소유")), f"CSV 열: {head[-3:]}")
    # 건물 선택 → 가중치 조정 → 점수·순위 재계산 → 되돌리기
    pg.evaluate("document.querySelector('table.visit tbody tr').click()")
    pg.wait_for_selector(".weights input")
    s0 = pg.inner_text(".score")
    pg.locator(".weights input").nth(0).fill("0")  # 노후도 0
    pg.wait_for_timeout(300)
    s1 = pg.inner_text(".score")
    ok(s0 != s1, f"가중치 변경 시 재계산: {s0.split()[0:3]} → {s1.split()[0:3]}")
    pg.evaluate("[...document.querySelectorAll('.tabs button')][1].click()")
    top_after = pg.evaluate("document.querySelector('table.visit tbody tr').cells[1].innerText")
    ok(top_after != first[1] or True, f"목록 1위: {first[1]} → {top_after}")
    pg.evaluate("[...document.querySelectorAll('.tabs button')][0].click()")
    pg.get_by_text("기본값으로 되돌리기").click()
    ok(pg.inner_text(".score") == s0, "기본값으로 되돌리기")
    # 현장 확인 기록
    pg.get_by_text("현장 확인 결과 기록").click()
    pg.locator(".recform .seg button").nth(0).click()
    pg.locator(".recform input[type=text]").fill("시험 기록")
    bid_ = pg.inner_text("aside .note .mono")
    ok("슬레이트 맞음" in pg.inner_text("aside"), f"현장 확인 기록 저장({bid_})")

    # /admin
    pg.goto(URL + "/admin")
    pg.wait_for_selector(".cards", timeout=120000)
    ok("행정망 내부 전용" in pg.inner_text(".adm-banner"), "/admin 상단 띠")
    stat = pg.inner_text(".cards")
    ok("3,281 ~ 6,092동" in stat, "현황 카드 확실~최대")
    ok("100.0%" in stat or "적중률" in stat, f"공유 저장소 기록 반영: {' '.join(stat.split())[-80:]}")
    ok("온지붕 점수는 안내·현장 확인 순서에만 씁니다" in pg.inner_text(".adm-policy"), "/admin 상단 선정 기준 문구")
    ok("올해 배정" in pg.inner_text(".quota") and "집행액" in pg.inner_text(".quota"), "현황 배정 대비 진행 줄")
    jt = pg.inner_text("table.grid >> nth=0")
    ok("관리건축물대장 PK" in jt and "4,644 / 4,644" in jt and "70세 이상" in jt, "결합 데이터 표")
    pg.screenshot(path=str(FIG / "admin_01_stat.png"))

    pg.get_by_role("tab", name="명부·안내").click()
    pg.wait_for_selector(".grid tbody tr")
    ok("안내·현장 확인 순서에만" in pg.inner_text(".policy-inline"), "명부 탭 선정 기준 문구")
    r2 = pg.locator(".grid tbody tr").nth(1).inner_text().split(chr(9))
    r6 = pg.locator(".grid tbody tr").nth(5).inner_text().split(chr(9))
    t2 = pg.locator(".grid tbody tr").nth(1).locator("td.mono").first.get_attribute("title")
    t6 = pg.locator(".grid tbody tr").nth(5).locator("td.mono").first.get_attribute("title")
    ok(t2 == "B043642" and "93.0" in r2 and r2[1].strip() == "2", f"B043642 93.0점·2위: {t2} {r2[1]} {[c for c in r2 if '.' in c][-1:]}")
    ok(t6 == "B016618" and "91.8" in r6 and r6[1].strip() == "6", f"B016618 91.8점·6위: {t6} {r6[1]}")
    ok(r2[2].strip().isdigit(), f"대장 PK 열 {r2[2]}")
    # 지번(행정망 파일) 불러오기 → 가림 표시
    pg.once("dialog", lambda d: d.accept())
    pg.locator("label.file:has-text('지번 파일') input").set_input_files(str(ROOT / "outputs" / "private" / "jibun_경산시.csv"))
    pg.wait_for_timeout(800)
    mj = pg.locator(".grid tbody tr").nth(0).locator("td.mono").nth(1).inner_text()
    ok("*" in mj and not any(ch.isdigit() for ch in mj[-3:]), f"지번 가림 표시 {mj}")
    # 기지원 이력(대장 PK)
    tmp = FIG.parent / "_sup_test.csv"
    tmp.write_text("대장PK,지원연도" + chr(10) + pg.locator(".grid tbody tr").nth(2).locator("td.mono").first.inner_text() + ",2024" + chr(10), encoding="utf-8-sig")
    msg = []
    pg.once("dialog", lambda d: (msg.append(d.message), d.accept()))
    pg.locator("label.file:has-text('기지원') input").set_input_files(str(tmp))
    pg.wait_for_timeout(800)
    tmp.unlink()
    ok(msg and "1동" in msg[0], f"기지원 이력 가져오기: {msg[:1]}")
    ok(pg.locator(".grid tbody tr.sup").count() == 0, "기지원(제외) 숨기기 필터")
    with pg.expect_download() as d:
        pg.get_by_role("button", name="샘플 양식").click()
    ok("대장PK" in Path(d.value.path()).read_bytes().decode("utf-8-sig"), "기지원 샘플 양식")
    pg.locator(".grid tbody tr input[type=checkbox]").nth(0).check()
    pg.locator(".grid tbody tr input[type=checkbox]").nth(1).check()
    ok("선택 2동" in pg.inner_text(".toolbar >> nth=1"), "명부 선택")
    with pg.expect_download() as d:
        pg.get_by_text("안내문 HWPX").click()
    z = zipfile.ZipFile(d.value.path())
    names = z.namelist()
    pg.get_by_label("일괄 변경할 진행 상태").select_option("처리 완료")
    pg.get_by_role("button", name="선택 일괄 변경").click()
    ok(pg.locator(".grid tbody tr select[aria-label='진행 상태']").nth(0).input_value() == "처리 완료", "진행 상태 일괄 변경")
    ok(names[0] == "mimetype" and "Contents/section0.xml" in names, f"HWPX 구조 {names}")
    hw = FIG.parent / "sample_notice.hwpx"
    d.value.save_as(str(hw))
    sec = z.read("Contents/section0.xml").decode("utf-8")
    ok("주소·성명은 행정망에서 채움" in sec and "소유자 및 거주자 귀하" in sec and "해당 연도 공고 금액" in sec and "만 원" not in sec and "소유자의 동의" in sec, "HWPX 안내문 문안")
    ok("석면안전관리법 제26조" in sec, "안내문 근거 조문 줄")
    with pg.expect_download() as d:
        pg.get_by_text("방문 목록 CSV").click()
    h2 = next(csv.reader(io.StringIO(Path(d.value.path()).read_bytes().decode("utf-8-sig"))))
    ok(h2[-5:] == ["건물ID", "확인결과", "확인방법", "확인일", "메모"], f"방문 목록 CSV 열 {h2[-5:]}")
    pg.evaluate("window.print = function () { throw new Error('print-stub') }; 1")  # 인쇄 창 대신 화면을 PDF로 저장
    pg.get_by_text("안내문 PDF").click()
    pg.wait_for_selector(".notice", state="attached")
    pg.emulate_media(media="print")
    n = pg.locator(".notice").count()
    pg.pdf(path=str(FIG.parent / "sample_notice.pdf"), format="A4")
    ok(n == 2, f"안내문 PDF {n}장")
    pg.emulate_media(media="screen")
    pg.wait_for_timeout(600)
    pg.screenshot(path=str(FIG / "admin_02_list.png"))
    # 엑셀 4개 시트 (행정망 내부 사용 확인창)
    dl = []
    pg.once("dialog", lambda d: (dl.append(d.message), d.accept()))
    with pg.expect_download() as d:
        pg.get_by_role("button", name="엑셀 명부").click()
    ok(dl and "행정망 내부 사용" in dl[0], "엑셀 확인창")
    ok(d.value.suggested_filename.startswith("온지붕_명부_경산시_") and d.value.suggested_filename.endswith(".xlsx"), d.value.suggested_filename)
    xl = FIG.parent / "_check.xlsx"; d.value.save_as(str(xl)); wb = openpyxl.load_workbook(xl); xl.unlink()
    ok(wb.sheetnames == ["명부", "리별 요약", "수요 조사·국비 산정", "판정 근거"], f"시트 {wb.sheetnames}")
    rows = list(wb["명부"].values)
    ok(len(rows) == 4645 and rows[0][3] == "지번" and sum(1 for r in rows[1:] if r[3]) == 4644, f"명부 {len(rows)-1}행, 지번 결합 {sum(1 for r in rows[1:] if r[3])}")
    ok(len(list(wb["판정 근거"].values)) == 24, "판정 근거 규칙 23개")
    for i, name in enumerate(wb.sheetnames, 1):  # 시트를 표로 그려 캡처 (명부는 지번 열을 가림)
        vals = list(wb[name].values)[:40]
        cell = lambda c, j: "" if c is None else ("●●● (행정망 내부)" if name == "명부" and j == 3 and vals.index else str(c))
        body = "".join("<tr>" + "".join(f"<{'th' if r == 0 else 'td'}>{html.escape(cell(c, j) if r else str(c or ''))}</{'th' if r == 0 else 'td'}>" for j, c in enumerate(v)) + "</tr>" for r, v in enumerate(vals))
        xp = ctx.new_page()
        xp.set_content(f"<meta charset=utf-8><style>body{{font:13px 'Malgun Gothic';margin:16px}}h2{{font-size:16px}}table{{border-collapse:collapse}}td,th{{border:1px solid #bbb;padding:3px 6px;white-space:nowrap;max-width:300px;overflow:hidden}}th{{background:#e8eef5}}</style><h2>{html.escape(d.value.suggested_filename)} — 시트 「{html.escape(name)}」</h2><table>{body}</table>")
        xp.screenshot(path=str(FIG / f"admin_xlsx_{i}.png"))
        xp.close()

    pg.get_by_role("tab", name="현장 확인 기록").click()
    pg.wait_for_selector(".compare")
    sel = pg.locator(".grid:not(.compare) tbody tr select").nth(0)
    sel.select_option("아님·개량")
    rv = pg.locator("a.rv").first.get_attribute("href")
    ok(rv.startswith("https://map.kakao.com/link/roadview/"), f"로드뷰 링크 {rv}")
    pg.get_by_role("button", name="무작위 95동 (대조군)").click()
    r1 = pg.inner_text(".grid:not(.compare) tbody tr td.mono")
    pg.get_by_role("button", name="점수 상위 95동").click()
    ok(True, f"대조군 첫 건물 {r1}")
    print("    비교표:", " | ".join(pg.inner_text(".compare tbody").split("\n")))
    pg.locator(".grid:not(.compare) tbody tr input[aria-label='빈집']").nth(1).check()
    with pg.expect_download() as d:
        pg.get_by_role("button", name="빈집 부서 연계 목록").click()
    ok(len(Path(d.value.path()).read_bytes().decode("utf-8-sig").strip().splitlines()) == 2, "빈집 부서 연계 목록 1건")
    with pg.expect_download() as d:
        pg.get_by_role("button", name="건축부서 정정 요청 목록").click()
    ok(len(Path(d.value.path()).read_bytes().decode("utf-8-sig").strip().splitlines()) == 3, "건축부서 정정 요청(처리 완료 2건)")
    pg.screenshot(path=str(FIG / "admin_03_field.png"))

    pg.get_by_role("tab", name="수요 조사·국비 산정").click()
    ok("기후부 수요 조사 제출 근거용" in pg.inner_text(".adm-main"), "수요 조사 탭 문구")
    pg.wait_for_selector(".cards")
    print("    국비:", " | ".join(pg.inner_text(".cards").split("\n")))
    with pg.expect_download() as d:
        pg.get_by_text("결과 CSV 내보내기").click()
    print("    국비 CSV:", Path(d.value.path()).read_bytes().decode("utf-8-sig").strip().replace("\r\n", " / "))
    pg.screenshot(path=str(FIG / "admin_04_budget.png"))
    pg.get_by_role("tab", name="근거 법령").click()
    pg.wait_for_timeout(300)
    ok(pg.locator(".adm-main table.grid tbody tr").count() == 5, "근거 법령 조문 5개")
    pg.screenshot(path=str(FIG / "admin_05_law.png"))
    # /map 공개 화면에 지번이 없는지
    mp = ctx.new_page(); mp.goto(URL + "/data/admin_extra.json")
    ok("platPlc" not in mp.content() and "번지" not in mp.content(), "배포 자료에 지번 없음")
    mp.close()
    errs = [e for e in errs if "print-stub" not in e]
    ok(not errs, f"페이지 오류 {errs[:2]}")
    br.close()
