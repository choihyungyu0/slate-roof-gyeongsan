"use client";

// 담당 공무원용 행정 화면(시제품). 서버 없이 브라우저 localStorage와 CSV로만 저장한다.
// 주소·지번·소유자 정보는 다루지 않는다. 건물은 건물 ID·읍면동·사용승인연도·지붕 기재·점수·순위로만 다룬다.
import { useEffect, useMemo, useState } from "react";

import { bid, csvBlob, EMPTY_REC as EMPTY, today, loadRecs, loadWeights, type Rec, type Result, RESULTS, rescore, saveRecs } from "../shared";
import { buildHwpx, type Line } from "./hwpx";

type P = {
  cat: number; emd: string; roof?: string; etc?: string; rc?: string; year?: number | null; area?: number | null;
  ps?: number; pr?: number; ds?: number; dd?: number; de?: number;
};
type B = { id: string; p: P; lon: number; lat: number };
type Emd = { name: string; houses: number; sure: number; max: number };
type Summary = { houses: number; sure: number; max: number };
const SEED = 20261028;

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

function download(name: string, rows: unknown[][]) {
  save(name, csvBlob(rows));
}
function save(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ""));
}

const SUPPORT = [
  "주택 슬레이트 철거·처리: 동당 최대 700만 원",
  "우선지원 가구(기초생활수급·차상위 등): 철거·처리 비용 전액",
  "취약계층 지붕 개량: 최대 1,000만 원",
];
function noticeLines(b: B): Line[] {
  return [
    { text: "슬레이트 지붕 철거·개량 지원 안내", style: "title" },
    { text: `건물 ID: ${b.id}    읍·면·동: ${b.p.emd}    사용승인연도: ${b.p.year ?? "불명"}` },
    { text: `건축물대장 지붕 기재: ${b.p.roof || "(빈값)"} / ${b.p.etc || "(빈값)"}` },
    { text: "댁의 건물은 건축물대장에 지붕이 슬레이트로 기재되어 있어 석면 슬레이트 처리 지원 대상일 수 있습니다." },
    { text: "■ 지원 내용" }, ...SUPPORT.map((s) => ({ text: "  · " + s })),
    { text: "■ 신청 장소: 관할 행정복지센터 (읍·면사무소, 동 행정복지센터)" },
    { text: "주소: ______________________________   성명: ______________  (주소·성명은 행정망에서 채움)", style: "small" },
    { text: "※ 대장 기재 기준 안내이며, 실제 지붕 재료는 현장 확인 후 확정됩니다. 지원 금액은 해당 연도 사업 공고를 따릅니다.", style: "small" },
  ];
}

