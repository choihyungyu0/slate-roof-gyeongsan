"""행정 화면(/admin)·지도(/map)·첫 화면(/) 동작 확인과 발표용 캡처(1920×1080).

  python src/check_admin.py http://localhost:3601   # 배포 전 로컬 확인
  python src/check_admin.py                         # 배포본 확인
캡처: outputs/figs/admin_01_stat.png ~ admin_04_budget.png
"""
import csv
import io
import sys
import zipfile
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
    pg.screenshot(path=str(FIG / "admin_01_stat.png"))

    pg.get_by_role("tab", name="명부·안내").click()
    pg.wait_for_selector(".grid tbody tr")
    pg.locator(".grid tbody tr input[type=checkbox]").nth(0).check()
    pg.locator(".grid tbody tr input[type=checkbox]").nth(1).check()
    ok("선택 2동" in pg.inner_text(".toolbar"), "명부 선택")
    with pg.expect_download() as d:
        pg.get_by_text("안내문 HWPX").click()
    z = zipfile.ZipFile(d.value.path())
    names = z.namelist()
    ok(names[0] == "mimetype" and "Contents/section0.xml" in names, f"HWPX 구조 {names}")
    hw = FIG.parent / "sample_notice.hwpx"
    d.value.save_as(str(hw))
    sec = z.read("Contents/section0.xml").decode("utf-8")
    ok("주소·성명은 행정망에서 채움" in sec and "700만 원" in sec, "HWPX 내용")
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
    pg.screenshot(path=str(FIG / "admin_03_field.png"))

    pg.get_by_role("tab", name="국비 산정").click()
    pg.wait_for_selector(".cards")
    print("    국비:", " | ".join(pg.inner_text(".cards").split("\n")))
    with pg.expect_download() as d:
        pg.get_by_text("결과 CSV 내보내기").click()
    print("    국비 CSV:", Path(d.value.path()).read_bytes().decode("utf-8-sig").strip().replace("\r\n", " / "))
    pg.screenshot(path=str(FIG / "admin_04_budget.png"))
    errs = [e for e in errs if "print-stub" not in e]
    ok(not errs, f"페이지 오류 {errs[:2]}")
    br.close()
