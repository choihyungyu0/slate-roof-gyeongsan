// /map 과 /admin 이 함께 쓰는 것: 건물 ID, 현장 확인 기록 저장소, 우선순위 가중치와 재계산.
// 서버 없이 브라우저 localStorage에만 저장한다. 주소·지번·소유자 정보는 다루지 않는다.

export type Result = "" | "맞음" | "아님·개량" | "철거됨" | "확인 불가";
export type Status = "미안내" | "안내 발송" | "신청" | "현장 확인" | "선정" | "처리 완료" | "대상 아님";
export const STATUSES: Status[] = ["미안내", "안내 발송", "신청", "현장 확인", "선정", "처리 완료", "대상 아님"];
// 현장 확인 결과·진행 상태·빈집 여부·기지원 여부를 한 저장소(건물 ID별 기록)에 둔다
export type Rec = { result: Result; method: "" | "현장" | "로드뷰"; date: string; memo: string; status?: Status; vacant?: boolean; sup?: boolean };
export const RESULTS: Result[] = ["맞음", "아님·개량", "철거됨", "확인 불가"];
export const RESULT_LABEL: Record<string, string> = { 맞음: "슬레이트 맞음", "아님·개량": "아님·개량", 철거됨: "철거됨", "확인 불가": "확인 불가" };
export const EMPTY_REC: Rec = { result: "", method: "", date: "", memo: "" };
const REC_KEY = "onjibung-admin-records-v1";
const W_KEY = "onjibung-weights-v1";

// 건물 ID: 지도 자료의 건물 일련번호. 행정망에서 주소·소유자와 결합하는 열쇠로만 쓴다.
export const bid = (id: number) => `B${String(id).padStart(6, "0")}`;

export function loadRecs(): Record<string, Rec> {
  try { return JSON.parse(localStorage.getItem(REC_KEY) || "{}"); } catch { return {}; }
}
export function saveRecs(r: Record<string, Rec>) {
  try { localStorage.setItem(REC_KEY, JSON.stringify(r)); } catch { /* 저장소를 못 쓰는 환경 */ }
}

export type WKey = "ca" | "cr" | "cs" | "cd" | "ce" | "cc" | "eo";
export const W_PARTS: { key: WKey; label: string }[] = [
  { key: "ca", label: "노후도" }, { key: "cr", label: "지붕 면적" }, { key: "cs", label: "학교 거리" },
  { key: "cd", label: "어린이집 거리" }, { key: "ce", label: "경로당 거리" }, { key: "cc", label: "기재 확실성" },
  { key: "eo", label: "고령인구 비율" },
];
// 기존 6개 항목의 기본값은 그대로 두고, 추가 항목(고령인구 비율)은 기본 0 — 기본값에서는 점수·순위가 바뀌지 않는다
export const W_DEFAULT: Record<WKey, number> = { ca: 0.3, cr: 0.15, cs: 0.2, cd: 0.15, ce: 0.1, cc: 0.1, eo: 0 };
export function loadWeights(): Record<WKey, number> {
  try { return { ...W_DEFAULT, ...JSON.parse(localStorage.getItem(W_KEY) || "{}") }; } catch { return { ...W_DEFAULT }; }
}
export function saveWeights(w: Record<WKey, number>) {
  try { localStorage.setItem(W_KEY, JSON.stringify(w)); } catch { /* 무시 */ }
}
export const isDefault = (w: Record<WKey, number>) => W_PARTS.every(({ key }) => Math.abs(w[key] - W_DEFAULT[key]) < 1e-9);

type Scorable = { ps?: number; pr?: number } & Partial<Record<WKey, number>>;
// 항목 점수 × 가중치 합 ÷ 가중치 합 × 100. 기본 가중치에서는 src/priority_score.py 와 같은 값이 된다.
export function rescore<T extends { p: Scorable }>(items: T[], w: Record<WKey, number>): T[] {
  const tot = W_PARTS.reduce((s, { key }) => s + w[key], 0) || 1;
  const scored = items.map((it) => {
    const ps = isDefault(w) ? it.p.ps! : Math.round(W_PARTS.reduce((s, { key }) => s + (it.p[key] ?? 0) * w[key], 0) / tot * 1000) / 10;
    return { it, ps };
  });
  scored.sort((a, b) => b.ps - a.ps || a.it.p.pr! - b.it.p.pr!);
  return scored.map(({ it, ps }, i) => ({ ...it, p: { ...it.p, ps, pr: i + 1 } }));
}

export function csvBlob(rows: unknown[][]): Blob {
  const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // UTF-8 BOM: 엑셀에서 한글이 깨지지 않게
  return new Blob(["﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
}

// 오늘 날짜(한국 시간 기준, YYYY-MM-DD)
export const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

// 행정 보조 자료(대장 PK·법정리·행정동·70세 이상 비율). 지번은 들어 있지 않다.
export type Extra = { pk: string | null; ri: string | null; ad: string | null; eo: number | null };
export async function loadExtra(): Promise<{ ex: Record<string, Extra>; lo: number; hi: number }> {
  const ex = (await fetch("/data/admin_extra.json").then((r) => r.json())) as Record<string, Extra>;
  const v = Object.values(ex).map((e) => e.eo).filter((x): x is number => x != null);
  return { ex, lo: Math.min(...v), hi: Math.max(...v) };
}
// 고령인구 비율 항목 점수: 경산시 행정동 중 최저 0 ~ 최고 1
export const eoScore = (r: number | null | undefined, lo: number, hi: number) => (r == null || hi <= lo ? 0 : (r - lo) / (hi - lo));