export default function AdminView() {
  const [tab, setTab] = useState<"stat" | "list" | "field" | "budget">("stat");
  const [bld, setBld] = useState<B[]>([]);
  const [emds, setEmds] = useState<Emd[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [recs, setRecs] = useState<Record<string, Rec>>({});
  const [loaded, setLoaded] = useState(false);
  // 명부 필터
  const [fEmd, setFEmd] = useState("전체");
  const [fN, setFN] = useState(95);
  const [fKind, setFKind] = useState<"전체" | "단독" | "혼합">("전체");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [printing, setPrinting] = useState<B[] | null>(null);
  // 현장 확인
  const [group, setGroup] = useState<"top" | "rand">("top");
  // 국비 산정
  const [perYear, setPerYear] = useState(95);
  const [unit, setUnit] = useState(700);

  useEffect(() => {
    (async () => {
      const { parts } = (await fetch("/data/buildings.manifest.json").then((r) => r.json())) as { parts: number };
      const chunks = await Promise.all(Array.from({ length: parts }, (_, k) =>
        fetch(`/data/buildings.part${k}.json`).then((r) => r.json() as Promise<GeoJSON.FeatureCollection>)));
      const list: B[] = [];
      for (const f of chunks.flatMap((c) => c.features)) {
        const p = f.properties as P;
        if (p.ps == null) continue;  // 점수가 있는 건물 = 위치가 연결된 대장 슬레이트 주택
        const [lon, lat] = center(f.geometry);
        list.push({ id: bid(f.id as number), p, lon, lat });
      }
      setBld(rescore(list, loadWeights()));  // /map 에서 조정한 가중치를 그대로 따른다
      const ej = (await fetch("/data/emd.geojson").then((r) => r.json())) as GeoJSON.FeatureCollection;
      setEmds(ej.features.map((f) => {
        const q = f.properties as { emd_kor_nm: string; houses: number; slate_sure: number; slate_houses: number };
        return { name: q.emd_kor_nm, houses: q.houses, sure: q.slate_sure, max: q.slate_houses };
      }).sort((a, b) => b.max - a.max));
      setSum(await fetch("/data/summary.json").then((r) => r.json()));
      setRecs(loadRecs());
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    saveRecs(recs);
  }, [recs, loaded]);
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

  const listAll = bld.filter((b) => (fEmd === "전체" || b.p.emd === fEmd)
    && (fKind === "전체" || (fKind === "혼합" ? b.p.rc === "혼합" : b.p.rc !== "혼합")));
  const listShown = fN ? listAll.slice(0, fN) : listAll;
  const chosen = listShown.filter((b) => sel.has(b.id));
  const setRec = (id: string, patch: Partial<Rec>) => setRecs((r) => ({ ...r, [id]: { ...EMPTY, ...r[id], ...patch } }));

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
    const rows = parseCsv((await file.text()).replace(/^﻿/, ""));
    const h = rows[0] ?? [];
    const ix = (n: string) => h.indexOf(n);
    const [iId, iRes, iMet, iDate, iMemo] = ["건물ID", "확인결과", "확인방법", "확인일", "메모"].map(ix);
    if (iId < 0 || iRes < 0) { alert("건물ID·확인결과 열이 있는 CSV가 아닙니다."); return; }
    let n = 0;
    const next = { ...recs };
    for (const r of rows.slice(1)) {
      if (!byId.has(r[iId]) || !(RESULTS as string[]).includes(r[iRes])) continue;
      next[r[iId]] = { result: r[iRes] as Result, method: (r[iMet] as Rec["method"]) || "", date: r[iDate] || "", memo: r[iMemo] || "" };
      n++;
    }
    setRecs(next);
    alert(`${n}건의 확인 기록을 가져왔습니다.`);
  };
  const hwpx = async () => {
    const blob = await buildHwpx(chosen.map(noticeLines));
    save(`슬레이트_지원안내_${chosen.length}건.hwpx`, blob);
  };

  const houses = sum?.max ?? 0;
  const years = (n: number) => (perYear > 0 ? n / perYear : 0);
  const budgetRows: [string, number][] = sum ? [["확실", sum.sure], ["최대", sum.max]] : [];
  const exportBudget = () => download("국비산정.csv", [
    ["구분", "명부 규모(동)", "연 처리 물량(동)", "소요 연수", "동당 단가(만원)", "필요 예산(억원)"],
    ...budgetRows.map(([k, n]) => [k, n, perYear, years(n).toFixed(1), unit, ((n * unit) / 10000).toFixed(1)])]);

  const groupIds = group === "top" ? top95 : rand95;
  const gTop = hit(recs, top95), gRand = hit(recs, rand95);

  return (
    <div className="adm">
      <div className="adm-banner">담당자 화면 시제품 · 도입 시 행정망 내부 전용</div>
      {printing && (
        <div className="print-only">
          {printing.map((b) => (
            <section key={b.id} className="notice">
              <h1>슬레이트 지붕 철거·개량 지원 안내</h1>
              <table><tbody>
                <tr><th>건물 ID</th><td>{b.id}</td><th>읍·면·동</th><td>{b.p.emd}</td></tr>
                <tr><th>사용승인연도</th><td>{b.p.year ?? "불명"}</td><th>대장 지붕 코드</th><td>{b.p.roof || "(빈값)"}</td></tr>
                <tr><th>대장 지붕 기재 원문</th><td colSpan={3}>{b.p.etc || "(빈값)"}</td></tr>
              </tbody></table>
              <p>댁의 건물은 건축물대장에 지붕이 슬레이트로 기재되어 있어 석면 슬레이트 처리 지원 대상일 수 있습니다.</p>
              <h2>지원 내용</h2>
              <ul>{SUPPORT.map((s) => <li key={s}>{s}</li>)}</ul>
              <h2>신청 장소</h2>
              <p>관할 행정복지센터 (읍·면사무소, 동 행정복지센터)</p>
              <table className="blank"><tbody>
                <tr><th>주소</th><td /></tr><tr><th>성명</th><td /></tr>
              </tbody></table>
              <p className="fine">주소·성명은 행정망에서 채움 · 대장 기재 기준 안내이며 실제 지붕 재료는 현장 확인 후 확정됩니다. 지원 금액은 해당 연도 사업 공고를 따릅니다.</p>
            </section>
          ))}
        </div>
      )}
      <header className="adm-head">
        <div className="brand"><a href="/">온지붕</a><small>행정 화면</small></div>
        <nav className="adm-tabs" role="tablist">
          {([["stat", "현황"], ["list", "명부·안내"], ["field", "현장 확인 기록"], ["budget", "국비 산정"]] as const).map(([k, t]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t}</button>
          ))}
        </nav>
        <a className="adm-link" href="/map">건물 단위 지도 →</a>
      </header>
      {!loaded ? <p className="adm-wait">명부를 불러오는 중…</p> : (
        <main className="adm-main">
          {tab === "stat" && (
            <>
              <div className="cards">
                <div className="card"><span>대장 슬레이트 주택 (확실 ~ 최대)</span><b>{sum!.sure.toLocaleString()} ~ {sum!.max.toLocaleString()}동</b><small>주택류 표제부 {sum!.houses.toLocaleString()}동 중 · 대장 기재 기준</small></div>
                <div className="card"><span>점수가 매겨진 명부</span><b>{bld.length.toLocaleString()}동</b><small>건물 도형과 연결된 주택</small></div>
                <div className="card"><span>현장 확인 진행률</span><b>{pct(bld.length ? (allRec.judged + allRec["확인 불가"]) / bld.length : null)}</b><small>기록 {(allRec.judged + allRec["확인 불가"]).toLocaleString()}동 / 명부 {bld.length.toLocaleString()}동</small></div>
                <div className="card"><span>적중률</span><b>{pct(allRec.rate)}</b><small>맞음 {allRec["맞음"]} ÷ (맞음 + 아님·개량 {allRec["아님·개량"]} + 철거됨 {allRec["철거됨"]})</small></div>
              </div>
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
                <span className="sp" />
                <span className="dim">선택 {chosen.length}동</span>
                <button disabled={!chosen.length} onClick={() => setPrinting(chosen)}>안내문 PDF</button>
                <button disabled={!chosen.length} onClick={hwpx}>안내문 HWPX</button>
                <button onClick={exportVisits}>방문 목록 CSV</button>
              </div>
              <p className="dim">{fEmd} · 대상 {listAll.length.toLocaleString()}동 중 {listShown.length.toLocaleString()}동 표시 · 점수순. 선택이 없으면 CSV는 표시된 전체를 내보냅니다.</p>
              <table className="grid">
                <thead><tr>
                  <th><input type="checkbox" aria-label="전체 선택" checked={listShown.length > 0 && listShown.every((b) => sel.has(b.id))}
                    onChange={(e) => setSel(e.target.checked ? new Set(listShown.map((b) => b.id)) : new Set())} /></th>
                  <th className="r">순위</th><th>건물 ID</th><th>읍·면·동</th><th className="r">사용승인</th><th>지붕 코드</th><th>지붕 자유기재 원문</th><th>기재</th><th className="r">점수</th><th>확인 결과</th>
                </tr></thead>
                <tbody>{listShown.map((b) => (
                  <tr key={b.id}>
                    <td><input type="checkbox" aria-label={`${b.id} 선택`} checked={sel.has(b.id)} onChange={(e) => {
                      const s = new Set(sel); if (e.target.checked) s.add(b.id); else s.delete(b.id); setSel(s);
                    }} /></td>
                    <td className="r">{b.p.pr}</td><td className="mono">{b.id}</td><td>{b.p.emd}</td><td className="r">{b.p.year ?? "불명"}</td>
                    <td>{b.p.roof || "—"}</td><td>{b.p.etc || "—"}</td><td>{b.p.rc === "혼합" ? "혼합" : "단독"}</td><td className="r">{b.p.ps!.toFixed(1)}</td>
                    <td>{recs[b.id]?.result || <span className="dim">미입력</span>}</td>
                  </tr>
                ))}</tbody>
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
                <label className="file">확인 기록 CSV 가져오기<input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && importRecs(e.target.files[0])} /></label>
                <button onClick={() => {
                  const ids = groupIds;
                  download(`현장확인_${group === "top" ? "점수상위95" : "무작위95"}.csv`, [["묶음", "건물ID", "읍면동", "시전체순위", "점수", "지붕자유기재", "확인결과", "확인방법", "확인일", "메모"],
                    ...ids.map((id) => { const b = byId.get(id)!; const r = recs[id] ?? EMPTY;
                      return [group === "top" ? "점수상위" : "무작위", id, b.p.emd, b.p.pr, b.p.ps, b.p.etc ?? "", r.result, r.method, r.date, r.memo]; })]);
                }}>기록 CSV 내보내기</button>
              </div>
              <table className="grid compare">
                <thead><tr><th>시범 평가 묶음</th><th className="r">맞음</th><th className="r">아님·개량</th><th className="r">철거됨</th><th className="r">확인 불가</th><th className="r">미입력</th><th className="r">적중률</th></tr></thead>
                <tbody>{([["점수 상위 95동", gTop], [`무작위 95동 (대조군, 시드 ${SEED})`, gRand]] as const).map(([n, g]) => (
                  <tr key={n}><td>{n}</td><td className="r">{g["맞음"]}</td><td className="r">{g["아님·개량"]}</td><td className="r">{g["철거됨"]}</td><td className="r">{g["확인 불가"]}</td><td className="r">{g["미입력"]}</td><td className="r"><b>{pct(g.rate)}</b></td></tr>
                ))}</tbody>
              </table>
              <p className="dim">적중률 = 맞음 ÷ (맞음 + 아님·개량 + 철거됨). 무작위 95동은 점수 상위 95동을 뺀 나머지 명부에서 시드를 고정해 뽑습니다. 기록은 이 브라우저에만 저장되며 CSV로 옮깁니다.</p>
              <table className="grid">
                <thead><tr><th className="r">순위</th><th>건물 ID</th><th>읍·면·동</th><th>지붕 자유기재</th><th>결과</th><th>방법</th><th>날짜</th><th>메모</th><th /></tr></thead>
                <tbody>{groupIds.map((id) => {
                  const b = byId.get(id)!; const r = recs[id] ?? EMPTY;
                  return (
                    <tr key={id}>
                      <td className="r">{b.p.pr}</td><td className="mono">{id}</td><td>{b.p.emd}</td><td>{b.p.etc || "—"}</td>
                      <td><select aria-label="결과" value={r.result} onChange={(e) => setRec(id, { result: e.target.value as Result, date: r.date || today() })}>
                        <option value="">—</option>{RESULTS.map((x) => <option key={x} value={x}>{x === "맞음" ? "슬레이트 맞음" : x}</option>)}</select></td>
                      <td><select aria-label="방법" value={r.method} onChange={(e) => setRec(id, { method: e.target.value as Rec["method"] })}>
                        <option value="">—</option><option>현장</option><option>로드뷰</option></select></td>
                      <td><input type="date" aria-label="날짜" value={r.date} onChange={(e) => setRec(id, { date: e.target.value })} /></td>
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
              <p className="dim">기본값: 2026년 경산시 주택 철거 지원 95동(아주경제 2026.4.11 보도), 동당 최대 700만 원. 단순 환산이며 대장 기재 기준이라 실제보다 많을 수 있습니다. 현장 확인 적중률이 쌓이면 명부 규모에 곱해 보정할 수 있습니다{allRec.rate != null ? ` (현재 적중률 ${pct(allRec.rate)} 적용 시 최대 ${Math.round(houses * allRec.rate).toLocaleString()}동)` : ""}.</p>
            </>
          )}
        </main>
      )}
    </div>
  );
}
