"use client";

// 질의 도우미 — 담당자가 자연어로 묻고, 서버(/api/ask)가 배포 자료를 조회한 결과만으로 답한다.
// 답마다 'AI 답변' 고지와 조회 근거 표를 붙이고, 조회된 건물은 누르면 명부 상세로 간다.
import { useEffect, useRef, useState } from "react";

type Ev = { tool: string; args: Record<string, unknown>; result: Record<string, unknown> };
type Turn = { q: string; a?: string; ev?: Ev[]; err?: string; busy?: boolean };
type Brief = { id: string; rank: number; score: number; emd: string; ri: string | null; judgment: string; roof_code: string; roof_text: string; year: number | null };

const CHIPS = ["하양읍에서 학교 500m 안 확실 슬레이트 몇 동?", "자인면 상위 10동 보여 줘", "2위 집이 왜 2위야?", "안내문 근거 법령이 뭐야?"];
const TOOL_LABEL: Record<string, string> = { query_buildings: "명부 조회", get_building: "건물 조회", get_summary: "집계 조회", get_rule: "규칙 조회", get_law: "법령 조회" };
const ARG_LABEL: Record<string, string> = { emd: "읍면동", ri: "법정리", judgment: "판정", year_max: "사용승인 ≤", score_min: "점수 ≥", rank_max: "순위 ≤", school_m: "학교 ≤(m)",
  daycare_m: "어린이집 ≤(m)", senior_m: "경로당 ≤(m)", sort: "정렬", limit: "표시", id: "건물 ID", rank: "순위", rule_id: "규칙" };

