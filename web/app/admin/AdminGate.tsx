"use client";

import { useEffect, useState } from "react";

import MapView from "../MapView";

const STORE = "onjibung-admin-key";

// 접근 키를 입력해야 건물 단위 화면을 연다. 키는 이 탭(sessionStorage)에만 둔다.
export default function AdminGate() {
  const [key, setKey] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try { const k = sessionStorage.getItem(STORE); if (k) setKey(k); } catch { /* 저장소를 못 쓰면 매번 입력 */ }
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const k = input.trim();
    if (!k) return;
    setError("");
    try { sessionStorage.setItem(STORE, k); } catch { /* 무시 */ }
    setKey(k);
  };
  const denied = (message: string) => {
    try { sessionStorage.removeItem(STORE); } catch { /* 무시 */ }
    setKey(null);
    setInput("");
    setError(message);
  };

  if (key) return <MapView accessKey={key} onDenied={denied} />;
  return (
    <main className="gate">
      <form onSubmit={submit}>
        <h1>온지붕 <small>행정 담당자 화면</small></h1>
        <p>건물 단위 화면은 낙인과 민원을 막기 위해 행정 담당자에게만 엽니다. 발급받은 접근 키를 입력하세요.</p>
        <label htmlFor="k">접근 키</label>
        <input id="k" type="password" autoComplete="off" value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
        {error && <p className="err" role="alert">{error}</p>}
        <div className="gate-actions"><a href="/">← 공개 화면</a><button type="submit">열기</button></div>
      </form>
    </main>
  );
}
