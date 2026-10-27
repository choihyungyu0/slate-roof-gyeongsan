"use client";

// 담당 공무원용 행정 화면(시제품) v2 — 사각119 실무 모드와 같은 3단 틀(상단 바 · 왼쪽 메뉴 · 작업 영역 + 오른쪽 패널 · 하단 상태바).
// 서버 없이 브라우저 localStorage와 파일 내보내기/가져오기로만 저장한다.
// 지번은 배포 자료에 넣지 않는다. 행정망 내부 파일(outputs/private/jibun_경산시.csv)을 담당자가 직접 불러올 때만
// 메모리에 올려 화면에는 가려서 보여주고, 엑셀 내보내기에만 넣는다. 점수·순위 계산은 /map 과 같다(app/shared.ts).
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { bid, csvBlob, EMPTY_REC as EMPTY, eoScore, type Extra, loadExtra, loadRecs, loadWeights, type Rec, type Result, RESULT_LABEL, RESULTS,
  rescore, saveRecs, type Status, STATUSES, today, W_DEFAULT, W_PARTS } from "../shared";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./admin.css";
import { buildHwpx, type Line } from "./hwpx";

type P = {
  cat: number; emd: string; roof?: string; etc?: string; rc?: string; year?: number | null; area?: number | null; pm?: number; pw?: number;
  ps?: number; pr?: number; ds?: number; dd?: number; de?: number; eo?: number; ca?: number; cr?: number; cs?: number; cd?: number; ce?: number; cc?: number;
};
type B = { id: string; p: P; lon: number; lat: number; x: Extra };
type Emd = { name: string; houses: number; sure: number; max: number };
type Summary = { houses: number; code: number; sure: number; max: number; llm: { n: number; same4: number; same2: number }; permit: { n: number; any: number } };
type Rule = { order: number; label: string; note: string; pattern: string; examples: string[]; n: number };
type Join = { rows: { name: string; org: string; date: string; unit: string; rate: string }[]; elderly_ym: string };
type Law = { law: string; article: string; title: string; use: string; fetched: string; url: string; support?: boolean };
type Review = { emd: Record<string, number>; amb: { n: number; kinds: number; excluded: number; excluded_kinds: number; rows: { text: string; n: number; excluded: number }[] };
  old: { n: number; max: number; sure: number } };
type Mode = "work" | "review";
type View = "todo" | "roster" | "progress" | "field" | "demand" | "rules" | "verify" | "formula" | "data" | "law";
type Role = "담당" | "읍면동" | "생활지원사";
const SEED = 20261028;
const POLICY = "선정은 해당 연도 공고 기준을 따르며, 온지붕 점수는 안내·현장 확인 순서에만 씁니다";
const HAS_KEY = (process.env.NEXT_PUBLIC_VWORLD_KEY ?? "").length > 0;
const ROLE_LABEL: Record<Role, string> = { 담당: "슬레이트 사업 담당", 읍면동: "읍면동", 생활지원사: "생활지원사" };
const ROLE_START: Record<Role, View> = { 담당: "todo", 읍면동: "roster", 생활지원사: "field" };
const SYM_LABEL: Record<string, string> = { "○": "안내 전", "◐": "진행 중", "●": "완료" };
const STEPS: Status[] = ["미안내", "안내 발송", "신청", "현장 확인", "선정", "처리 완료"];
const PARTS6 = W_PARTS.filter((w) => w.key !== "eo");
// 가중치 ±0.10 민감도 (reports/priority_result.md — 상위 95동이 기본값 상위 95동과 겹치는 수)
const SENS: [string, number, number][] = [["노후도", 90, 91], ["지붕 면적", 78, 73], ["학교 거리", 86, 81], ["어린이집 거리", 87, 68], ["경로당 거리", 84, 82], ["기재 확실성", 76, 78]];

