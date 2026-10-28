// 질의 도우미 도구 — 배포 JSON(public/data)만 읽어 계산한다. 판정·추정은 하지 않는다.
import { readFile } from "node:fs/promises";
import path from "node:path";

const DIR = path.join(process.cwd(), "public", "data");
const W: Record<string, [string, number]> = {
  ca: ["노후도", 0.3], cr: ["지붕 면적", 0.15], cs: ["학교 거리", 0.2], cd: ["어린이집 거리", 0.15], ce: ["경로당 거리", 0.1], cc: ["기재 확실성", 0.1],
};
type Row = {
  id: string; emd: string; ri: string | null; ps: number; pr: number; rc: string; roof: string; etc: string; year: number | null; area: number | null;
  ds: number; dd: number; de: number; ca: number; cr: number; cs: number; cd: number; ce: number; cc: number; pm: number | null; rules: string;
};
type Rule = { order: number; label: string; note: string; pattern: string; examples: string[]; n: number };
type Emd = { name: string; houses: number; sure: number; max: number };
type Data = { rows: Row[]; rules: Rule[]; laws: unknown[]; summary: Record<string, unknown>; emds: Emd[]; miss: Record<string, number> };

let cache: Promise<Data> | null = null;
const json = async <T,>(f: string): Promise<T> => JSON.parse(await readFile(path.join(DIR, f), "utf-8")) as T;
export function load(): Promise<Data> {
  cache ??= (async () => {
    const idx = await json<{ cols: string[]; rows: unknown[][] }>("ask_index.json");
    const rows = idx.rows.map((r) => Object.fromEntries(idx.cols.map((c, i) => [c, r[i]])) as Row);
    const emd = await json<GeoJSON.FeatureCollection>("emd.geojson");
    const emds = emd.features.map((f) => {
      const q = f.properties as { emd_kor_nm: string; houses: number; slate_sure: number; slate_houses: number };
      return { name: q.emd_kor_nm, houses: q.houses, sure: q.slate_sure, max: q.slate_houses };
    }).sort((a, b) => b.max - a.max);
    const review = await json<{ emd: Record<string, number> }>("review.json");
    return { rows, rules: await json<Rule[]>("rules.json"), laws: await json<unknown[]>("legal_basis.json"), summary: await json<Record<string, unknown>>("summary.json"),
      emds, miss: review.emd };
  })();
  return cache;
}

const judg = (r: Row) => (r.rc === "혼합" ? "혼합" : r.rc === "코드만 슬레이트" ? "코드만" : "단독");
const brief = (r: Row) => ({ id: r.id, rank: r.pr, score: r.ps, score_text: r.ps.toFixed(1), emd: r.emd, ri: r.ri, judgment: judg(r), roof_code: r.roof, roof_text: r.etc, year: r.year });

export const TOOL_DEFS = [
  { type: "function", function: { name: "query_buildings", description: "명부(위치가 연결돼 점수가 매겨진 대장 슬레이트 주택 4,644동)에서 조건에 맞는 건물을 센다. 거리 조건은 그 거리 이내(직선거리, m). judgment: 확실=단독+코드만.",
    parameters: { type: "object", properties: {
      emd: { type: "string", description: "읍면동 이름(예: 하양읍)" }, ri: { type: "string", description: "법정리 이름(예: 금락리)" },
      judgment: { type: "string", enum: ["단독", "혼합", "코드만", "확실"] }, year_max: { type: "integer", description: "사용승인연도 이하" },
      score_min: { type: "number" }, rank_max: { type: "integer", description: "경산시 전체 순위 N위 이내로 거를 때만(예: '점수 상위 95동 중'). 'OO면 상위 5동'은 rank_max가 아니라 limit=5" },
      school_m: { type: "number" }, daycare_m: { type: "number" }, senior_m: { type: "number" },
      sort: { type: "string", enum: ["score", "year"] }, limit: { type: "integer", description: "점수순으로 보여줄 건수. 'OO면 상위 N동 보여 줘'는 limit=N(최대 30, 기본 10)" } } } } },
  { type: "function", function: { name: "get_building", description: "건물 한 동의 대장 기재, 판정, 걸린 규칙 번호, 항목별 점수와 기본 가중치. id(B+6자리) 또는 rank(경산시 순위) 중 하나.",
    parameters: { type: "object", properties: { id: { type: "string" }, rank: { type: "integer" } } } } },
  { type: "function", function: { name: "get_summary", description: "대장 슬레이트 주택 집계(확실~최대, 코드가 놓친 집). emd를 주면 그 읍면동, 없으면 경산시 전체와 읍면동 표.",
    parameters: { type: "object", properties: { emd: { type: "string" } } } } },
  { type: "function", function: { name: "get_rule", description: "판정 규칙 설명(rules.json). rule_id는 R-40, R40, 40 같은 규칙 번호.",
    parameters: { type: "object", properties: { rule_id: { type: "string" } }, required: ["rule_id"] } } },
  { type: "function", function: { name: "get_law", description: "안내문 근거 법령 조문 목록(국가법령정보센터 Open API 조회 결과).", parameters: { type: "object", properties: {} } } },
] as const;

