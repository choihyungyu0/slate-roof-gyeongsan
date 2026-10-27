"use client";

// 담당 공무원용 행정 화면(시제품). 서버 없이 브라우저 localStorage와 파일 내보내기/가져오기로만 저장한다.
// 지번은 배포 자료에 넣지 않는다. 행정망 내부 파일(outputs/private/jibun_경산시.csv)을 담당자가 직접 불러올 때만
// 메모리에 올려 화면에는 가려서 보여주고, 엑셀 내보내기에만 넣는다. 점수·순위 계산은 /map 과 같다(app/shared.ts).
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { bid, csvBlob, EMPTY_REC as EMPTY, eoScore, type Extra, loadExtra, loadRecs, loadWeights, type Rec, type Result, RESULT_LABEL, RESULTS,
  rescore, saveRecs, type Status, STATUSES, today } from "../shared";
import { buildHwpx, type Line } from "./hwpx";

type P = {
  cat: number; emd: string; roof?: string; etc?: string; rc?: string; year?: number | null; area?: number | null; pm?: number; pw?: number;
  ps?: number; pr?: number; ds?: number; dd?: number; de?: number; eo?: number;
};
type B = { id: string; p: P; lon: number; lat: number; x: Extra };
type Emd = { name: string; houses: number; sure: number; max: number };
type Summary = { houses: number; sure: number; max: number };
type Rule = { order: number; label: string; note: string; pattern: string; examples: string[]; n: number };
type Join = { rows: { name: string; org: string; date: string; unit: string; rate: string }[]; elderly_ym: string };
type Law = { law: string; article: string; title: string; use: string; fetched: string; url: string; support?: boolean };
type Tab = "stat" | "list" | "field" | "budget" | "law";
const SEED = 20261028;
const POLICY = "선정은 해당 연도 공고 기준을 따르며, 온지붕 점수는 안내·현장 확인 순서에만 씁니다";

function center(g: GeoJSON.Geometry): [number, number] {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === "number") {
      const [x, y] = c as number[];
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    } else (c as unknown[]).forEach(walk);
  };
  walk((g as GeoJSON.Polygon).coordinates);
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

// 시드 고정 난수(mulberry32) — 대조군 무작위 95동이 매번 같게 뽑히도록
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hit(recs: Record<string, Rec>, ids: string[]) {
  const c: Record<"맞음" | "아님·개량" | "철거됨" | "확인 불가" | "미입력", number> = { 맞음: 0, "아님·개량": 0, 철거됨: 0, "확인 불가": 0, 미입력: 0 };
  for (const id of ids) c[(recs[id]?.result || "미입력") as keyof typeof c]++;
  const judged = c["맞음"] + c["아님·개량"] + c["철거됨"];
  return { ...c, judged, rate: judged ? c["맞음"] / judged : null };
}
const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);
const statusOf = (r?: Rec): Status => r?.status ?? "미안내";