// 아이콘 (선 1.8px, 16px)
const I = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const IC = {
  todo: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14",
  roster: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  progress: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  field: "M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  demand: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  rules: "M4 6h16M4 12h10M4 18h6M17 15l2 2 4-4",
  verify: "M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4zM9 12l2 2 4-4",
  formula: "M5 4h14M7 20l10-16M7 4l10 16",
  data: "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  law: "M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0L7 7zM17 7l-3 7a3 3 0 0 0 6 0l-3-7zM8 21h8",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
  print: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
};
const WORK_NAV: { v: View | "map"; t: string; s: string; i: string }[] = [
  { v: "todo", t: "올해 할 일", s: "올해 어디부터 안내하나", i: IC.todo },
  { v: "map", t: "지도", s: "항공영상·3D", i: IC.map },
  { v: "roster", t: "명부", s: "점수순 대상 집", i: IC.roster },
  { v: "progress", t: "진행 현황", s: "어디까지 했나", i: IC.progress },
  { v: "field", t: "현장 확인", s: "명부가 맞았나", i: IC.field },
  { v: "demand", t: "수요 조사", s: "내년에 얼마 필요하나", i: IC.demand },
];
const REVIEW_NAV: { v: View; t: string; s: string; i: string }[] = [
  { v: "rules", t: "판정 규칙", s: "표기 2,662종을 어떻게 나눴나", i: IC.rules },
  { v: "verify", t: "검증", s: "믿어도 되나", i: IC.verify },
  { v: "formula", t: "점수 산식", s: "왜 이 순서인가", i: IC.formula },
  { v: "data", t: "데이터·출처", s: "무엇을 결합했나", i: IC.data },
  { v: "law", t: "근거 법령", s: "어떤 조문에 기대나", i: IC.law },
];

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
const Z = ({ n }: { n: number }) => (n ? <>{n.toLocaleString()}</> : <span className="z">0</span>);
const pct = (r: number | null) => (r == null ? "기록 없음" : `${(r * 100).toFixed(1)}%`);
const statusOf = (r?: Rec): Status => r?.status ?? "미안내";
const SENT: Status[] = ["안내 발송", "신청", "현장 확인", "선정", "처리 완료"];
// 진행 기호: ○ 아직 안내 전 · ◐ 진행 중 · ● 모두 처리 완료(또는 대상 아님)
function progSym(recs: Record<string, Rec>, ids: string[]) {
  const st = ids.map((id) => statusOf(recs[id]));
  if (!st.length || st.every((s) => s === "미안내")) return "○";
  if (st.every((s) => s === "처리 완료" || s === "대상 아님")) return "●";
  return "◐";
}

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
// 자유기재 원문에서 슬레이트 표기만 빨간 글씨로
function markSlate(s: string | undefined) {
  if (!s) return <span className="sub">(빈값)</span>;
  return s.split(/(스레트|슬레이트|스레이트|슬레트)/).map((x, i) => (i % 2 ? <b key={i} className="red">{x}</b> : <span key={i}>{x}</span>));
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

const Kpi = ({ l, v, u, d, red, muted }: { l: string; v: React.ReactNode; u?: string; d: string; red?: boolean; muted?: boolean }) => (
  <div className={`a2-kpi${red ? " red" : ""}${muted ? " muted" : ""}`}><div className="l">{l}</div><div className="v">{v}{u && <small>{u}</small>}</div><div className="d" title={d}>{d}</div></div>
);

export default function AdminView() {
  const [mode, setMode] = useState<Mode>("work");
  const [view, setView] = useState<View>("todo");
  const [role, setRole] = useState<Role>("담당");
  const [pop, setPop] = useState<"" | "help" | "privacy">("");
  const [bld, setBld] = useState<B[]>([]);
  const [emds, setEmds] = useState<Emd[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [join, setJoin] = useState<Join | null>(null);
  const [laws, setLaws] = useState<Law[]>([]);
  const [rv, setRv] = useState<Review | null>(null);
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
  const [cur, setCur] = useState<string | null>(null);      // 명부에서 누른 집
  const [curEmd, setCurEmd] = useState<string | null>(null); // 올해 할 일에서 누른 읍면동
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
      setRv(await fetch("/data/review.json").then((r) => r.json()));
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
  const sent = SENT.reduce((n, s) => n + stCount[s], 0);
  // 읍면동별: 명부 집, 상위 95 포함, 법정리별 수, 진행 상태별 수
  const emdRows = useMemo(() => emds.map((e) => {
    const list = bld.filter((b) => b.p.emd === e.name);
    const ids = list.map((b) => b.id);
    const top = list.filter((b) => b.p.pr! <= 95);
    const ri = new Map<string, number>();
    for (const b of top.length ? top : list) { const k = b.x.ri ?? e.name; ri.set(k, (ri.get(k) ?? 0) + 1); }
    const st = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    for (const id of ids) st[statusOf(recs[id])]++;
    return { ...e, ids, list, top: top.length, topIds: top.map((b) => b.id), ri: [...ri.entries()].sort((a, b) => b[1] - a[1]), st,
      miss: rv?.emd[e.name] ?? 0, sym: progSym(recs, top.length ? top.map((b) => b.id) : ids) };
  }).sort((a, b) => b.top - a.top || b.max - a.max), [emds, bld, recs, rv]);
  const lawName = (l: Law) => (l.law === "개인정보 보호법" && l.article === "제18조" ? `${l.law} 제18조(목적 외 이용·제공 제한)` : `${l.law} ${l.article}`);
  const joinLaws = (ls: Law[]) => [...new Set(ls.map((l) => l.law))].map((n) => {
    const g = ls.filter((l) => l.law === n);
    return g.length === 1 ? lawName(g[0]) : `${n} ${g.map((l) => l.article).join("·")}`;
  }).join(", ");
  // 안내문 하단: 본문에 비용 지원 내용이 있는 조문만 "근거:", 나머지는 "관련 법령:"(법령명·조문 번호만)
  const lawLine = [laws.some((l) => l.support) && `근거: ${joinLaws(laws.filter((l) => l.support))}`,
    laws.some((l) => !l.support) && `관련 법령: ${joinLaws(laws.filter((l) => !l.support))}`].filter(Boolean).join(" / ");
  const asbestosArts = laws.filter((l) => l.law === "석면안전관리법").map((l) => l.article.replace(/^제|조$/g, "")).join("·");

  const hasJ = Object.keys(jibun).length > 0;
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
  const go = (v: View) => { setView(v); setPop(""); };
  const switchMode = (m: Mode) => { setMode(m); go(m === "work" ? ROLE_START[role] : "rules"); };

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
  const hwpx = async (list: B[] = chosen) => save(`슬레이트_지원안내_${list.length}건.hwpx`, await buildHwpx(list.map((b) => noticeLines(b, lawLine))));

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
  // 이장 회의용 법정리별 목록 (주소·지번 없이 건물 ID와 대장 PK만)
  const exportRi = (name: string) => {
    const e = emdRows.find((x) => x.name === name)!;
    const g = new Map<string, B[]>();
    for (const b of e.list) { const k = b.x.ri ?? name; g.set(k, [...(g.get(k) ?? []), b]); }
    download(`이장회의_리별목록_${name}.csv`, [["읍면동", "법정리", "명부 수", "상위 95 포함", "안내 발송 이상", "건물ID(점수순)", "대장PK(점수순)"],
      ...[...g.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, list]) => [name, k, list.length, list.filter((b) => b.p.pr! <= 95).length,
        list.filter((b) => SENT.includes(statusOf(recs[b.id]))).length, list.map((b) => b.id).join(" "), list.map((b) => b.x.pk ?? "").join(" ")])]);
  };
  // 실적 보고용 엑셀 (읍면동별 진행 상태)
  const exportProgress = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["읍면동", "명부", ...STATUSES, "처리 완료율(%)"],
      ...emdRows.filter((e) => e.ids.length).map((e) => [e.name, e.ids.length, ...STATUSES.map((s) => e.st[s]), Number(((e.st["처리 완료"] / e.ids.length) * 100).toFixed(1))]),
      ["합계", bld.length, ...STATUSES.map((s) => stCount[s]), Number(((stCount["처리 완료"] / Math.max(bld.length, 1)) * 100).toFixed(1))]]);
    ws["!cols"] = [10, 8, 8, 10, 8, 10, 8, 10, 10, 14].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, "읍면동별 진행");
    XLSX.writeFile(wb, `온지붕_실적보고_경산시_${today().replace(/-/g, "")}.xlsx`);
  };

  const groupIds = group === "top" ? top95 : rand95;
  const gTop = hit(recs, top95), gRand = hit(recs, rand95);
  const curB = cur ? byId.get(cur) : undefined;
  const curE = curEmd ? emdRows.find((e) => e.name === curEmd) : undefined;
  const sumSym = { 미안내: stCount["미안내"], 진행: SENT.slice(0, 4).reduce((n, s) => n + stCount[s], 0), 완료: stCount["처리 완료"] };
  const openRoster = (name: string) => { setFEmd(name); setFN(0); setSel(new Set()); go("roster"); };

  const emdTodo = (e: (typeof emdRows)[number]) => (
    <dl>
      <dt>지금 할 일</dt><dd>상위 {e.top}동 안내문 발송 + 이장 회의용 리별 목록 전달</dd>
      <dt>왜</dt><dd>확실 {e.sure.toLocaleString()}~최대 {e.max.toLocaleString()}동, 이 중 코드가 놓친 집 {e.miss.toLocaleString()}동</dd>
      <dt>어디부터</dt><dd>{e.ri.slice(0, 2).map(([k, n]) => `${k} ${n}동`).join(" · ") || "없음"}</dd>
      <dt>집행 근거</dt><dd className="sub">해당 연도 슬레이트 처리 지원사업 공고 · 관련 법령 석면안전관리법 제{asbestosArts || "25·26"}조</dd>
    </dl>
  );
  const maxEmd = Math.max(...emdRows.map((e) => e.max), 1);

  return (
    <div className="adm a2">
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

      {/* ── 상단 바 ── */}
      <header className="a2-top">
        <a className="a2-logo" href="/admin">
          <span className="mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10" /></svg></span>
          <b>온지붕</b><small>슬레이트 주택 찾아가는 안내 시스템</small>
        </a>
        <div className="right">
          <select className="control" aria-label="지역" value="경산시" onChange={() => undefined}><option>경산시</option></select>
          <select className="control" aria-label="역할" value={role} title="역할은 첫 화면 순서만 바꿉니다. 어느 역할이든 모든 화면을 볼 수 있습니다"
            onChange={(e) => { const r = e.target.value as Role; setRole(r); if (mode === "work") go(ROLE_START[r]); }}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <span className="vr" />
          <div className="seg" role="group" aria-label="표시 모드">
            <button aria-pressed={mode === "work"} onClick={() => switchMode("work")}>실무</button>
            <button aria-pressed={mode === "review"} onClick={() => switchMode("review")}>심사·검증</button>
          </div>
          <span className="vr" />
          <button className="btn" aria-label="도움말" onClick={() => setPop(pop === "help" ? "" : "help")}><I d={IC.help} />도움말</button>
          <button className="btn" onClick={() => window.print()}><I d={IC.print} />인쇄</button>
        </div>
      </header>
      {pop === "help" && (
        <div className="a2-pop" role="dialog" aria-label="도움말">
          <h3>이렇게 씁니다</h3>
          <p><b>올해 할 일</b>: 명부 상위 읍면부터 안내문을 보내고 이장 회의에 리별 목록을 전달합니다.</p>
          <p><b>명부</b>: 점수순 대상 집. 행을 누르면 오른쪽에 대장 기재와 점수 근거가 나옵니다.</p>
          <p><b>진행 현황·현장 확인</b>: 진행 상태와 확인 결과는 이 브라우저에만 저장됩니다. 기록 CSV로 주고받습니다.</p>
          <p><b>심사·검증</b>: 판정 규칙, 검증 결과, 점수 산식, 데이터 출처, 근거 법령.</p>
          <p className="sub">{POLICY}.</p>
          <button className="btn sm" onClick={() => setPop("")}>닫기</button>
        </div>
      )}

      <div className="a2-body">
        {/* ── 왼쪽 메뉴 ── */}
        <nav className="a2-nav" aria-label="메뉴">
          <div className="grp">{mode === "work" ? "실무" : "심사·검증"}</div>
          <ul>
            {(mode === "work" ? WORK_NAV : REVIEW_NAV).map((n) => (
              <li key={n.v}>
                {n.v === "map" ? (
                  <a href="/map"><I d={n.i} /><span><span className="t">{n.t}</span><span className="s">{n.s}</span></span><span className="ext">↗</span></a>
                ) : (
                  <button aria-current={view === n.v ? "page" : undefined} onClick={() => go(n.v as View)}>
                    <I d={n.i} /><span><span className="t">{n.t}</span><span className="s">{n.s}</span></span></button>
                )}
              </li>
            ))}
          </ul>
          <div className="sum">
            <div className="lbl"><span>진행 상태</span><span>명부 {bld.length.toLocaleString()}동</span></div>
            <div className="meter" aria-hidden="true">
              <i style={{ width: `${(sumSym["완료"] / Math.max(bld.length, 1)) * 100}%`, background: "var(--blue)" }} />
              <i style={{ width: `${(sumSym["진행"] / Math.max(bld.length, 1)) * 100}%`, background: "var(--blue-line)" }} />
            </div>
            <div className="g">
              <div><span>○ 미안내</span><b>{sumSym["미안내"].toLocaleString()}</b></div>
              <div><span>◐ 진행</span><b>{sumSym["진행"].toLocaleString()}</b></div>
              <div><span>● 완료</span><b>{sumSym["완료"].toLocaleString()}</b></div>
            </div>
          </div>
        </nav>

        {/* ── 작업 영역 ── */}
        <main className="a2-main">
          {!loaded || !sum ? <div className="a2-pane"><p className="a2-note">명부를 불러오는 중…</p></div> : (
            <>
              {view === "todo" && (
                <div className="a2-pane">
                  <div className="a2-head"><h1>올해 할 일</h1><p>{POLICY}</p></div>
                  <div className="a2-kpis">
                    <Kpi red l="대장 슬레이트 주택" v={`${sum.sure.toLocaleString()}~${sum.max.toLocaleString()}`} u="동" d="대장 기재 기준 · 확실~최대" />
                    <Kpi l="코드가 놓친 집" v={`최대 ${(sum.max - sum.code).toLocaleString()}`} u="동" d="지붕 코드만 세면 빠지는 집" />
                    <Kpi l="올해 배정" v={<input type="number" min={0} aria-label="올해 배정 동수" value={quota} onChange={(e) => setQuota(Number(e.target.value))} />} u="동" d="입력 · 2026년 95동(보도)" />
                    <Kpi l="안내 발송" v={sent.toLocaleString()} u="동" d={`배정 ${quota}동 대비`} />
                    <Kpi muted={!allRec.judged} l="현장 확인 적중률" v={allRec.judged ? pct(allRec.rate) : "기록 없음"} d={allRec.judged ? `맞음 ${allRec["맞음"]} / 판정 ${allRec.judged}동` : "현장 확인을 기록하면 계산"} />
                    <Kpi l="지금 속도면" v={quota > 0 ? `${(sum.sure / quota).toFixed(1)}~${(sum.max / quota).toFixed(1)}` : "배정 입력"} u={quota > 0 ? "년" : undefined} d={`연 ${quota}동 처리 시 · 단순 환산`} />
                  </div>
                  <div className="a2-cards">
                        {emdRows.slice(0, 3).map((e, i) => (
                          <div className="a2-card a2-pri" key={e.name}>
                            <div className="hd"><span className={`rk r${i + 1}`} aria-label={`${i + 1}순위`}>{i + 1}</span><span className="nm">{e.name}</span>
                              <span className="prog" title="○ 안내 전 · ◐ 진행 중 · ● 완료"><b>{e.sym}</b>{SYM_LABEL[e.sym]}</span></div>
                            {emdTodo(e)}
                            <div className="ft"><span className="sub">명부 {e.ids.length.toLocaleString()}동 · 상위 95 포함 <b style={{ color: "var(--ink)" }}>{e.top}동</b></span>
                              <button className="btn sm ghost" onClick={() => openRoster(e.name)}>명부 열기 →</button></div>
                          </div>
                        ))}
                  </div>
                  <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
                      <div className="a2-tbl">
                        <table className="t">
                          <colgroup><col style={{ width: 64 }} /><col style={{ width: 140 }} /><col /><col style={{ width: 130 }} /><col style={{ width: 120 }} /><col style={{ width: 150 }} /><col style={{ width: 72 }} /></colgroup>
                          <thead><tr><th className="r">순위</th><th>읍면동</th><th>확실 ~ 최대</th><th className="r">코드가 놓친 집</th><th className="r">상위 95 포함</th><th className="r">안내 · 신청 · 완료</th><th className="c">진행</th></tr></thead>
                          <tbody>{emdRows.map((e, i) => (
                            <tr key={e.name} aria-selected={curEmd === e.name} onClick={() => setCurEmd(e.name)}>
                              <td className="r sub">{i + 1}</td><td><b>{e.name}</b></td>
                              <td><span className="rangebar l"><span>{e.sure.toLocaleString()} ~ {e.max.toLocaleString()}</span>
                                <i aria-hidden="true"><b className="mx" style={{ width: `${(e.max / maxEmd) * 100}%` }} /><b className="su" style={{ width: `${(e.sure / maxEmd) * 100}%` }} /></i></span></td>
                              <td className="r"><Z n={e.miss} /></td>
                              <td className="r">{e.top ? <b>{e.top}</b> : <span className="z">0</span>}</td>
                              <td className="r">{SENT.reduce((n, s) => n + e.st[s], 0)} · {e.st["신청"] + e.st["현장 확인"] + e.st["선정"] + e.st["처리 완료"]} · {e.st["처리 완료"]}</td>
                              <td className="c"><span className="sym" title={SYM_LABEL[e.sym]}>{e.sym}</span></td>
                            </tr>
                          ))}</tbody>
                        </table>
                      </div>
                    {curE && (
                      <aside className="a2-side">
                        <p className="eyebrow">읍면동 · {SYM_LABEL[curE.sym]} {curE.sym}</p>
                        <h2>{curE.name}</h2>
                        <p className="a2-note">명부 {curE.ids.length.toLocaleString()}동 · 상위 95 포함 {curE.top}동</p>
                        <h4>할 일</h4>
                        <div className="a2-card block" style={{ boxShadow: "none" }}>{emdTodo(curE)}</div>
                        <h4>내보내기</h4>
                        <div className="todo">
                          <button className="btn" onClick={() => hwpx(curE.top ? curE.topIds.map((id) => byId.get(id)!) : curE.list.slice(0, 20))}>안내문 HWPX ({curE.top || Math.min(20, curE.list.length)}건)</button>
                          <button className="btn" onClick={() => exportRi(curE.name)}>이장용 리별 목록</button>
                          <button className="btn" onClick={exportExcel}>엑셀 명부</button>
                          <button className="btn primary" onClick={() => openRoster(curE.name)}>명부 열기</button>
                        </div>
                      </aside>
                    )}
                  </div>
                </div>
              )}

              {view === "roster" && (
                <div className="a2-pane" style={{ flexDirection: "row", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                    <div className="a2-head"><h1>명부</h1><p className="policy-inline">{POLICY}</p></div>
                    <div className="a2-bar">
                      <select className="control" aria-label="읍·면·동" value={fEmd} onChange={(e) => { setFEmd(e.target.value); setSel(new Set()); }}>
                        <option value="전체">경산시 전체</option>{emds.map((e) => <option key={e.name}>{e.name}</option>)}
                      </select>
                      <select className="control" aria-label="표시 수" value={fN} onChange={(e) => { setFN(Number(e.target.value)); setSel(new Set()); }}>
                        <option value={30}>상위 30동</option><option value={95}>상위 95동</option><option value={300}>상위 300동</option><option value={0}>전체</option>
                      </select>
                      <select className="control" aria-label="기재 구분" value={fKind} onChange={(e) => { setFKind(e.target.value as typeof fKind); setSel(new Set()); }}>
                        <option value="전체">단독·혼합</option><option value="단독">단독 기재</option><option value="혼합">혼합 기재</option>
                      </select>
                      <label className="chk"><input type="checkbox" checked={hideSup} onChange={(e) => setHideSup(e.target.checked)} /> 기지원 숨기기</label>
                      <span className="sep" /><span className="sel-n">선택 <b>{chosen.length}</b>동</span>
                      <select className="control" aria-label="일괄 변경할 진행 상태" value={bulk} onChange={(e) => setBulk(e.target.value as Status)}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                      <button className="btn" disabled={!chosen.length} onClick={() => setMany(chosen.map((b) => b.id), { status: bulk })}>선택 일괄 변경</button>
                    </div>
                    <div className="a2-bar">
                      <label className="btn">지번 파일(행정망)<input type="file" accept=".csv,.xlsx" aria-label="지번 파일 불러오기" onChange={(e) => e.target.files?.[0] && loadJibun(e.target.files[0])} /></label>
                      <label className="btn">기지원 이력<input type="file" accept=".csv,.xlsx,.xls" aria-label="기지원 이력 가져오기" onChange={(e) => e.target.files?.[0] && importSupported(e.target.files[0])} /></label>
                      <button className="btn ghost" onClick={sampleSupported}>샘플 양식</button>
                      <span className="sp" />
                      <button className="btn" disabled={!chosen.length} onClick={() => setPrinting(chosen)}>안내문 PDF</button>
                      <button className="btn" disabled={!chosen.length} onClick={() => hwpx()}>안내문 HWPX</button>
                      <button className="btn" onClick={exportVisits}>방문 목록 CSV</button>
                      <button className="btn primary" onClick={exportExcel}>엑셀 명부</button>
                    </div>
                    <p className="a2-note">{fEmd} · 대상 {listAll.length.toLocaleString()}동 중 {listShown.length.toLocaleString()}동 · 점수순{hasJ ? ` · 지번 ${Object.keys(jibun).length.toLocaleString()}건 불러옴(화면은 가림, 엑셀에만 들어감)` : " · 지번은 행정망 파일을 불러오면 표시"}</p>
                    <div className="a2-tbl">
                      <table className="t">
                        <thead><tr>
                          <th><input type="checkbox" aria-label="전체 선택" checked={listShown.length > 0 && listShown.every((b) => sel.has(b.id))}
                            onChange={(e) => setSel(e.target.checked ? new Set(listShown.map((b) => b.id)) : new Set())} /></th>
                          <th className="r">순위</th><th>대장 PK</th><th>법정리</th>{hasJ && <th>지번(가림)</th>}<th className="r">사용승인</th><th>지붕 코드</th><th>자유기재 원문</th><th>기재</th><th className="r">점수</th><th>진행 상태</th><th>확인 결과</th>
                        </tr></thead>
                        <tbody>{listShown.map((b) => {
                          const r = recs[b.id];
                          return (
                            <tr key={b.id} className={r?.sup ? "sup" : ""} aria-selected={cur === b.id || sel.has(b.id)} data-id={b.id} onClick={() => setCur(b.id)}>
                              <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`${b.id} 선택`} checked={sel.has(b.id)} onChange={(e) => {
                                const s = new Set(sel); if (e.target.checked) s.add(b.id); else s.delete(b.id); setSel(s);
                              }} /></td>
                              <td className="r">{b.p.pr}</td><td className="mono" title={b.id}>{b.x.pk ?? "없음"}</td><td>{b.p.emd} {b.x.ri && b.x.ri !== b.p.emd ? b.x.ri : ""}</td>
                              {hasJ && <td className="mono jb">{maskJibun(jibun[b.id]) || <span className="sub">없음</span>}</td>}<td className="r">{b.p.year ?? "불명"}</td>
                              <td>{b.p.roof || <span className="sub">빈값</span>}</td><td title={b.p.etc}>{b.p.etc || <span className="sub">빈값</span>}</td>
                              <td>{b.p.rc === "혼합" ? <span className="a2-chip mix">혼합</span> : <span className="a2-chip sure">단독</span>}</td>
                              <td className="r sc">{b.p.ps!.toFixed(1)}</td>
                              <td onClick={(e) => e.stopPropagation()}>{r?.sup ? <span className="a2-chip ref">기지원(제외)</span> : (
                                <select aria-label="진행 상태" value={statusOf(r)} onChange={(e) => setRec(b.id, { status: e.target.value as Status })}>
                                  {STATUSES.map((s) => <option key={s}>{s}</option>)}</select>)}</td>
                              <td>{r?.result ? RESULT_LABEL[r.result] : <span className="sub">미입력</span>}</td>
                            </tr>
                          );
                        })}</tbody>
                      </table>
                    </div>
                  </div>
                  <aside className="a2-side">
                    {!curB ? <p className="empty"><I d={IC.roster} />명부의 행을 누르면<br />그 집의 대장 기재와 점수 근거가 나옵니다.</p> : (() => {
                      const r = recs[curB.id] ?? EMPTY;
                      return (
                        <>
                          <p className="eyebrow">{curB.p.pr}위 / {bld.length.toLocaleString()}동 · {curB.id}</p>
                          <h2>{curB.p.emd} {curB.x.ri && curB.x.ri !== curB.p.emd ? curB.x.ri : ""}</h2>
                          <dl className="kv" style={{ marginTop: 8 }}>
                            <dt>대장 PK</dt><dd className="num" style={{ textAlign: "left" }}>{curB.x.pk ?? "없음"}</dd>
                            <dt>법정리</dt><dd>{curB.x.ri ?? "없음"}</dd>
                            <dt>사용승인</dt><dd>{curB.p.year ?? "불명"}{curB.p.area != null ? ` · 건축면적 ${curB.p.area}㎡` : ""}</dd>
                          </dl>
                          <h4>지붕: 코드와 자유기재 원문</h4>
                          <dl className="kv">
                            <dt>지붕 코드</dt><dd>{curB.p.roof || <span className="sub">(빈값)</span>}</dd>
                            <dt>원문</dt><dd>{markSlate(curB.p.etc)}</dd>
                            <dt>판정</dt><dd>{curB.p.rc === "혼합" ? <span className="a2-chip mix">혼합 기재</span> : <span className="a2-chip sure">슬레이트</span>}</dd>
                          </dl>
                          <h4>점수</h4>
                          <div className="a2-big">{curB.p.ps!.toFixed(1)}<small className="sub">/ 100</small></div>
                          <div className="bars">
                            {PARTS6.map((w) => (
                              <div key={w.key}><span>{w.label}</span><i><b style={{ width: `${Math.round((curB.p[w.key as keyof P] as number ?? 0) * 100)}%` }} /></i>
                                <span className="num">{Math.round((curB.p[w.key as keyof P] as number ?? 0) * 100)}</span></div>
                            ))}
                          </div>
                          <h4>진행 상태</h4>
                          <select className="control" style={{ width: "100%" }} aria-label="이 집 진행 상태" value={statusOf(r)} onChange={(e) => setRec(curB.id, { status: e.target.value as Status })}>
                            {STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                          <h4>현장 확인</h4>
                          <div className="acts">
                            {RESULTS.map((x) => <button key={x} className="btn" aria-pressed={r.result === x} onClick={() => setRec(curB.id, { result: x, date: r.date || today() })}>{RESULT_LABEL[x]}</button>)}
                          </div>
                          <p style={{ marginTop: 12 }}><a href={`https://map.kakao.com/link/roadview/${curB.lat.toFixed(6)},${curB.lon.toFixed(6)}`} target="_blank" rel="noreferrer">로드뷰로 보기 ↗</a></p>
                        </>
                      );
                    })()}
                  </aside>
                </div>
              )}

              {view === "progress" && (
                <div className="a2-pane">
                  <div className="a2-head"><h1>진행 현황</h1><p>명부 {bld.length.toLocaleString()}동 기준 · 대상 아님 {stCount["대상 아님"]}동 별도</p>
                    <div className="right"><button className="btn primary" onClick={exportProgress}>실적 보고용 엑셀</button></div></div>
                  <div className="a2-steps">
                    {STEPS.map((s, i) => (
                      <div key={s}><span><em>{i + 1}</em>{s}</span><b>{stCount[s].toLocaleString()}<small>동</small></b>
                        <span className="p">{pct(bld.length ? stCount[s] / bld.length : null)}</span>
                        <span className="track"><i style={{ width: `${bld.length ? (stCount[s] / bld.length) * 100 : 0}%` }} /></span></div>
                    ))}
                  </div>
                  <div className="a2-tbl">
                    <table className="t">
                      <thead><tr><th>읍면동</th><th className="r">명부</th>{STATUSES.map((s) => <th key={s} className="r">{s}</th>)}<th className="r">처리 완료율</th><th className="c">진행</th></tr></thead>
                      <tbody>{emdRows.filter((e) => e.ids.length).map((e) => (
                        <tr key={e.name}><td><b>{e.name}</b></td><td className="r">{e.ids.length.toLocaleString()}</td>
                          {STATUSES.map((s) => <td key={s} className="r"><Z n={e.st[s]} /></td>)}
                          <td className="r">{e.st["처리 완료"] ? pct(e.st["처리 완료"] / e.ids.length) : <span className="z">0%</span>}</td><td className="c"><span className="sym">{e.sym}</span></td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}

              {view === "field" && (
                <div className="a2-pane">
                  <div className="a2-head"><h1>현장 확인</h1><p>적중률 = 맞음 ÷ (맞음 + 아님·개량 + 철거됨)</p>
                    <div className="right">
                      <label className="btn">확인 기록 가져오기<input type="file" accept=".csv,.xlsx" aria-label="확인 기록 가져오기" onChange={(e) => e.target.files?.[0] && importRecs(e.target.files[0])} /></label>
                      <button className="btn" onClick={() => {
                        download(`현장확인_${group === "top" ? "점수상위95" : "무작위95"}.csv`, [["묶음", "건물ID", "대장PK", "읍면동", "시전체순위", "점수", "지붕자유기재", "확인결과", "확인방법", "확인일", "빈집", "메모"],
                          ...groupIds.map((id) => { const b = byId.get(id)!; const r = recs[id] ?? EMPTY;
                            return [group === "top" ? "점수상위" : "무작위", id, b.x.pk ?? "", b.p.emd, b.p.pr, b.p.ps, b.p.etc ?? "", r.result, r.method, r.date, r.vacant ? "빈집" : "", r.memo]; })]);
                      }}>기록 CSV 내보내기</button>
                      <button className="btn" onClick={() => exportDept("build")}>건축부서 정정 요청 목록</button>
                      <button className="btn" onClick={() => exportDept("vacant")}>빈집 부서 연계 목록</button>
                    </div>
                  </div>
                  <div className="a2-cards c2 compare">
                    {([["top", "점수 상위 95동", gTop], ["rand", `무작위 95동 (대조군, 시드 ${SEED})`, gRand]] as const).map(([k, n, g]) => (
                      <div key={k} role="button" tabIndex={0} className="a2-card" style={{ cursor: "pointer", outline: group === k ? "2px solid var(--blue)" : "none" }}
                        aria-pressed={group === k} onClick={() => setGroup(k)} onKeyDown={(e) => e.key === "Enter" && setGroup(k)}>
                        <h3>{n}{group === k && <span className="a2-chip ref">아래 표</span>}</h3>
                        <div className="a2-figs"><span><span className={`a2-big${g.rate == null ? " z" : ""}`}>{pct(g.rate)}</span><span className="sub">적중률{g.rate == null ? " · 기록 없음" : ""}</span></span>
                          <span className="sub">판정 {g.judged}동 / 95동</span></div>
                        <div className="a2-stack" aria-hidden="true">
                          {([["맞음", "var(--blue)"], ["아님·개량", "var(--mix)"], ["철거됨", "#98a2b3"], ["확인 불가", "#d0d5dd"]] as const).map(([x, c]) => (
                            <i key={x} style={{ width: `${(g[x] / 95) * 100}%`, background: c }} />))}
                        </div>
                        <div className="a2-legend">
                          {([["맞음", "var(--blue)"], ["아님·개량", "var(--mix)"], ["철거됨", "#98a2b3"], ["확인 불가", "#d0d5dd"], ["미입력", "#eef0f3"]] as const).map(([x, c]) => (
                            <span key={x} style={{ ["--c" as string]: c } as React.CSSProperties}>{x} {g[x]}</span>))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="a2-note">무작위 95동은 상위 95동을 뺀 명부에서 시드 고정으로 뽑습니다 · 카드를 누르면 아래 표가 바뀝니다 · 건축부서 목록 = 처리 완료인데 대장 지붕이 아직 슬레이트 · 빈집 목록 = 빈집 표시</p>
                  <div className="a2-tbl">
                    <table className="t rec">
                      <thead><tr><th className="r">순위</th><th>대장 PK</th><th>읍·면·동</th><th>지붕 자유기재</th><th>결과</th><th>방법</th><th>날짜</th><th>빈집</th><th>메모</th><th /></tr></thead>
                      <tbody>{groupIds.map((id) => {
                        const b = byId.get(id)!; const r = recs[id] ?? EMPTY;
                        return (
                          <tr key={id}>
                            <td className="r">{b.p.pr}</td><td className="mono" title={id}>{b.x.pk ?? id}</td><td>{b.p.emd}</td><td>{b.p.etc || <span className="sub">빈값</span>}</td>
                            <td><select aria-label="결과" value={r.result} onChange={(e) => setRec(id, { result: e.target.value as Result, date: r.date || today() })}>
                              <option value="">선택</option>{RESULTS.map((x) => <option key={x} value={x}>{RESULT_LABEL[x]}</option>)}</select></td>
                            <td><select aria-label="방법" value={r.method} onChange={(e) => setRec(id, { method: e.target.value as Rec["method"] })}>
                              <option value="">선택</option><option>현장</option><option>로드뷰</option></select></td>
                            <td><input type="date" aria-label="날짜" value={r.date} onChange={(e) => setRec(id, { date: e.target.value })} /></td>
                            <td><input type="checkbox" aria-label="빈집" checked={Boolean(r.vacant)} onChange={(e) => setRec(id, { vacant: e.target.checked })} /></td>
                            <td><input type="text" aria-label="메모" value={r.memo} onChange={(e) => setRec(id, { memo: e.target.value })} /></td>
                            <td><a className="rv" href={`https://map.kakao.com/link/roadview/${b.lat.toFixed(6)},${b.lon.toFixed(6)}`} target="_blank" rel="noreferrer">로드뷰</a></td>
                          </tr>
                        );
                      })}</tbody>
                    </table>
                  </div>
                </div>
              )}

              {view === "demand" && (
                <div className="a2-pane scroll">
                  <div className="a2-head"><h1>수요 조사</h1><p>기후부 수요 조사 제출 근거용 · 대장 기재 기준 단순 환산</p>
                    <div className="right"><button className="btn" onClick={exportBudget}>결과 CSV 내보내기</button></div></div>
                  <div className="a2-bar" style={{ gap: 18 }}>
                    <label>연 처리 물량(동) <input className="control" type="number" min={1} value={perYear} onChange={(e) => setPerYear(Number(e.target.value))} /></label>
                    <label>동당 단가(만 원) <input className="control" type="number" min={0} value={unit} onChange={(e) => setUnit(Number(e.target.value))} /></label>
                  </div>
                  <div className="a2-cards c2 cards">
                    {budgetRows.map(([k, n]) => (
                      <div className="a2-card" key={k}>
                        <h3>{k === "확실" ? <span className="a2-chip sure">확실</span> : <span className="a2-chip mix">최대</span>} 명부 {n.toLocaleString()}동</h3>
                        <div className="a2-big">{((n * unit) / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 })}<small style={{ fontSize: 15 }}>억 원</small>
                          <span className="sub" style={{ fontSize: 18, fontWeight: 600, marginLeft: 14 }}>{years(n).toFixed(1)}년</span></div>
                        <p>{n.toLocaleString()} × {unit.toLocaleString()}만 원 · {n.toLocaleString()} ÷ {perYear}동/년</p>
                      </div>
                    ))}
                  </div>
                  <p className="a2-note">기본값: 2026년 경산시 주택 철거 지원 95동(아주경제 2026.4.11 보도), 동당 700만 원. 대장 기재 기준이라 실제보다 많을 수 있습니다.
                    {allRec.rate != null ? ` 현재 현장 적중률 ${pct(allRec.rate)}을 곱하면 최대 ${Math.round(sum.max * allRec.rate).toLocaleString()}동.` : " 현장 확인 적중률이 쌓이면 명부 규모에 곱해 보정할 수 있습니다."}</p>
                </div>
              )}

              {view === "rules" && rv && (
                <div className="a2-pane scroll">
                  <div className="a2-head"><h1>판정 규칙</h1><p>지붕 자유기재 고유 표기 2,662종을 규칙표 23개로 전수 분류 · 규칙에 안 걸린 표기 0종 · 판정 규칙 v1</p></div>
                  <div className="a2-cards c2">
                    <div className="a2-card"><div className="code">RUL-01</div><h3>규칙표 23개 <span className="a2-chip ok">채택</span></h3>
                      <p>위에서부터 차례로 적용해 처음 걸린 규칙으로 분류합니다. 정규식과 표기 예시는 엑셀 「판정 근거」 시트에도 들어갑니다.</p></div>
                    <div className="a2-card"><div className="code">RUL-02</div><h3>판정 보류: '스레트기와' 계열 <span className="a2-chip hold">보류</span></h3>
                      <p>표기 모호 주택 {rv.amb.n}동({rv.amb.kinds}종). 문자열만으로 석면 슬레이트인지 기와형 제품인지 알 수 없어, 지붕 코드로도 확인되지 않는 <b>{rv.amb.excluded}동({rv.amb.excluded_kinds}종)</b>은 집계에서 뺐습니다. 나머지 {rv.amb.n - rv.amb.excluded}동은 지붕 코드가 슬레이트라 확실에 들어갑니다.</p></div>
                  </div>
                  <div className="a2-tbl fit">
                    <table className="t">
                      <thead><tr><th>규칙</th><th>분류</th><th>설명</th><th>표기 예시</th><th className="r">해당 표제부</th></tr></thead>
                      <tbody>{rules.map((r) => (
                        <tr key={r.order}><td className="mono">R-{String(r.order).padStart(2, "0")}</td>
                          <td>{/슬레이트/.test(r.label) && !/비/.test(r.label) ? <span className="a2-chip sure">{r.label}</span> : r.label === "혼합" ? <span className="a2-chip mix">{r.label}</span> : /모호|보류|불명/.test(r.label) ? <span className="a2-chip hold">{r.label}</span> : <span className="a2-chip ref">{r.label}</span>}</td>
                          <td title={r.note}>{r.note.replace(/\s*—\s*/g, ": ")}</td><td title={r.examples.join(" · ")}>{r.examples.join(" · ")}</td><td className="r">{r.n.toLocaleString()}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <h3 style={{ margin: "4px 0 0", fontSize: 14 }}>판정 보류 표기 <span className="a2-chip hold">보류</span></h3>
                  <div className="a2-tbl fit">
                    <table className="t">
                      <thead><tr><th>표기</th><th className="r">주택</th><th className="r">집계에서 뺀 동수</th></tr></thead>
                      <tbody>{rv.amb.rows.map((r) => <tr key={r.text}><td>{r.text}</td><td className="r">{r.n}</td><td className="r">{r.excluded}</td></tr>)}</tbody>
                    </table>
                  </div>
                </div>
              )}

              {view === "verify" && rv && (
                <div className="a2-pane scroll">
                  <div className="a2-head"><h1>검증</h1><p>사람이 확인한 정답과 비교한 값은 아직 없습니다. 현장 확인 기록이 쌓이면 적중률로 대체합니다</p></div>
                  <div className="a2-cards c2 fill">
                    <div className="a2-card"><div className="code">VAL-01 · 1차 교차 확인</div>
                      <h3>1차 교차 확인: LLM 따로 분류와 규칙표 <span className="a2-chip ok">채택</span></h3>
                      <div className="a2-figs">
                        <span><span className="a2-big">{((sum.llm.same4 / sum.llm.n) * 100).toFixed(1)}%</span><span className="sub"> 4분류 일치</span></span>
                        <span><span className="a2-big">{((sum.llm.same2 / sum.llm.n) * 100).toFixed(1)}%</span><span className="sub"> 슬레이트 포함 여부</span></span>
                      </div>
                      <p>표기 {sum.llm.n.toLocaleString()}종 중 4분류 {sum.llm.same4.toLocaleString()}종, 슬레이트 포함 여부 {sum.llm.same2.toLocaleString()}종 일치. 불일치 87종(주택류 90건)은 개정 검토 대상입니다. 정확도가 아니라 두 방법의 일치율이며, 같은 계열 모델이라 완전히 독립은 아닙니다.</p></div>
                    <div className="a2-card"><div className="code">VAL-01b · 2차 독립 판독 (본선 전)</div>
                      <h3>2차 독립 판독: 규칙표를 보지 않고 다시 분류 <span className="a2-chip ok">채택</span></h3>
                      <div className="a2-figs"><span><span className="a2-big">2,183 / 2,184</span><span className="sub">종 일치</span></span>
                        <span><span className="a2-big">99.95%</span><span className="sub">슬레이트 포함 여부</span></span></div>
                      <p>규칙표를 보지 않은 독립 판독으로 건물 도형 연결분 표기 2,378종을 다시 분류. 양쪽 다 판정한 2,184종 중 2,183종 일치. 불일치 1종(천연슬레이트잇기, 천연석이라 석면 아님)은 규칙표 개정 대상. 독립 판독이 판단을 보류한 101종(건물 523동)은 사람 검토표로 분리. 같은 계열 모델이라 완전 독립은 아님.</p>
                      <p><a href="/data/xcheck_review.csv" download="온지붕_교차검증_불일치_검토표.csv">사람 검토표 CSV 내려받기 ↓</a> <span className="sub">· 102행(불일치 1 + 판정 보류 101) · reports/xcheck_20261027</span></p></div>
                    <div className="a2-card"><div className="code">VAL-02 · 항공영상 판독 실험</div>
                      <h3>영상으로 슬레이트 가려내기 <span className="a2-chip no">기각</span></h3>
                      <div className="a2-figs">
                        <span><span className="a2-big">0.891</span><span className="sub"> 영상 모델</span></span>
                        <span><span className="a2-big">0.997</span><span className="sub"> 연도만</span></span>
                        <span><span className="a2-big red">0.602</span><span className="sub"> 오래된 비슬레이트</span></span>
                      </div>
                      <p><b>기각 이유:</b> 영상 모델의 ROC-AUC 0.891은 슬레이트를 알아봐서가 아니라 오래된 집과 새 집을 가려서 나온 값입니다. 영상을 보지 않고 사용승인연도 하나만 써도 0.997이 나오고, 같은 모델을 '오래됐지만 대장이 슬레이트가 아닌 주택' 300동에 적용하면 0.602로 떨어집니다. 그래서 영상 점수는 순위에 넣지 않고 지도에서 참고로만 보여줍니다.</p></div>
                    <div className="a2-card"><div className="code">VAL-03 · 연도만으로 고르면</div>
                      <h3>1990년 이전 주택 = 슬레이트? <span className="a2-chip no">기각</span></h3>
                      <div><span className="a2-big">{((rv.old.max / rv.old.n) * 100).toFixed(1)}%</span><span className="sub"> 대장 슬레이트(최대 기준)</span></div>
                      <p>1990년 이전 사용승인 주택 {rv.old.n.toLocaleString()}동 중 대장 슬레이트는 최대 {rv.old.max.toLocaleString()}동, 확실 {rv.old.sure.toLocaleString()}동({((rv.old.sure / rv.old.n) * 100).toFixed(1)}%)입니다. 연도만으로 고르면 절반 넘게 헛걸음이라, 대장 지붕 기재를 읽어야 합니다.</p></div>
                    <div className="a2-card"><div className="code">VAL-04 · 인허가 이력 교차</div>
                      <h3>철거·대수선 기록과 대조 <span className="a2-chip ref">참고</span></h3>
                      <div><span className="a2-big">{sum.permit.any}</span><small> 동</small><span className="sub"> / {sum.permit.n.toLocaleString()}동 ({((sum.permit.any / sum.permit.n) * 100).toFixed(1)}%)</span></div>
                      <p>대수선·철거멸실 기록과 필지 단위로 겹치는 집. 지붕만 바꾸는 공사는 기록이 남지 않는 경우가 많아, 이 대조는 현장 확인을 대신하지 못한다는 것을 보여줍니다.</p></div>
                  </div>
                </div>
              )}

              {view === "formula" && (
                <div className="a2-pane scroll">
                  <div className="a2-head"><h1>점수 산식</h1><p>점수 = Σ(항목 점수 × 가중치) ÷ Σ가중치 × 100 · 먼저 찾아갈 순서를 정하는 정책 점수이며 예측 정확도가 있는 값이 아닙니다</p></div>
                  <div className="a2-card"><div className="code">PRI-01</div><h3>{POLICY} <span className="a2-chip ok">원칙</span></h3></div>
                  <div className="a2-cards c2 fill">
                    <div className="a2-tbl fit">
                      <table className="t">
                        <thead><tr><th>항목</th><th className="r">기본 가중치</th><th>근거</th></tr></thead>
                        <tbody>{W_PARTS.map((w) => (
                          <tr key={w.key}><td><b>{w.label}</b></td><td className="r">{W_DEFAULT[w.key].toFixed(2)}</td>
                            <td className="sub">{({ ca: "사용승인연도(오래될수록 높음)", cr: "건축면적(지붕 면적 근사)", cs: "학교까지 직선거리", cd: "어린이집까지 직선거리", ce: "경로당까지 직선거리",
                              cc: "단독 기재 > 혼합 기재", eo: "행정동 70세 이상 비율 · 참고 항목" } as Record<string, string>)[w.key]}</td></tr>
                        ))}</tbody>
                      </table>
                    </div>
                    <div className="a2-card">
                      <div className="code">PRI-02 · 민감도</div>
                      <h3>가중치를 ±0.1 바꿔도 <span className="a2-chip ok">안정</span></h3>
                      <div><span className="a2-big">68~91</span><small> 동</small><span className="sub"> / 상위 95동 유지</span></div>
                      <table className="t" style={{ marginTop: 6 }}>
                        <thead><tr><th>항목</th><th className="r">+0.10</th><th className="r">−0.10</th></tr></thead>
                        <tbody>{SENS.map(([k, a, b]) => <tr key={k}><td>{k}</td><td className="r">{a}</td><td className="r">{b}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                  <p className="a2-note">가중치는 /map 에서 조정할 수 있으며, 조정하면 이 화면의 명부 순위도 같이 바뀝니다. 고령인구 비율은 주민등록 인구가 10세 구간으로 제공돼 70세 이상으로 집계했고 기본 가중치는 0입니다.</p>
                </div>
              )}

              {view === "data" && join && (
                <div className="a2-pane scroll">
                  <div className="a2-head"><h1>데이터·출처</h1><p>명부 {bld.length.toLocaleString()}동에 무엇을 어떤 단위로 결합했나</p></div>
                  <div className="a2-tbl fit">
                    <table className="t">
                      <thead><tr><th>데이터</th><th>제공 기관</th><th>기준일</th><th>결합 단위</th><th className="r">결합률 (명부 {bld.length.toLocaleString()}동 중)</th></tr></thead>
                      <tbody>{join.rows.map((r) => <tr key={r.name}><td><b>{r.name}</b></td><td>{r.org}</td><td>{r.date}</td><td>{r.unit}</td><td className="r">{r.rate}</td></tr>)}</tbody>
                    </table>
                  </div>
                  <div className="a2-cards c2 fill">
                    <div className="a2-card"><div className="code">DAT-01 · 결합 키</div><h3>건물 ID와 관리건축물대장 PK <span className="a2-chip ok">채택</span></h3>
                      <p>명부의 모든 집은 건물 ID(B + 6자리)와 대장 PK를 함께 가집니다. 행정망 자료(주소·소유자)는 이 두 값으로 붙이고, 공개 화면에는 넣지 않습니다.</p></div>
                    <div className="a2-card"><div className="code">DAT-02 · 지번</div><h3>지번은 행정망 파일로만 <span className="a2-chip hold">내부 전용</span></h3>
                      <p>배포 자료에 지번이 없습니다. 담당자가 행정망 지번 파일을 불러오면 화면에는 가려서 보이고, 저장되지 않으며 엑셀 명부에만 들어갑니다.</p></div>
                    <div className="a2-card"><div className="code">DAT-03 · 고령인구</div><h3>70세 이상 비율, 행정동 단위 <span className="a2-chip ref">참고</span></h3>
                      <p>행정안전부 주민등록 인구는 10세 구간으로 제공되어 65세가 아닌 70세 이상 비율로 집계했습니다. 점수 가중치 기본값은 0입니다.</p></div>
                    <div className="a2-card"><div className="code">DAT-04 · 제외한 자료</div><h3>공시가격은 넣지 않음 <span className="a2-chip no">제외</span></h3>
                      <p>개별주택가격은 순위·점수·화면 어디에도 쓰지 않습니다.</p></div>
                  </div>
                </div>
              )}

              {view === "law" && (
                <div className="a2-pane scroll">
                  <div className="a2-head"><h1>근거 법령</h1><p>국가법령정보센터 Open API로 조회한 조문 · 번호·제목은 응답 그대로</p></div>
                  {laws.length ? (
                    <div className="a2-tbl fit">
                      <table className="t">
                        <thead><tr><th>법령</th><th>조문</th><th>제목</th><th>안내문 표기</th><th>쓰이는 곳</th><th>조회일</th><th>원문</th></tr></thead>
                        <tbody>{laws.map((l) => <tr key={l.law + l.article}><td>{l.law}</td><td>{l.article}</td><td>{l.title}</td>
                          <td>{l.support ? <span className="a2-chip ok">지원 근거</span> : <span className="a2-chip ref">관련 법령</span>}</td><td>{l.use}</td><td>{l.fetched}</td>
                          <td><a href={l.url} target="_blank" rel="noreferrer">law.go.kr</a></td></tr>)}</tbody>
                      </table>
                    </div>
                  ) : <p className="a2-note">아직 조회하지 못했습니다.</p>}
                  <div className="a2-cards c2 fill">
                    <div className="a2-card"><div className="code">LAW-01 · 안내문 하단 문구</div><h3>안내문에 들어가는 한 줄 <span className="a2-chip ok">사용 중</span></h3>
                      <p>{lawLine || "아직 조회하지 못했습니다."}</p></div>
                    <div className="a2-card"><div className="code">LAW-02 · 표기 기준</div><h3>본문에 비용 지원이 있어야 '근거' <span className="a2-chip ref">원칙</span></h3>
                      <p>조문 본문에 비용·보조를 지원한다는 내용이 있는 조문만 "근거:"로 쓰고, 나머지는 "관련 법령:"으로 법령명과 조문 번호만 적습니다. 조문 번호·제목은 국가법령정보센터 Open API 응답 그대로입니다.</p></div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* ── 하단 상태바 ── */}
      <footer className="a2-foot">
        <span>판정 규칙 v1</span><span>대장 2026-10-05 조회</span><span>지번은 행정망 파일로만 결합</span>
        <span className="demo-note">담당자 화면 시제품(도입 시 행정망 내부 전용)</span>
        <button onClick={() => setPop(pop === "privacy" ? "" : "privacy")}>개인정보 처리 안내</button>
        <span className="end"><span className="dot" style={{ background: HAS_KEY ? "var(--green)" : "#f79009" }} />배경지도 {HAS_KEY ? "브이월드 연결" : "미연결(인증키 미설정)"}</span>
      </footer>
      {pop === "privacy" && (
        <div className="a2-pop foot" role="dialog" aria-label="개인정보 처리 안내">
          <h3>개인정보 처리 안내</h3>
          <p>이 화면은 소유자 이름·주소를 다루지 않습니다. 배포 자료에는 건물 ID·대장 PK·법정리·읍면동만 있습니다.</p>
          <p>지번은 행정망 내부 파일을 담당자가 직접 불러올 때만 메모리에 올라가고, 저장되지 않으며 엑셀 내보내기에만 들어갑니다.</p>
          <p>진행 상태·확인 기록은 이 브라우저(localStorage)에만 저장됩니다. 도입 시 행정망 계정·접근 기록으로 운영합니다.</p>
          <button className="btn sm" onClick={() => setPop("")}>닫기</button>
        </div>
      )}
    </div>
  );
}
