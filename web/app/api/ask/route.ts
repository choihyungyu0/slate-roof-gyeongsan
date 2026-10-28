// 질의 도우미 API — OpenAI Chat Completions(tool calling). AI는 조회·요약만 하고 판정하지 않는다.
// 키는 환경변수 OPENAI_API_KEY(Vercel), 모델은 OPENAI_MODEL(기본 gpt-4.1). 15초 제한, IP당 분당 10회.
import { runTool, TOOL_DEFS } from "./tools";

export const runtime = "nodejs";
export const maxDuration = 20;

const MODEL = process.env.OPENAI_MODEL || "gpt-4.1";
const DEADLINE = 15000;
const hits = new Map<string, number[]>();

const SYSTEM = `너는 경산시 슬레이트 사업 담당 공무원을 돕는 '온지붕 질의 도우미'다.
- 반드시 도구로 조회한 결과만 근거로 답한다. 답에 쓰는 모든 숫자는 도구 결과에 있는 숫자여야 한다. 계산이 필요하면 도구 결과의 count·pct 값을 그대로 쓴다.
- 판정하지 않는다. 지원 대상인지, 선정되는지 물으면 "선정은 해당 연도 공고와 담당자 확인으로 정합니다"라고 답하고, 그 집의 대장 기재·점수 근거만 보여 준다.
- 개인정보(소유자, 이름, 주소, 지번, 연락처)는 배포 데이터에 없다. 물으면 "주소·지번·소유자는 이 화면에 없고, 행정망 파일에서 건물 ID로 결합합니다"라고 답한다.
- 도구 결과에 error가 있으면 그 내용대로 '없다/모른다'고 답하고 지어내지 않는다.
- 답은 한국어 개조식 3~6줄, 조회 조건과 건수, 걸린 규칙 번호(R-40 등)·점수 항목을 함께 적는다. 건물은 건물 ID로 부른다. 긴 줄표(—)를 쓰지 않는다.
- "N위 집"처럼 순위로 물으면 앞 질문의 읍면동·거리 조건을 이어 쓰지 말고 경산시 전체 순위로 get_building(rank=N)을 호출한다. "이 집"은 바로 앞 답의 건물 ID다.
- 읍면동·경산시의 슬레이트 주택이 모두 몇 동인지(확실·최대) 물으면 get_summary를 쓴다(대장 전체 집계). query_buildings는 명부(위치 연결 4,644동) 안에서 거리·연도·순위·점수 조건으로 거를 때만 쓴다.
- 조건은 질문에 나온 것만 넣는다. judgment(확실·혼합·단독·코드만)는 질문에 그 말이 있을 때만 넣고, "OO면 상위 N동"은 판정 조건·rank_max 없이 emd와 limit=N으로 점수순 조회한다.
- query_buildings 결과의 sentence를 첫 줄에 그대로 쓴다(예: 하양읍 확실 슬레이트 364동 중 학교 500m 안이 154동(42.3%)). 범위와 거리 조건을 바꿔 쓰지 않는다.
- 점수는 score_text를 그대로(예: 93.0점), 비율은 pct 값을 그대로(예: 100.0%) 쓴다.
- 지붕 자유기재 원문(roof_text)은 한 글자도 바꾸지 말고 「」 안에 그대로 인용한다(예: 「기와/스레트/아연」). '스레트'를 '슬레이트'로 고치지 않는다.
- 숫자는 대장 기재 기준이며 현장 미확인이라는 점을 필요하면 한 줄로 덧붙인다.`;

type Msg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string };
type Ev = { tool: string; args: Record<string, unknown>; result: Record<string, unknown> };

const PRIVACY = /(소유자|소유주|집주인|이름|성명|주소|지번|연락처|전화|주민번호)/;
const JUDGE = /(지원\s*대상|대상이야|대상인가|대상이에요|선정(돼|되|될)|받을 수 있|해당(돼|되)|자격)/;
const POLICY_LINE = "선정은 해당 연도 공고와 담당자 확인으로 정합니다. 온지붕은 판정하지 않고 아래 조회 결과만 보여 드립니다.";
const PRIVACY_LINE = "주소·지번·소유자는 이 화면과 배포 데이터에 없습니다. 행정망 파일에서 건물 ID로 결합해 확인합니다.";

// 답에 나온 숫자가 모두 도구 결과(또는 질문)에 있는지 확인한다
function numbersOk(answer: string, ev: Ev[], q: string) {
  const pool = new Set<string>();
  const add = (s: string) => { for (const m of s.matchAll(/\d[\d,]*(?:\.\d+)?/g)) pool.add(m[0].replace(/,/g, "")); };
  add(JSON.stringify(ev.map((e) => e.result)));
  add(q);
  add("70 65 10 1 2 3 4 5 6");  // 개조식 번호·고정 문구(70세 이상 등)
  const bad = [...answer.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "")).filter((x) => !pool.has(x) && !pool.has(String(Number(x))));
  return { ok: bad.length === 0, bad };
}

