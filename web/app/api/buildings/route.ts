import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// 건물 단위 자료는 접근 키(환경변수 ADMIN_ACCESS_KEY)가 맞을 때만 내려준다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), "private-data");
const NO_STORE = { "Cache-Control": "private, no-store" };

function allowed(given: string | null): boolean {
  const expected = process.env.ADMIN_ACCESS_KEY;
  if (!expected || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!process.env.ADMIN_ACCESS_KEY) return Response.json({ error: "접근 키가 설정되지 않았습니다" }, { status: 503, headers: NO_STORE });
  if (!allowed(req.headers.get("x-access-key"))) return Response.json({ error: "접근 권한이 없습니다" }, { status: 401, headers: NO_STORE });

  const { parts } = JSON.parse(await readFile(path.join(DIR, "manifest.json"), "utf-8")) as { parts: number };
  const part = Number(new URL(req.url).searchParams.get("part") ?? "0");
  if (!Number.isInteger(part) || part < 0 || part >= parts) return Response.json({ error: "없는 조각입니다" }, { status: 404, headers: NO_STORE });

  const body = await readFile(path.join(DIR, `buildings.part${part}.json.gz`));
  return new Response(new Uint8Array(body), {
    headers: { ...NO_STORE, "Content-Type": "application/json; charset=utf-8", "Content-Encoding": "gzip", "X-Parts": String(parts) },
  });
}