function save(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const download = (name: string, rows: unknown[][]) => save(name, csvBlob(rows));

// CSV·엑셀 파일을 표(첫 행 머리글)로 읽는다
async function readTable(file: File): Promise<string[][]> {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return (XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as unknown[][]).map((r) => r.map((c) => String(c ?? "").trim()));
}
// 지번 비교용: "경상북도 경산시 하양읍 금락리 123-4번지" → "하양읍금락리123-4"
const normJibun = (s: string) => s.replace(/경상북도|경산시|번지|\s/g, "").replace(/-0+$/, "");
// 화면 표시용 가림: "하양읍 금락리 12*-*"
function maskJibun(s: string | undefined) {
  if (!s) return "";
  const t = s.replace(/^경상북도\s*경산시\s*/, "").replace(/번지$/, "");
  const m = t.match(/^(.*?)(\s*산?)(\d+)(?:-(\d+))?$/);
  if (!m) return t.replace(/\d/g, "*");
  const main = m[3].length > 2 ? m[3].slice(0, 2) + "*".repeat(m[3].length - 2) : m[3].slice(0, 1) + "*";
  return `${m[1]}${m[2]}${main}${m[4] ? "-*" : ""}`.trim();
}

function noticeLines(b: B, law: string): Line[] {
  return [
    { text: "슬레이트 지붕 철거·개량 지원 안내", style: "title" },
    { text: "수신: 소유자 및 거주자 귀하" },
    { text: `건물 ID: ${b.id}    대장 PK: ${b.x.pk ?? "-"}    ${b.p.emd} ${b.x.ri && b.x.ri !== b.p.emd ? b.x.ri : ""}    사용승인연도: ${b.p.year ?? "불명"}` },
    { text: `건축물대장 지붕 기재: ${b.p.roof || "(빈값)"} / ${b.p.etc || "(빈값)"}` },
    { text: "댁의 건물은 건축물대장에 지붕이 슬레이트로 기재되어 있어 석면 슬레이트 처리 지원 대상일 수 있습니다." },
    { text: "■ 지원 내용: 주택 슬레이트 철거·처리 및 지붕 개량 (지원 금액: 해당 연도 공고 금액 ______________ )" },
    { text: "■ 세입자가 거주하는 경우 소유자의 동의가 있어야 신청할 수 있습니다." },
    { text: "■ 신청 장소: 관할 행정복지센터 (읍·면사무소, 동 행정복지센터)" },
    { text: "주소: ______________________________   성명: ______________  (주소·성명은 행정망에서 채움)", style: "small" },
    { text: "※ 대장 기재 기준 안내이며, 실제 지붕 재료는 현장 확인 후 확정됩니다. 선정은 해당 연도 공고 기준을 따릅니다.", style: "small" },
    ...(law ? [{ text: law, style: "small" as const }] : []),
  ];
}

export default function AdminView() {
  const [tab, setTab] = useState<Tab>("stat");
  const [bld, setBld] = useState<B[]>([]);
  const [emds, setEmds] = useState<Emd[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [join, setJoin] = useState<Join | null>(null);
  const [laws, setLaws] = useState<Law[]>([]);
  const [recs, setRecs] = useState<Record<string, Rec>>({});
  const [loaded, setLoaded] = useState(false);
  const [jibun, setJibun] = useState<Record<string, string>>({});  // 행정망 내부 파일에서만 채워진다(저장하지 않음)
  // 명부 필터
  const [fEmd, setFEmd] = useState("전체");
  const [fN, setFN] = useState(95);
  const [fKind, setFKind] = useState<"전체" | "단독" | "혼합">("전체");
  const [hideSup, setHideSup] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<Status>("안내 발송");
  const [printing, setPrinting] = useState<B[] | null>(null);
  // 현장 확인
  const [group, setGroup] = useState<"top" | "rand">("top");
  // 올해 배정·국비 산정
  const [quota, setQuota] = useState(95);
  const [perYear, setPerYear] = useState(95);
  const [unit, setUnit] = useState(700);

  useEffect(() => {
    (async () => {
      const { parts } = (await fetch("/data/buildings.manifest.json").then((r) => r.json())) as { parts: number };
      const [chunks, extra] = await Promise.all([
        Promise.all(Array.from({ length: parts }, (_, k) => fetch(`/data/buildings.part${k}.json`).then((r) => r.json() as Promise<GeoJSON.FeatureCollection>))),
        loadExtra(),
      ]);
      const list: B[] = [];
      for (const f of chunks.flatMap((c) => c.features)) {
        const p = f.properties as P;
        if (p.ps == null) continue;  // 점수가 있는 건물 = 위치가 연결된 대장 슬레이트 주택
        const id = bid(f.id as number);
        const x = extra.ex[id] ?? { pk: null, ri: null, ad: null, eo: null };
        const [lon, lat] = center(f.geometry);
        list.push({ id, p: { ...p, eo: eoScore(x.eo, extra.lo, extra.hi) }, lon, lat, x });
      }
      setBld(rescore(list, loadWeights()));  // /map 에서 조정한 가중치를 그대로 따른다(기본값이면 순위 그대로)
      const ej = (await fetch("/data/emd.geojson").then((r) => r.json())) as GeoJSON.FeatureCollection;
      setEmds(ej.features.map((f) => {
        const q = f.properties as { emd_kor_nm: string; houses: number; slate_sure: number; slate_houses: number };
        return { name: q.emd_kor_nm, houses: q.houses, sure: q.slate_sure, max: q.slate_houses };
      }).sort((a, b) => b.max - a.max));
      setSum(await fetch("/data/summary.json").then((r) => r.json()));
      setRules(await fetch("/data/rules.json").then((r) => r.json()));
      setJoin(await fetch("/data/join_stats.json").then((r) => r.json()));
      setLaws(await fetch("/data/legal_basis.json").then((r) => (r.ok ? r.json() : [])).catch(() => []));
      setRecs(loadRecs());
      setLoaded(true);
    })();
  }, []);
  useEffect(() => { if (loaded) saveRecs(recs); }, [recs, loaded]);
  useEffect(() => {
    if (!printing) return;
    const t = setTimeout(() => { window.print(); setPrinting(null); }, 300);
    return () => clearTimeout(t);
  }, [printing]);

  const byId = useMemo(() => new Map(bld.map((b) => [b.id, b])), [bld]);
  const top95 = useMemo(() => bld.slice(0, 95).map((b) => b.id), [bld]);
  const rand95 = useMemo(() => {
    const pool = bld.slice(95).map((b) => b.id);  // 상위 95동과 겹치지 않게 나머지에서 뽑는다
    const r = rng(SEED);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, 95).sort((a, b) => byId.get(a)!.p.pr! - byId.get(b)!.p.pr!);
  }, [bld, byId]);
  const allRec = useMemo(() => hit(recs, Object.keys(recs)), [recs]);
  const stCount = useMemo(() => {
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    for (const b of bld) c[statusOf(recs[b.id])]++;
    return c;
  }, [bld, recs]);
  const supCount = useMemo(() => bld.filter((b) => recs[b.id]?.sup).length, [bld, recs]);
  // 안내문 하단: 본문에 비용 지원 내용이 있는 조문만 "근거:", 나머지는 "관련 법령:"(법령명·조문 번호만)
  const lawName = (l: Law) => (l.law === "개인정보 보호법" && l.article === "제18조" ? `${l.law} 제18조(목적 외 이용·제공 제한)` : `${l.law} ${l.article}`);
  const joinLaws = (ls: Law[]) => [...new Set(ls.map((l) => l.law))].map((n) => {
    const g = ls.filter((l) => l.law === n);
    return g.length === 1 ? lawName(g[0]) : `${n} ${g.map((l) => l.article).join("·")}`;
  }).join(", ");
  const lawLine = [laws.some((l) => l.support) && `근거: ${joinLaws(laws.filter((l) => l.support))}`,
    laws.some((l) => !l.support) && `관련 법령: ${joinLaws(laws.filter((l) => !l.support))}`].filter(Boolean).join(" / ");

  const listAll = bld.filter((b) => (fEmd === "전체" || b.p.emd === fEmd)
    && (fKind === "전체" || (fKind === "혼합" ? b.p.rc === "혼합" : b.p.rc !== "혼합"))
    && !(hideSup && recs[b.id]?.sup));
  const listShown = fN ? listAll.slice(0, fN) : listAll;
  const chosen = listShown.filter((b) => sel.has(b.id));
  const setRec = (id: string, patch: Partial<Rec>) => setRecs((r) => ({ ...r, [id]: { ...EMPTY, ...r[id], ...patch } }));
  const setMany = (ids: string[], patch: Partial<Rec>) => setRecs((r) => {
    const n = { ...r };
    for (const id of ids) n[id] = { ...EMPTY, ...r[id], ...patch };
    return n;
  });

  const exportVisits = () => {
    const rows = (chosen.length ? chosen : listShown);
    download(`방문목록_${fEmd}_${rows.length}동.csv`, [
      ["목록순번", "시전체순위", "점수", "읍면동", "분류", "지붕자유기재", "사용승인연도", "건축면적", "학교거리m", "어린이집거리m", "경로당거리m", "경도", "위도",
        "건물ID", "확인결과", "확인방법", "확인일", "메모"],
      ...rows.map((b, i) => {
        const r = recs[b.id] ?? EMPTY;
        return [i + 1, b.p.pr, b.p.ps, b.p.emd, b.p.rc, b.p.etc ?? "", b.p.year ?? "", b.p.area ?? "", b.p.ds, b.p.dd, b.p.de,
          b.lon.toFixed(6), b.lat.toFixed(6), b.id, r.result, r.method, r.date, r.memo];
      })]);
  };
  const importRecs = async (file: File) => {
    const rows = await readTable(file);
    const h = rows[0] ?? [];
    const ix = (n: string) => h.indexOf(n);
    const [iId, iRes, iMet, iDate, iMemo] = ["건물ID", "확인결과", "확인방법", "확인일", "메모"].map(ix);
    if (iId < 0 || iRes < 0) { alert("건물ID·확인결과 열이 있는 파일이 아닙니다."); return; }
    let n = 0;
    const next = { ...recs };
    for (const r of rows.slice(1)) {
      if (!byId.has(r[iId]) || !(RESULTS as string[]).includes(r[iRes])) continue;
      next[r[iId]] = { ...EMPTY, ...next[r[iId]], result: r[iRes] as Result, method: (r[iMet] as Rec["method"]) || "", date: r[iDate] || "", memo: r[iMemo] || "" };
      n++;
    }
    setRecs(next);
    alert(`${n}건의 확인 기록을 가져왔습니다.`);
  };
  // 행정망 내부 지번 파일(건물ID·지번 열)을 메모리에만 올린다
  const loadJibun = async (file: File) => {
    const rows = await readTable(file);
    const h = rows[0] ?? [];
    const iId = h.indexOf("bid") >= 0 ? h.indexOf("bid") : h.indexOf("건물ID"), iJ = h.indexOf("jibun") >= 0 ? h.indexOf("jibun") : h.indexOf("지번");
    if (iId < 0 || iJ < 0) { alert("건물ID(bid)·지번(jibun) 열이 있는 파일이 아닙니다."); return; }
    const m: Record<string, string> = {};
    for (const r of rows.slice(1)) if (byId.has(r[iId]) && r[iJ]) m[r[iId]] = r[iJ];
    setJibun(m);
    alert(`지번 ${Object.keys(m).length.toLocaleString()}건을 불러왔습니다. 화면에는 가려서 보이고, 저장되지 않으며 엑셀 내보내기에만 들어갑니다.`);
  };
  // 기지원 이력: 대장 PK 또는 지번 열로 맞춘다
  const importSupported = async (file: File) => {
    const rows = await readTable(file);
    const h = rows[0] ?? [];
    const iPk = h.findIndex((c) => /대장\s*PK|관리건축물대장PK|mgmBldrgstPk/i.test(c));
    const iJ = h.findIndex((c) => /지번|대지위치/.test(c));
    if (iPk < 0 && iJ < 0) { alert("대장PK 또는 지번 열이 있는 CSV·엑셀이 아닙니다. 샘플 양식을 참고하세요."); return; }
    if (iPk < 0 && !Object.keys(jibun).length) { alert("지번으로 맞추려면 먼저 행정망 지번 파일을 불러오세요."); return; }
    const byPk = new Map(bld.filter((b) => b.x.pk).map((b) => [b.x.pk!, b.id]));
    const byJ = new Map(Object.entries(jibun).map(([id, j]) => [normJibun(j), id]));
    const ids = new Set<string>();
    let miss = 0;
    for (const r of rows.slice(1)) {
      const id = (iPk >= 0 && byPk.get(r[iPk])) || (iJ >= 0 && r[iJ] && byJ.get(normJibun(r[iJ]))) || null;
      if (id) ids.add(id); else miss++;
    }
    setMany([...ids], { sup: true });
    alert(`기지원 이력 ${ids.size}동을 표시했습니다. 명부에서 찾지 못한 행 ${miss}건.`);
  };
  const sampleSupported = () => download("기지원이력_양식.csv", [["대장PK", "지번", "지원연도", "비고"],
    ["123712999", "", "2023", "대장 PK로 맞출 때"], ["", "경산시 하양읍 금락리 123-4", "2024", "지번으로 맞출 때(행정망 지번 파일 필요)"]]);
  const hwpx = async () => save(`슬레이트_지원안내_${chosen.length}건.hwpx`, await buildHwpx(chosen.map((b) => noticeLines(b, lawLine))));

  const years = (n: number) => (perYear > 0 ? n / perYear : 0);
  const budgetRows: [string, number][] = sum ? [["확실", sum.sure], ["최대", sum.max]] : [];
  const budgetTable = [["구분", "명부 규모(동)", "연 처리 물량(동)", "소요 연수", "동당 단가(만원)", "필요 예산(억원)"],
    ...budgetRows.map(([k, n]) => [k, n, perYear, Number(years(n).toFixed(1)), unit, Number(((n * unit) / 10000).toFixed(1))])];
  const exportBudget = () => download("수요조사_국비산정.csv", budgetTable);

  const exportExcel = () => {
    if (!window.confirm("행정망 내부 사용 자료입니다.\n지번이 들어간 명부를 내려받습니다. 행정망 밖으로 반출하지 마세요.\n계속할까요?")) return;
    const wb = XLSX.utils.book_new();
    const roster = [["순위", "점수", "대장 PK", "지번", "읍면동", "법정리", "사용승인", "지붕 코드", "자유기재 원문", "판정", "인허가 이력", "기지원 여부", "진행 상태",
      "확인 결과", "빈집", "메모", "건물 ID", "행정동", "행정동 70세이상비율(%)"],
      ...bld.map((b) => {
        const r = recs[b.id] ?? EMPTY;
        return [b.p.pr, b.p.ps, b.x.pk ?? "", jibun[b.id] ?? "", b.p.emd, b.x.ri ?? "", b.p.year ?? "", b.p.roof ?? "", b.p.etc ?? "", b.p.rc ?? "",
          b.p.pm == null ? "" : b.p.pm ? (b.p.pw ? "철거·멸실 신고 기록" : "부분 철거·멸실 신고 기록") : "기록 없음",
          r.sup ? "기지원(제외)" : "", statusOf(r), r.result ? RESULT_LABEL[r.result] : "", r.vacant ? "빈집" : "", r.memo, b.id, b.x.ad ?? "", b.x.eo ?? ""];
      })];
    const s1 = XLSX.utils.aoa_to_sheet(roster);
    s1["!cols"] = [6, 6, 12, 30, 8, 8, 8, 12, 22, 8, 18, 10, 10, 12, 6, 20, 10, 8, 10].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, s1, "명부");
    const ri = new Map<string, { emd: string; ri: string; n: number; top: number }>();
    for (const b of bld) {
      const k = `${b.p.emd}|${b.x.ri ?? ""}`;
      const v = ri.get(k) ?? { emd: b.p.emd, ri: b.x.ri ?? "", n: 0, top: 0 };
      v.n++; if (b.p.pr! <= 95) v.top++;
      ri.set(k, v);
    }
    const s2 = XLSX.utils.aoa_to_sheet([["읍면동", "법정리", "명부 수", "상위 95 포함 수"],
      ...[...ri.values()].sort((a, b) => b.top - a.top || b.n - a.n).map((v) => [v.emd, v.ri, v.n, v.top])]);
    s2["!cols"] = [10, 10, 10, 14].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, s2, "리별 요약");
    const s3 = XLSX.utils.aoa_to_sheet([["수요 조사·국비 산정 (기후부 수요 조사 제출 근거용, 대장 기재 기준 단순 환산)"], [], ...budgetTable,
      [], ["올해 배정(동)", quota], ["진행 상태", ...STATUSES], ["건수", ...STATUSES.map((s) => stCount[s])]]);
    s3["!cols"] = [14, 14, 14, 10, 14, 14, 10].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, s3, "수요 조사·국비 산정");
    const s4 = XLSX.utils.aoa_to_sheet([["순서", "판정", "설명", "규칙(정규식)", "해당 표기 예시", "해당 표제부 건수"],
      ...rules.map((r) => [r.order, r.label, r.note, r.pattern, r.examples.join(" · "), r.n])]);
    s4["!cols"] = [6, 10, 34, 40, 34, 12].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, s4, "판정 근거");
    const d = today().replace(/-/g, "");
    XLSX.writeFile(wb, `온지붕_명부_경산시_${d}.xlsx`);
  };
  // 부서 연계 목록
  const exportDept = (kind: "build" | "vacant") => {
    const rows = bld.filter((b) => (kind === "build" ? statusOf(recs[b.id]) === "처리 완료" && /슬레이트|스레트/.test(`${b.p.roof}${b.p.etc}`) : recs[b.id]?.vacant));
    download(kind === "build" ? "건축부서_대장정정요청.csv" : "빈집정비부서_연계목록.csv", [
      ["건물ID", "대장PK", "읍면동", "법정리", "지붕 코드", "지붕 자유기재", "진행 상태", "확인 결과", "확인일", "메모", "요청 사유"],
      ...rows.map((b) => {
        const r = recs[b.id] ?? EMPTY;
        return [b.id, b.x.pk ?? "", b.p.emd, b.x.ri ?? "", b.p.roof ?? "", b.p.etc ?? "", statusOf(r), r.result ? RESULT_LABEL[r.result] : "", r.date, r.memo,
          kind === "build" ? "슬레이트 처리 완료 — 대장 지붕 기재 정정 요청" : "현장 확인 결과 빈집"];
      })]);
  };

  const groupIds = group === "top" ? top95 : rand95;
  const gTop = hit(recs, top95), gRand = hit(recs, rand95);
  const spent = stCount["처리 완료"] * unit;

  return (
    <div className="adm">
      <div className="adm-banner">담당자 화면 시제품 · 도입 시 행정망 내부 전용 · 도입 시 행정망 계정·접근 기록으로 운영</div>
      <div className="adm-policy">{POLICY}</div>
      {printing && (
        <div className="print-only">
          {printing.map((b) => (
            <section key={b.id} className="notice">
              <h1>슬레이트 지붕 철거·개량 지원 안내</h1>
              <p className="to">수신: 소유자 및 거주자 귀하</p>
              <table><tbody>
                <tr><th>건물 ID</th><td>{b.id}</td><th>대장 PK</th><td>{b.x.pk ?? "-"}</td></tr>
                <tr><th>읍·면·동</th><td>{b.p.emd} {b.x.ri && b.x.ri !== b.p.emd ? b.x.ri : ""}</td><th>사용승인연도</th><td>{b.p.year ?? "불명"}</td></tr>
                <tr><th>대장 지붕 기재</th><td colSpan={3}>{b.p.roof || "(빈값)"} / {b.p.etc || "(빈값)"}</td></tr>
              </tbody></table>
              <p>댁의 건물은 건축물대장에 지붕이 슬레이트로 기재되어 있어 석면 슬레이트 처리 지원 대상일 수 있습니다.</p>
              <h2>지원 내용</h2>
              <p>주택 슬레이트 철거·처리 및 지붕 개량 — 지원 금액: 해당 연도 공고 금액 <span className="blankline" /></p>
              <h2>신청 안내</h2>
              <p>세입자가 거주하는 경우 소유자의 동의가 있어야 신청할 수 있습니다. 신청 장소: 관할 행정복지센터 (읍·면사무소, 동 행정복지센터)</p>
              <table className="blank"><tbody>
                <tr><th>주소</th><td /></tr><tr><th>성명</th><td /></tr>
              </tbody></table>
              <p className="fine">주소·성명은 행정망에서 채움 · 대장 기재 기준 안내이며 실제 지붕 재료는 현장 확인 후 확정됩니다. 선정은 해당 연도 공고 기준을 따릅니다.</p>
              {lawLine && <p className="fine">{lawLine}</p>}
            </section>
          ))}
        </div>
      )}
      <header className="adm-head">
        <div className="brand"><a href="/">온지붕</a><small>행정 화면</small></div>
        <nav className="adm-tabs" role="tablist">
          {([["stat", "현황"], ["list", "명부·안내"], ["field", "현장 확인 기록"], ["budget", "수요 조사·국비 산정"], ["law", "근거 법령"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>
          ))}
        </nav>
        <a className="adm-link" href="/map">건물 단위 지도 →</a>
      </header>
      {!loaded ? <p className="adm-wait">명부를 불러오는 중…</p> : (
        <main className="adm-main">
          {tab === "stat" && (
            <>
              <div className="quota">
                올해 배정 <input type="number" min={0} aria-label="올해 배정 동수" value={quota} onChange={(e) => setQuota(Number(e.target.value))} /> 동 대비
                {" "}안내 <b>{stCount["안내 발송"] + stCount["신청"] + stCount["현장 확인"] + stCount["선정"] + stCount["처리 완료"]}</b>
                {" · "}신청 <b>{stCount["신청"] + stCount["현장 확인"] + stCount["선정"] + stCount["처리 완료"]}</b>
                {" · "}선정 <b>{stCount["선정"] + stCount["처리 완료"]}</b>
                {" · "}처리 완료 <b>{stCount["처리 완료"]}</b>
                {" · "}집행액 <b>{spent.toLocaleString()}만 원</b>
                <span className="dim"> (동당 단가 <input type="number" min={0} aria-label="동당 단가" value={unit} onChange={(e) => setUnit(Number(e.target.value))} /> 만 원 · 단계별 누적)</span>
              </div>
              <div className="cards">
                <div className="card"><span>대장 슬레이트 주택 (확실 ~ 최대)</span><b>{sum!.sure.toLocaleString()} ~ {sum!.max.toLocaleString()}동</b><small>주택류 표제부 {sum!.houses.toLocaleString()}동 중 · 대장 기재 기준</small></div>
                <div className="card"><span>점수가 매겨진 명부</span><b>{bld.length.toLocaleString()}동</b><small>건물 도형과 연결된 주택 · 기지원(제외) {supCount}동</small></div>
                <div className="card"><span>현장 확인 진행률</span><b>{pct(bld.length ? (allRec.judged + allRec["확인 불가"]) / bld.length : null)}</b><small>기록 {(allRec.judged + allRec["확인 불가"]).toLocaleString()}동 / 명부 {bld.length.toLocaleString()}동</small></div>
                <div className="card"><span>적중률</span><b>{pct(allRec.rate)}</b><small>맞음 {allRec["맞음"]} ÷ (맞음 + 아님·개량 {allRec["아님·개량"]} + 철거됨 {allRec["철거됨"]})</small></div>
              </div>
              <h3>진행 상태별 건수</h3>
              <div className="cards st">
                {STATUSES.map((s) => <div className="card" key={s}><span>{s}</span><b>{stCount[s].toLocaleString()}동</b></div>)}
              </div>
              <h3>결합 데이터</h3>
              <table className="grid">
                <thead><tr><th>데이터</th><th>제공 기관</th><th>기준일</th><th>결합 단위</th><th className="r">결합률 (명부 {bld.length.toLocaleString()}동 중)</th></tr></thead>
                <tbody>{join?.rows.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.org}</td><td>{r.date}</td><td>{r.unit}</td><td className="r">{r.rate}</td></tr>)}</tbody>
              </table>
              <p className="dim">주민등록 인구는 10세 구간으로 제공되어 65세가 아닌 70세 이상 비율로 집계했습니다. 지번은 공개 자료에 넣지 않으며 행정망 내부 파일로만 결합합니다.</p>
              <h3>읍·면·동별 대장 슬레이트 주택</h3>
              <table className="grid">
                <thead><tr><th>읍·면·동</th><th className="r">주택</th><th className="r">확실</th><th className="r">최대</th><th className="r">명부(점수)</th><th className="r">확인 기록</th><th className="r">적중률</th></tr></thead>
                <tbody>{emds.map((e) => {
                  const ids = bld.filter((b) => b.p.emd === e.name).map((b) => b.id);
                  const h = hit(recs, ids);
                  return <tr key={e.name}><td>{e.name}</td><td className="r">{e.houses.toLocaleString()}</td><td className="r">{e.sure.toLocaleString()}</td>
                    <td className="r">{e.max.toLocaleString()}</td><td className="r">{ids.length.toLocaleString()}</td><td className="r">{(h.judged + h["확인 불가"]).toLocaleString()}</td><td className="r">{pct(h.rate)}</td></tr>;
                })}</tbody>
              </table>
            </>
          )}

          {tab === "list" && (
            <>
              <p className="policy-inline">{POLICY}</p>
              <div className="toolbar">
                <select aria-label="읍·면·동" value={fEmd} onChange={(e) => { setFEmd(e.target.value); setSel(new Set()); }}>
                  <option value="전체">경산시 전체</option>{emds.map((e) => <option key={e.name}>{e.name}</option>)}
                </select>
                <select aria-label="표시 수" value={fN} onChange={(e) => { setFN(Number(e.target.value)); setSel(new Set()); }}>
                  <option value={30}>상위 30동</option><option value={95}>상위 95동</option><option value={300}>상위 300동</option><option value={0}>전체</option>
                </select>
                <select aria-label="기재 구분" value={fKind} onChange={(e) => { setFKind(e.target.value as typeof fKind); setSel(new Set()); }}>
                  <option value="전체">단독·혼합</option><option value="단독">단독 기재</option><option value="혼합">혼합 기재</option>
                </select>
                <label className="chk"><input type="checkbox" checked={hideSup} onChange={(e) => setHideSup(e.target.checked)} /> 기지원(제외) 숨기기</label>
                <span className="sp" />
                <label className="file">지번 파일 불러오기(행정망)<input type="file" accept=".csv,.xlsx" onChange={(e) => e.target.files?.[0] && loadJibun(e.target.files[0])} /></label>
                <label className="file">기지원 이력 가져오기<input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => e.target.files?.[0] && importSupported(e.target.files[0])} /></label>
                <button onClick={sampleSupported}>샘플 양식</button>
              </div>
              <div className="toolbar">
                <span className="dim">선택 {chosen.length}동</span>
                <select aria-label="일괄 변경할 진행 상태" value={bulk} onChange={(e) => setBulk(e.target.value as Status)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                <button disabled={!chosen.length} onClick={() => setMany(chosen.map((b) => b.id), { status: bulk })}>선택 일괄 변경</button>
                <span className="sp" />
                <button disabled={!chosen.length} onClick={() => setPrinting(chosen)}>안내문 PDF</button>
                <button disabled={!chosen.length} onClick={hwpx}>안내문 HWPX</button>
                <button onClick={exportVisits}>방문 목록 CSV</button>
                <button onClick={exportExcel}>엑셀 명부</button>
              </div>
              <p className="dim">{fEmd} · 대상 {listAll.length.toLocaleString()}동 중 {listShown.length.toLocaleString()}동 표시 · 점수순{Object.keys(jibun).length ? ` · 지번 ${Object.keys(jibun).length.toLocaleString()}건 불러옴(화면은 가림)` : " · 지번 미결합(행정망 파일을 불러오면 엑셀에 들어감)"}</p>
              <table className="grid">
                <thead><tr>
                  <th><input type="checkbox" aria-label="전체 선택" checked={listShown.length > 0 && listShown.every((b) => sel.has(b.id))}
                    onChange={(e) => setSel(e.target.checked ? new Set(listShown.map((b) => b.id)) : new Set())} /></th>
                  <th className="r">순위</th><th>대장 PK</th><th>법정리</th><th>지번(가림)</th><th className="r">사용승인</th><th>지붕 코드</th><th>지붕 자유기재 원문</th><th>기재</th><th className="r">점수</th><th>진행 상태</th><th>확인 결과</th>
                </tr></thead>
                <tbody>{listShown.map((b) => {
                  const r = recs[b.id];
                  return (
                    <tr key={b.id} className={r?.sup ? "sup" : ""}>
                      <td><input type="checkbox" aria-label={`${b.id} 선택`} checked={sel.has(b.id)} onChange={(e) => {
                        const s = new Set(sel); if (e.target.checked) s.add(b.id); else s.delete(b.id); setSel(s);
                      }} /></td>
                      <td className="r">{b.p.pr}</td><td className="mono" title={b.id}>{b.x.pk ?? "—"}</td><td>{b.p.emd} {b.x.ri && b.x.ri !== b.p.emd ? b.x.ri : ""}</td>
                      <td className="mono">{maskJibun(jibun[b.id]) || <span className="dim">—</span>}</td><td className="r">{b.p.year ?? "불명"}</td>
                      <td>{b.p.roof || "—"}</td><td>{b.p.etc || "—"}</td><td>{b.p.rc === "혼합" ? "혼합" : "단독"}</td><td className="r">{b.p.ps!.toFixed(1)}</td>
                      <td>{r?.sup ? <span className="suptag">기지원(제외)</span> : (
                        <select aria-label="진행 상태" value={statusOf(r)} onChange={(e) => setRec(b.id, { status: e.target.value as Status })}>
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}</select>)}</td>
                      <td>{r?.result ? RESULT_LABEL[r.result] : <span className="dim">미입력</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </>
          )}

          {tab === "field" && (
            <>
              <div className="toolbar">
                <div className="seg" role="tablist">
                  <button aria-selected={group === "top"} onClick={() => setGroup("top")}>점수 상위 95동</button>
                  <button aria-selected={group === "rand"} onClick={() => setGroup("rand")}>무작위 95동 (대조군)</button>
                </div>
                <span className="sp" />
                <label className="file">확인 기록 가져오기<input type="file" accept=".csv,.xlsx" onChange={(e) => e.target.files?.[0] && importRecs(e.target.files[0])} /></label>
                <button onClick={() => {
                  download(`현장확인_${group === "top" ? "점수상위95" : "무작위95"}.csv`, [["묶음", "건물ID", "대장PK", "읍면동", "시전체순위", "점수", "지붕자유기재", "확인결과", "확인방법", "확인일", "빈집", "메모"],
                    ...groupIds.map((id) => { const b = byId.get(id)!; const r = recs[id] ?? EMPTY;
                      return [group === "top" ? "점수상위" : "무작위", id, b.x.pk ?? "", b.p.emd, b.p.pr, b.p.ps, b.p.etc ?? "", r.result, r.method, r.date, r.vacant ? "빈집" : "", r.memo]; })]);
                }}>기록 CSV 내보내기</button>
                <button onClick={() => exportDept("build")}>건축부서 정정 요청 목록</button>
                <button onClick={() => exportDept("vacant")}>빈집 부서 연계 목록</button>
              </div>
              <table className="grid compare">
                <thead><tr><th>시범 평가 묶음</th><th className="r">맞음</th><th className="r">아님·개량</th><th className="r">철거됨</th><th className="r">확인 불가</th><th className="r">미입력</th><th className="r">적중률</th></tr></thead>
                <tbody>{([["점수 상위 95동", gTop], [`무작위 95동 (대조군, 시드 ${SEED})`, gRand]] as const).map(([n, g]) => (
                  <tr key={n}><td>{n}</td><td className="r">{g["맞음"]}</td><td className="r">{g["아님·개량"]}</td><td className="r">{g["철거됨"]}</td><td className="r">{g["확인 불가"]}</td><td className="r">{g["미입력"]}</td><td className="r"><b>{pct(g.rate)}</b></td></tr>
                ))}</tbody>
              </table>
              <p className="dim">적중률 = 맞음 ÷ (맞음 + 아님·개량 + 철거됨). 무작위 95동은 점수 상위 95동을 뺀 나머지 명부에서 시드를 고정해 뽑습니다. 건축부서 목록은 진행 상태가 '처리 완료'인데 대장 지붕이 아직 슬레이트로 적힌 집, 빈집 목록은 확인 시 '빈집'으로 표시한 집입니다.</p>
              <table className="grid">
                <thead><tr><th className="r">순위</th><th>대장 PK</th><th>읍·면·동</th><th>지붕 자유기재</th><th>결과</th><th>방법</th><th>날짜</th><th>빈집</th><th>메모</th><th /></tr></thead>
                <tbody>{groupIds.map((id) => {
                  const b = byId.get(id)!; const r = recs[id] ?? EMPTY;
                  return (
                    <tr key={id}>
                      <td className="r">{b.p.pr}</td><td className="mono" title={id}>{b.x.pk ?? id}</td><td>{b.p.emd}</td><td>{b.p.etc || "—"}</td>
                      <td><select aria-label="결과" value={r.result} onChange={(e) => setRec(id, { result: e.target.value as Result, date: r.date || today() })}>
                        <option value="">—</option>{RESULTS.map((x) => <option key={x} value={x}>{RESULT_LABEL[x]}</option>)}</select></td>
                      <td><select aria-label="방법" value={r.method} onChange={(e) => setRec(id, { method: e.target.value as Rec["method"] })}>
                        <option value="">—</option><option>현장</option><option>로드뷰</option></select></td>
                      <td><input type="date" aria-label="날짜" value={r.date} onChange={(e) => setRec(id, { date: e.target.value })} /></td>
                      <td><input type="checkbox" aria-label="빈집" checked={Boolean(r.vacant)} onChange={(e) => setRec(id, { vacant: e.target.checked })} /></td>
                      <td><input type="text" aria-label="메모" value={r.memo} onChange={(e) => setRec(id, { memo: e.target.value })} /></td>
                      <td><a className="rv" href={`https://map.kakao.com/link/roadview/${b.lat.toFixed(6)},${b.lon.toFixed(6)}`} target="_blank" rel="noreferrer">로드뷰</a></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </>
          )}

          {tab === "budget" && sum && (
            <>
              <p className="dim">기후부 수요 조사 제출 근거용 — 대장 기재 기준 명부 규모를 연 처리 물량과 동당 단가로 환산합니다.</p>
              <div className="toolbar">
                <label>연 처리 물량(동) <input type="number" min={1} value={perYear} onChange={(e) => setPerYear(Number(e.target.value))} /></label>
                <label>동당 단가(만 원) <input type="number" min={0} value={unit} onChange={(e) => setUnit(Number(e.target.value))} /></label>
                <span className="sp" />
                <button onClick={exportBudget}>결과 CSV 내보내기</button>
              </div>
              <div className="cards">
                {budgetRows.map(([k, n]) => (
                  <div className="card" key={k}><span>{k} 명부 {n.toLocaleString()}동</span>
                    <b>{years(n).toFixed(1)}년 · {((n * unit) / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 })}억 원</b>
                    <small>{n.toLocaleString()} ÷ {perYear}동/년 · {n.toLocaleString()} × {unit.toLocaleString()}만 원</small></div>
                ))}
              </div>
              <table className="grid">
                <thead><tr><th>구분</th><th className="r">명부 규모</th><th className="r">연 처리 물량</th><th className="r">소요 연수</th><th className="r">동당 단가</th><th className="r">필요 예산</th></tr></thead>
                <tbody>{budgetRows.map(([k, n]) => (
                  <tr key={k}><td>{k}</td><td className="r">{n.toLocaleString()}동</td><td className="r">{perYear}동</td><td className="r">{years(n).toFixed(1)}년</td><td className="r">{unit.toLocaleString()}만 원</td><td className="r">{((n * unit) / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 })}억 원</td></tr>
                ))}</tbody>
              </table>
              <p className="dim">기본값: 2026년 경산시 주택 철거 지원 95동(아주경제 2026.4.11 보도), 동당 700만 원. 단순 환산이며 대장 기재 기준이라 실제보다 많을 수 있습니다. 현장 확인 적중률이 쌓이면 명부 규모에 곱해 보정할 수 있습니다{allRec.rate != null ? ` (현재 적중률 ${pct(allRec.rate)} 적용 시 최대 ${Math.round(sum.max * allRec.rate).toLocaleString()}동)` : ""}.</p>
            </>
          )}

          {tab === "law" && (
            laws.length ? (
              <table className="grid">
                <thead><tr><th>법령</th><th>조문</th><th>제목</th><th>안내문 표기</th><th>쓰이는 곳</th><th>조회일</th><th>원문</th></tr></thead>
                <tbody>{laws.map((l) => <tr key={l.law + l.article}><td>{l.law}</td><td>{l.article}</td><td>{l.title}</td><td>{l.support ? "지원 근거" : "관련 법령"}</td><td>{l.use}</td><td>{l.fetched}</td>
                  <td><a className="rv" href={l.url} target="_blank" rel="noreferrer">law.go.kr</a></td></tr>)}</tbody>
              </table>
            ) : (
              <p className="dim law-empty">근거 법령은 국가법령정보센터 Open API로 조회한 조문만 싣습니다. 아직 조회하지 못해 비어 있습니다(Open API 인증값 OC 미확보). 조회 전에는 안내문에도 근거 줄을 넣지 않습니다.</p>
            )
          )}
        </main>
      )}
    </div>
  );
}