export async function GET() {
  return Response.json({ enabled: Boolean(process.env.OPENAI_API_KEY), model: MODEL });
}

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "질의 기능 일시 중단(키 미설정)" }, { status: 503 });
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const t = Date.now();
  const recent = (hits.get(ip) ?? []).filter((x) => t - x < 60000);
  if (recent.length >= 10) return Response.json({ error: "요청이 많습니다. 1분 뒤 다시 질문해 주세요." }, { status: 429 });
  hits.set(ip, [...recent, t]);

  let body: { question?: string; history?: { q: string; a: string }[] };
  try { body = await req.json(); } catch { return Response.json({ error: "잘못된 요청" }, { status: 400 }); }
  const q = String(body.question ?? "").slice(0, 300).trim();
  if (!q) return Response.json({ error: "질문을 입력해 주세요" }, { status: 400 });

  const msgs: Msg[] = [{ role: "system", content: SYSTEM }];
  for (const h of (body.history ?? []).slice(-3)) msgs.push({ role: "user", content: h.q.slice(0, 300) }, { role: "assistant", content: h.a.slice(0, 800) });
  msgs.push({ role: "user", content: q });
  const ev: Ev[] = [];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), DEADLINE);
  try {
    let answer = "";
    for (let round = 0; round < 4; round++) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", signal: ctl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MODEL, messages: msgs, tools: TOOL_DEFS, temperature: 0, max_tokens: 600 }),
      });
      if (!r.ok) return Response.json({ error: "질의 기능 일시 중단" }, { status: 502 });
      const j = (await r.json()) as { choices: { message: Msg; finish_reason: string }[] };
      const m = j.choices[0].message;
      if (m.tool_calls?.length) {
        msgs.push({ role: "assistant", content: m.content ?? null, tool_calls: m.tool_calls });
        for (const c of m.tool_calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(c.function.arguments || "{}"); } catch { /* 빈 인자 */ }
          const result = await runTool(c.function.name, args);
          ev.push({ tool: c.function.name, args, result });
          msgs.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result) });
        }
        continue;
      }
      answer = (m.content ?? "").replace(/\s*—\s*/g, ": ").trim();
      break;
    }
    // 원칙 보강: 판정 질문·개인정보 질문에는 고정 문구를 맨 앞에 둔다
    if (PRIVACY.test(q) && !answer.includes("건물 ID로 결합")) answer = `${PRIVACY_LINE}\n${answer}`.trim();
    let chk = numbersOk(answer, ev, q);
    if (!chk.ok && Date.now() - t < DEADLINE - 5000) {  // 조회 결과에 없는 숫자가 있으면 한 번만 고쳐 쓰게 한다
      msgs.push({ role: "assistant", content: answer },
        { role: "user", content: `방금 답에 조회 결과에 없는 숫자(${chk.bad.join(", ")})가 있다. 도구 결과에 있는 숫자만 써서 같은 형식으로 다시 답하라.` });
      const r2 = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", signal: ctl.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: MODEL, messages: msgs, temperature: 0, max_tokens: 600 }),
      });
      if (r2.ok) {
        const j2 = (await r2.json()) as { choices: { message: Msg }[] };
        answer = (j2.choices[0].message.content ?? "").replace(/\s*—\s*/g, ": ").trim();
        if (PRIVACY.test(q) && !answer.includes("건물 ID로 결합")) answer = `${PRIVACY_LINE}\n${answer}`;
        chk = numbersOk(answer, ev, q);
      }
    }
    // 판정 질문에는 고정 문구를 맨 앞에 한 번만 둔다
    if (JUDGE.test(q)) answer = `${POLICY_LINE}\n${answer.replace(/[^\n]*선정은 해당 연도 공고[^\n]*\n?/g, "")}`.trim();
    if (!chk.ok) answer = "조회 결과에 없는 숫자가 답에 섞여 답을 표시하지 않습니다. 아래 조회 결과 표를 확인해 주세요.";
    return Response.json({ answer, evidence: ev, model: MODEL, numbers_checked: chk.ok, unverified: chk.bad });
  } catch (e) {
    const timeout = (e as Error).name === "AbortError";
    return Response.json({ error: timeout ? "응답 시간(15초)을 넘었습니다. 질문을 짧게 다시 해 주세요." : "질의 기능 일시 중단" }, { status: timeout ? 504 : 500 });
  } finally {
    clearTimeout(timer);
  }
}