export async function runTool(name: string, a: Record<string, unknown>): Promise<Record<string, unknown>> {
  const d = await load();
  const emdNames = new Set(d.emds.map((e) => e.name));
  if (name === "query_buildings") {
    if (a.emd && !emdNames.has(String(a.emd))) return { error: `경산시에 '${a.emd}'라는 읍면동이 없습니다`, emd_list: [...emdNames] };
    const base = d.rows.filter((r) => (!a.emd || r.emd === a.emd) && (!a.ri || r.ri === a.ri)
      && (!a.judgment || (a.judgment === "확실" ? judg(r) !== "혼합" : judg(r) === a.judgment))
      && (a.year_max == null || (r.year != null && r.year <= Number(a.year_max))) && (a.score_min == null || r.ps >= Number(a.score_min))
      && (a.rank_max == null || r.pr <= Number(a.rank_max)));
    const hit = base.filter((r) => (a.school_m == null || r.ds <= Number(a.school_m)) && (a.daycare_m == null || r.dd <= Number(a.daycare_m))
      && (a.senior_m == null || r.de <= Number(a.senior_m)));
    const sorted = a.sort === "year" ? [...hit].sort((x, y) => (x.year ?? 9999) - (y.year ?? 9999)) : hit;
    const lim = Math.min(Math.max(Number(a.limit ?? 10), 1), 30);
    const distance = a.school_m != null || a.daycare_m != null || a.senior_m != null;
    const pct = base.length ? ((hit.length / base.length) * 100).toFixed(1) : "0.0";
    // 답 첫 줄에 그대로 쓰는 문장: "하양읍 확실 슬레이트 364동 중 학교 500m 안이 154동(42.3%)"
    const kind = a.judgment === "확실" ? "확실 슬레이트" : a.judgment === "혼합" ? "혼합 기재 슬레이트" : a.judgment === "단독" ? "단독 기재 슬레이트" : a.judgment === "코드만" ? "코드만 슬레이트" : "대장 슬레이트";
    const scopeName = [a.emd ?? "경산시", a.ri, a.rank_max != null ? `점수 상위 ${a.rank_max}위 이내` : null, a.year_max != null ? `${a.year_max}년 이전 사용승인` : null,
      a.score_min != null ? `${a.score_min}점 이상` : null, kind].filter(Boolean).join(" ");
    const dist = [a.school_m != null ? `학교 ${a.school_m}m` : null, a.daycare_m != null ? `어린이집 ${a.daycare_m}m` : null, a.senior_m != null ? `경로당 ${a.senior_m}m` : null]
      .filter(Boolean).join("·");
    const sentence = distance ? `${scopeName} ${base.length.toLocaleString()}동 중 ${dist} 안이 ${hit.length.toLocaleString()}동(${pct}%)` : `${scopeName} ${hit.length.toLocaleString()}동`;
    return { conditions: a, scope: "명부 4,644동(위치 연결된 대장 슬레이트 주택) 기준", sentence, count: hit.length,
      ...(distance ? { count_before_distance: base.length, pct_of_before_distance: pct } : {}),
      top: sorted.slice(0, lim).map(brief) };
  }
  if (name === "get_building") {
    // 순위가 오면 경산시 전체 순위로 먼저 찾는다. id 자리에 "2"·"2위"가 와도 순위로 본다
    const idText = String(a.id ?? "").trim().toUpperCase();
    const rank = a.rank != null ? Number(a.rank) : /^B\d{6}$/.test(idText) ? NaN : Number(idText.replace(/[^0-9]/g, ""));
    const r = Number.isFinite(rank) && rank > 0 ? d.rows.find((x) => x.pr === rank) : d.rows.find((x) => x.id === idText);
    if (!r) return { error: "해당 건물이 명부에 없습니다" };
    const parts = Object.entries(W).map(([k, [label, w]]) => ({ item: label, weight: w, item_score: Math.round((r[k as keyof Row] as number) * 100) }));
    return { ...brief(r), area_m2: r.area, school_m: r.ds, daycare_m: r.dd, senior_m: r.de, rules_hit: r.rules ? r.rules.split(" ").map((x) => `R-${x}`) : [],
      permit_record: r.pm == null ? "미확인" : r.pm ? "같은 필지에 철거·멸실 신고 기록 있음" : "기록 없음", score_parts: parts,
      score_formula: "점수 = Σ(항목 점수×가중치) ÷ Σ가중치", note: "주소·지번·소유자는 배포 데이터에 없음. 행정망 파일에서 건물 ID로 결합" };
  }
  if (name === "get_summary") {
    if (a.emd) {
      const e = d.emds.find((x) => x.name === a.emd);
      if (!e) return { error: `경산시에 '${a.emd}'라는 읍면동이 없습니다`, emd_list: [...emdNames] };
      return { emd: e.name, houses: e.houses, sure: e.sure, max: e.max, code_missed: d.miss[e.name] ?? 0, roster_count: d.rows.filter((r) => r.emd === e.name).length,
        basis: "건축물대장 기재 기준(현장 미확인)" };
    }
    const s = d.summary as { houses: number; code: number; sure: number; max: number };
    return { city: "경산시", houses: s.houses, sure: s.sure, max: s.max, code_missed: s.max - s.code, roster_count: d.rows.length,
      by_emd: d.emds.slice(0, 15).map((e) => ({ emd: e.name, sure: e.sure, max: e.max, code_missed: d.miss[e.name] ?? 0 })), basis: "건축물대장 기재 기준(현장 미확인)" };
  }
  if (name === "get_rule") {
    const n = Number(String(a.rule_id ?? "").replace(/[^0-9]/g, ""));
    const r = d.rules.find((x) => x.order === n);
    if (!r) return { error: `규칙 ${a.rule_id}은(는) 없습니다`, rule_ids: d.rules.map((x) => `R-${x.order}`) };
    return { rule_id: `R-${r.order}`, label: r.label, note: r.note, pattern: r.pattern, examples: r.examples, title_count: r.n };
  }
  if (name === "get_law") return { laws: d.laws };
  return { error: "없는 도구" };
}