function cond(args: Record<string, unknown>) {
  const s = Object.entries(args).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${ARG_LABEL[k] ?? k} ${v}`);
  return s.length ? s.join(" · ") : "조건 없음";
}

function Evidence({ e, onPick }: { e: Ev; onPick: (id: string) => void }) {
  const r = e.result;
  const head = <div className="ask-evh"><b>{TOOL_LABEL[e.tool] ?? e.tool}</b><span>{cond(e.args)}</span></div>;
  if (r.error) return <div className="ask-ev">{head}<p className="sub">{String(r.error)}</p></div>;
  if (e.tool === "query_buildings") {
    const top = (r.top as Brief[]) ?? [];
    return (
      <div className="ask-ev">{head}
        <p className="ask-cnt">조회 <b>{Number(r.count).toLocaleString()}동</b>{r.count_before_distance != null && <> / 거리 조건 전 {Number(r.count_before_distance).toLocaleString()}동 ({String(r.pct_of_before_distance)}%)</>}
          <span className="sub"> · {String(r.scope)}</span></p>
        {top.length > 0 && (
          <table className="t ask-t"><thead><tr><th className="r">순위</th><th>건물 ID</th><th>읍면동</th><th>판정</th><th>원문</th><th className="r">점수</th></tr></thead>
            <tbody>{top.map((b) => (
              <tr key={b.id} onClick={() => onPick(b.id)} title="명부 상세로 이동"><td className="r">{b.rank}</td><td className="mono">{b.id}</td><td>{b.emd} {b.ri && b.ri !== b.emd ? b.ri : ""}</td>
                <td>{b.judgment}</td><td title={b.roof_text}>{b.roof_text}</td><td className="r sc">{b.score.toFixed(1)}</td></tr>))}</tbody></table>)}
      </div>);
  }
  if (e.tool === "get_building") {
    const parts = (r.score_parts as { item: string; weight: number; item_score: number }[]) ?? [];
    return (
      <div className="ask-ev">{head}
        <p className="ask-cnt"><a onClick={() => onPick(String(r.id))} role="button">{String(r.id)}</a> · {String(r.rank)}위 · <b>{Number(r.score).toFixed(1)}점</b> · 지붕 코드 {String(r.roof_code || "빈값")} · 원문 {String(r.roof_text || "빈값")}</p>
        <p className="sub">판정 {String(r.judgment)} · 걸린 규칙 {((r.rules_hit as string[]) ?? []).join(", ") || "없음"} · 인허가 {String(r.permit_record)}</p>
        <table className="t ask-t"><thead><tr><th>점수 항목</th><th className="r">가중치</th><th className="r">항목 점수</th></tr></thead>
          <tbody>{parts.map((p) => <tr key={p.item} className="nohover"><td>{p.item}</td><td className="r">{p.weight.toFixed(2)}</td><td className="r">{p.item_score}</td></tr>)}</tbody></table>
      </div>);
  }
  if (e.tool === "get_summary") {
    return (
      <div className="ask-ev">{head}
        <p className="ask-cnt">{String(r.emd ?? r.city)} · 확실 <b>{Number(r.sure).toLocaleString()}</b> ~ 최대 <b>{Number(r.max).toLocaleString()}동</b> · 코드가 놓친 집 {Number(r.code_missed).toLocaleString()}동 · 명부 {Number(r.roster_count).toLocaleString()}동</p>
        <p className="sub">{String(r.basis)}</p>
      </div>);
  }
  if (e.tool === "get_rule") {
    return <div className="ask-ev">{head}<p className="ask-cnt"><b>{String(r.rule_id)}</b> · {String(r.label)} · {String(r.note).replace(/\s*—\s*/g, ": ")}</p>
      <p className="sub">예: {((r.examples as string[]) ?? []).join(" · ")} · 해당 표제부 {Number(r.title_count).toLocaleString()}건</p></div>;
  }
  if (e.tool === "get_law") {
    const laws = (r.laws as { law: string; article: string; title: string; support?: boolean }[]) ?? [];
    return <div className="ask-ev">{head}<table className="t ask-t"><thead><tr><th>법령</th><th>조문</th><th>제목</th><th>표기</th></tr></thead>
      <tbody>{laws.map((l) => <tr key={l.law + l.article} className="nohover"><td>{l.law}</td><td>{l.article}</td><td>{l.title}</td><td>{l.support ? "지원 근거" : "관련 법령"}</td></tr>)}</tbody></table></div>;
  }
  return null;
}

export default function AskPanel({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState<boolean | null>(null);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ask").then((r) => (r.ok ? r.json() : { enabled: false })).then((j: { enabled?: boolean }) => setOn(Boolean(j.enabled))).catch(() => setOn(false));
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns]);

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || turns.some((t) => t.busy)) return;
    setQ("");
    const history = turns.filter((t) => t.a).slice(-3).map((t) => ({ q: t.q, a: t.a! }));
    setTurns((ts) => [...ts, { q: question, busy: true }]);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, history }) });
      const j = await r.json();
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? (r.ok ? { q: question, a: j.answer, ev: j.evidence } : { q: question, err: j.error ?? "질의 기능 일시 중단" }) : t)));
    } catch {
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? { q: question, err: "질의 기능 일시 중단" } : t)));
    }
  };

  return (
    <>
      <button className="ask-fab" onClick={() => setOpen(!open)} aria-expanded={open}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>질의 도우미</button>
      {open && (
        <section className="ask-panel" role="dialog" aria-label="질의 도우미">
          <header><b>질의 도우미</b><span className="sub">배포 자료 조회 결과로만 답합니다 · 판정하지 않습니다</span>
            <button className="btn sm ghost" onClick={() => setOpen(false)} aria-label="닫기">닫기</button></header>
          {on === false ? <p className="ask-off">질의 기능 일시 중단. 다른 화면은 그대로 쓸 수 있습니다.</p> : (
            <>
              <div className="ask-body">
                {!turns.length && <p className="sub ask-hint">명부·집계·규칙·법령을 자연어로 물어보세요. 숫자는 모두 조회 결과에서 나옵니다.</p>}
                {turns.map((t, i) => (
                  <div key={i} className="ask-turn">
                    <p className="ask-q">{t.q}</p>
                    {t.busy && <p className="sub ask-wait">조회 중…</p>}
                    {t.err && <p className="ask-off">{t.err}</p>}
                    {t.a != null && (
                      <div className="ask-a">
                        <span className="a2-chip ref">AI 답변 · 근거는 아래 조회 결과</span>
                        <p>{t.a}</p>
                        {t.ev?.map((e, k) => <Evidence key={k} e={e} onPick={onPick} />)}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={end} />
              </div>
              <div className="ask-chips">{CHIPS.map((c) => <button key={c} className="btn sm" onClick={() => ask(c)} disabled={turns.some((t) => t.busy)}>{c}</button>)}</div>
              <form className="ask-in" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
                <input className="control" aria-label="질문" placeholder="예: 진량읍 1960년 이전 확실 슬레이트 몇 동?" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} />
                <button className="btn primary" type="submit" disabled={!q.trim() || turns.some((t) => t.busy)}>묻기</button>
              </form>
            </>
          )}
        </section>
      )}
    </>
  );
}
