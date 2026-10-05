"use client";

import { useEffect, useState } from "react";

// 처음 들어온 사용자에게 화면 쓰는 법을 차례로 보여주는 안내(온보딩 투어)
const STEPS: { target: string; title: string; body: string }[] = [
  { target: ".legend", title: "색으로 보는 대장 기록",
    body: "진한 주황은 건축물대장에 지붕이 슬레이트로만 적힌 주택, 연한 주황은 다른 재료와 함께 적힌 주택입니다. 대장 기재 기준이며 현장에서 확인한 것은 아닙니다." },
  { target: ".canvas", title: "건물을 눌러 보세요",
    body: "건물을 누르면 지붕 기재, 사용승인연도, 우선순위 점수가 오른쪽에 나옵니다. 마우스 오른쪽 버튼으로 끌면 지도를 돌리고 기울일 수 있습니다." },
  { target: ".tabs", title: "찾아가는 신청 목록",
    body: "지원 사업을 먼저 안내할 집을 점수 순으로 보여줍니다. 읍·면과 표시 수를 고르고, 행을 누르면 지도에서 그 건물로 이동합니다. 목록은 CSV로 받을 수 있습니다." },
  { target: ".bar", title: "읍·면 이동과 항공영상",
    body: "위쪽에서 읍·면을 골라 이동하고, 항공영상 배경을 켜고 끌 수 있습니다. 이 안내는 '사용법' 버튼으로 다시 볼 수 있습니다." },
];
const KEY = "roof-tour-v1";

export default function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!open) return;
    const el = document.querySelector(STEPS[i].target);
    el?.classList.add("tour-focus");
    return () => el?.classList.remove("tour-focus");
  }, [open, i]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;
  const finish = () => {
    try { localStorage.setItem(KEY, "1"); } catch { /* 저장 불가 환경에서는 매번 보여준다 */ }
    setI(0);
    onClose();
  };
  const s = STEPS[i];
  const last = i === STEPS.length - 1;
  return (
    <div className="tour" role="dialog" aria-label="사용법 안내">
      <div className="tour-step">{i + 1} / {STEPS.length}</div>
      <h2>{s.title}</h2>
      <p>{s.body}</p>
      <div className="tour-actions">
        <button onClick={finish}>건너뛰기</button>
        <span />
        {i > 0 && <button onClick={() => setI(i - 1)}>이전</button>}
        <button className="primary" onClick={() => (last ? finish() : setI(i + 1))}>{last ? "시작하기" : "다음"}</button>
      </div>
    </div>
  );
}

export function tourSeen(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
