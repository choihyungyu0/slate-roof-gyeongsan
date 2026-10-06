"use client";

import maplibregl, { type LngLatBoundsLike, type MapGeoJSONFeature } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import Tour, { tourSeen } from "./Tour";

// cat: 1=대장 슬레이트 주택(단독 기재), 3=혼합 기재 주택, 2=그 외 주택, 0=그 밖(비주택·대장 미연결)
const CATS = [
  { cat: 1, label: "슬레이트 단독 기재 주택", color: "#f0703c" },
  { cat: 3, label: "혼합 기재 주택 (예: 기와/스레트)", color: "#f2c08a" },
  { cat: 2, label: "그 외 주택", color: "#7c9cc0" },
  { cat: 0, label: "그 밖 (비주택·대장 미연결)", color: "#414854" },
];
const PICK = "#ffe066";
const VWORLD_KEY = process.env.NEXT_PUBLIC_VWORLD_KEY;

type Props = {
  cat: number; h: number; he: number; hsrc: string; emd: string; reg: number; use?: string | null;
  roof?: string; etc?: string; rc?: string; how?: string; year?: number | null; yflag?: number; area?: number | null; sc?: number; st?: number;
  ps?: number; pr?: number; pn?: number; ca?: number; cr?: number; cs?: number; cd?: number; ce?: number; cc?: number; ds?: number; dd?: number; de?: number;
};
type Item = { id: number; p: Props; center: [number, number] };
type Emd = { name: string; houses: number; sure: number; slate: number; share: number; bounds: LngLatBoundsLike; center: [number, number] };

// 우선순위 점수 항목: 가중치와 근거 표시 (계산은 src/priority_score.py)
const SCORE_PARTS: { key: "ca" | "cr" | "cs" | "cd" | "ce" | "cc"; label: string; w: string; basis: (p: Props) => string }[] = [
  { key: "ca", label: "노후도", w: "0.30", basis: (p) => (p.year ? `${p.year}년 사용승인` : "연도 불명(중간값)") },
  { key: "cr", label: "지붕 면적", w: "0.15", basis: (p) => (p.area != null ? `건축면적 ${p.area}㎡` : "미확인") },
  { key: "cs", label: "학교 거리", w: "0.20", basis: (p) => `${p.ds!.toLocaleString()}m` },
  { key: "cd", label: "어린이집 거리", w: "0.15", basis: (p) => `${p.dd!.toLocaleString()}m` },
  { key: "ce", label: "경로당 거리", w: "0.10", basis: (p) => `${p.de!.toLocaleString()}m` },
  { key: "cc", label: "기재 확실성", w: "0.10", basis: (p) => p.rc ?? "" },
];

function ringBounds(geom: GeoJSON.Geometry): [number, number, number, number] {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === "number") {
      const [x, y] = c as number[];
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    } else (c as unknown[]).forEach(walk);
  };
  walk((geom as GeoJSON.Polygon).coordinates);
  return [x0, y0, x1, y1];
}

// 건물 단위 자료는 2만 동씩 나눈 조각으로 받는다
async function loadBuildings(): Promise<GeoJSON.FeatureCollection> {
  const { parts } = (await fetch("/data/buildings.manifest.json").then((r) => r.json())) as { parts: number };
  const chunks = await Promise.all(Array.from({ length: parts }, (_, k) =>
    fetch(`/data/buildings.part${k}.json`).then((r) => r.json() as Promise<GeoJSON.FeatureCollection>)));
  return { type: "FeatureCollection", features: chunks.flatMap((c) => c.features) };
}

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const picked = useRef<number | null>(null);
  const [emds, setEmds] = useState<Emd[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [sel, setSel] = useState<Props | null>(null);
  const [ready, setReady] = useState(false);
  const [aerial, setAerial] = useState(Boolean(VWORLD_KEY));  // 키가 있으면 항공영상을 기본으로 켠다
  const [tab, setTab] = useState<"info" | "list">("info");
  const [items, setItems] = useState<Item[]>([]);  // 우선순위 점수가 있는 건물(점수 높은 순)
  const [listEmd, setListEmd] = useState("전체");
  const [listN, setListN] = useState(95);
  const [tour, setTour] = useState(false);

  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#121418" } }] },
      center: [128.823, 35.821], zoom: 15.6, pitch: 58, bearing: -18, maxPitch: 75, attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "건축물대장 표제부·GIS건물통합정보(국토교통부) · 브이월드" }));

    map.on("load", async () => {
      const [emdJson, bld] = await Promise.all([
        fetch("/data/emd.geojson").then((r) => r.json() as Promise<GeoJSON.FeatureCollection>),
        loadBuildings(),
      ]);
      if (VWORLD_KEY) {
        map.addSource("aerial", {
          type: "raster", tileSize: 256, maxzoom: 19,
          tiles: [`https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Satellite/{z}/{y}/{x}.jpeg`],
        });
        map.addLayer({ id: "aerial", type: "raster", source: "aerial", paint: { "raster-opacity": 0.85 } });
      }
      map.addSource("emd", { type: "geojson", data: emdJson });
      map.addLayer({ id: "emd-fill", type: "fill", source: "emd", paint: { "fill-color": "#1a1d23", "fill-opacity": VWORLD_KEY ? 0 : 0.6 } });
      map.addLayer({ id: "emd-line", type: "line", source: "emd", paint: { "line-color": "#5b6370", "line-width": 1.2 } });
      map.addSource("bld", { type: "geojson", data: bld });
      map.addLayer({
        id: "bld", type: "fill-extrusion", source: "bld",
        paint: {
          "fill-extrusion-color": ["case", ["boolean", ["feature-state", "picked"], false], PICK,
            ["match", ["get", "cat"], 1, CATS[0].color, 3, CATS[1].color, 2, CATS[2].color, CATS[3].color]],
          "fill-extrusion-height": ["get", "h"],
          "fill-extrusion-opacity": 0.92,
        },
      });

      const c: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
      const scored: Item[] = [];
      for (const f of bld.features) {
        const p = f.properties as Props;
        c[p.cat]++;
        if (p.ps != null) {
          const b = ringBounds(f.geometry);
          scored.push({ id: f.id as number, p, center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] });
        }
      }
      setCounts(c);
      setItems(scored.sort((a, b) => a.p.pr! - b.p.pr!));
      const list = emdJson.features.map((f): Emd => {
        const b = ringBounds(f.geometry);
        const p = f.properties as { emd_kor_nm: string; houses: number; slate_sure: number; slate_houses: number; slate_share_pct: number };
        return { name: p.emd_kor_nm, houses: p.houses, sure: p.slate_sure, slate: p.slate_houses, share: p.slate_share_pct,
          bounds: [[b[0], b[1]], [b[2], b[3]]], center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] };
      }).sort((a, b) => b.slate - a.slate);
      setEmds(list);
      for (const e of list) {
        const d = document.createElement("div");
        d.className = e.name.endsWith("동") ? "emdlabel dong" : "emdlabel";
        d.textContent = e.name;
        new maplibregl.Marker({ element: d }).setLngLat(e.center).addTo(map);
      }
      setReady(true);
      if (!tourSeen()) setTour(true);  // 처음 온 사용자에게만 자동으로
    });

    map.on("click", "bld", (ev) => {
      const f = ev.features?.[0] as MapGeoJSONFeature | undefined;
      if (!f || f.id == null) return;
      pick(f.id as number, f.properties as Props);
    });
    map.on("mouseenter", "bld", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "bld", () => { map.getCanvas().style.cursor = ""; });
    return () => map.remove();
  }, []);

  const pick = (id: number, props: Props) => {
    const map = mapRef.current;
    if (!map) return;
    if (picked.current != null) map.setFeatureState({ source: "bld", id: picked.current }, { picked: false });
    picked.current = id;
    map.setFeatureState({ source: "bld", id }, { picked: true });
    setSel(props);
    setTab("info");
  };
  const visit = (it: Item) => {
    mapRef.current?.flyTo({ center: it.center, zoom: 18, pitch: 55, bearing: -18, duration: 1200 });
    pick(it.id, it.p);
  };
  const listAll = listEmd === "전체" ? items : items.filter((it) => it.p.emd === listEmd);
  const listShown = listAll.slice(0, listN);
  const downloadList = () => {
    const head = ["목록순번", "시전체순위", "점수", "읍면동", "분류", "지붕자유기재", "사용승인연도", "건축면적", "학교거리m", "어린이집거리m", "경로당거리m", "경도", "위도"];
    const rows = listShown.map((it, i) => [i + 1, it.p.pr, it.p.ps, it.p.emd, it.p.rc, `"${(it.p.etc ?? "").replace(/"/g, '""')}"`,
      it.p.year ?? "", it.p.area ?? "", it.p.ds, it.p.dd, it.p.de, it.center[0].toFixed(6), it.center[1].toFixed(6)].join(","));
    const blob = new Blob(["﻿" + [head.join(","), ...rows].join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `찾아가는신청목록_${listEmd}_${listShown.length}동.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const flyTo = (name: string) => {
    const e = emds.find((x) => x.name === name);
    if (e) mapRef.current?.fitBounds(e.bounds, { padding: 40, pitch: 50, bearing: -18, duration: 1200 });
  };
  const toggleAerial = () => {
    const next = !aerial;
    mapRef.current?.setLayoutProperty("aerial", "visibility", next ? "visible" : "none");
    mapRef.current?.setPaintProperty("emd-fill", "fill-opacity", next ? 0 : 0.6);
    setAerial(next);
  };
  const cat = sel ? CATS.find((c) => c.cat === sel.cat)! : null;

  return (
    <div className="app">
      <div className="map">
        <div className="canvas" ref={el} />
        {!ready && <div className="loading">건물 도형을 불러오는 중…</div>}
        <div className="bar">
          <div className="brand"><a href="/">온지붕</a><small>건물 단위 지도</small></div>
          <select aria-label="읍·면·동으로 이동" defaultValue="" onChange={(e) => flyTo(e.target.value)}>
            <option value="" disabled>읍·면·동으로 이동</option>
            {emds.map((e) => <option key={e.name} value={e.name}>{e.name} · 슬레이트 주택 {e.sure.toLocaleString()}~{e.slate.toLocaleString()}동</option>)}
          </select>
          {VWORLD_KEY && <button aria-pressed={aerial} onClick={toggleAerial}>항공영상</button>}
          <button onClick={() => setTour(true)}>사용법</button>
        </div>
        <div className="legend">
          {CATS.map((c) => (
            <div key={c.cat}><i style={{ background: c.color }} />{c.label}<span className="n">{(counts[c.cat] ?? 0).toLocaleString()}</span></div>
          ))}
          <div className="note">색은 건축물대장 기재 기준 · 현장 미확인</div>
        </div>
      </div>
      <aside>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === "info"} onClick={() => setTab("info")}>건물 정보</button>
          <button role="tab" aria-selected={tab === "list"} onClick={() => setTab("list")}>찾아가는 신청 목록</button>
        </div>
        {tab === "list" ? (
          <>
            <p className="note">대장에 슬레이트로 적힌 주택을 우선순위 점수 순으로 보여줍니다. 지원 사업을 먼저 안내하러 갈 집을 고르는 용도이며, 실제 슬레이트 여부는 현장에서 확인해야 합니다.</p>
            <div className="filters">
              <select aria-label="읍·면·동" value={listEmd} onChange={(e) => setListEmd(e.target.value)}>
                <option value="전체">경산시 전체</option>
                {emds.map((e) => <option key={e.name} value={e.name}>{e.name}</option>)}
              </select>
              <select aria-label="표시 수" value={listN} onChange={(e) => setListN(Number(e.target.value))}>
                <option value={30}>상위 30동</option>
                <option value={95}>상위 95동 (2026년 지원 물량)</option>
                <option value={300}>상위 300동</option>
              </select>
              <button onClick={downloadList} disabled={!listShown.length}>CSV</button>
            </div>
            <p className="note">{listEmd} 대상 {listAll.length.toLocaleString()}동 중 {listShown.length.toLocaleString()}동 표시 · 행을 누르면 지도에서 그 건물로 이동합니다</p>
            <table className="visit">
              <thead><tr><th>#</th><th>읍·면·동</th><th>기재</th><th>사용승인</th><th>점수</th></tr></thead>
              <tbody>
                {listShown.map((it, i) => (
                  <tr key={it.id} className="row" onClick={() => visit(it)}>
                    <td>{i + 1}</td><td>{it.p.emd}</td><td>{it.p.rc === "혼합" ? "혼합" : "단독"}</td>
                    <td>{it.p.year ? `${it.p.year}` : "불명"}</td><td>{it.p.ps!.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">순위는 건물 도형과 연결된 주택만 대상입니다. 주소·지번은 표시하지 않으며, CSV에도 건물 위치(좌표)까지만 들어갑니다. 가중치는 기본값입니다.</p>
          </>
        ) : sel && cat ? (
          <>
            <span className="tag" style={{ background: cat.color }}>{cat.label}</span>
            <h3>건축물대장</h3>
            {sel.reg ? (
              <dl>
                <dt>읍·면·동</dt><dd>{sel.emd}</dd>
                <dt>주용도</dt><dd>{sel.use || "미확인"}</dd>
                <dt>지붕 코드</dt><dd>{sel.roof || "(빈값)"}</dd>
                <dt>지붕 자유기재</dt><dd>{sel.etc || "(빈값)"}</dd>
                <dt>정규화 분류</dt><dd>{sel.rc}</dd>
                <dt>슬레이트 근거</dt>
                <dd>{sel.sc && sel.st ? "코드 + 자유기재" : sel.sc ? "코드만" : sel.st ? "자유기재만 (코드로는 안 잡힘)" : "해당 없음"}</dd>
                <dt>사용승인</dt><dd>{sel.year ? `${sel.year}년` : sel.yflag ? "연도 불명 (대장 기재값 비정상)" : "연도 불명"}</dd>
                <dt>건축면적</dt><dd>{sel.area != null ? `${sel.area}㎡` : "미확인"}</dd>
                <dt>도형 연결</dt><dd>{sel.how}</dd>
              </dl>
            ) : (
              <>
                <dl><dt>읍·면·동</dt><dd>{sel.emd}</dd><dt>GIS 용도</dt><dd>{sel.use || "미확인"}</dd></dl>
                <p className="note">이 건물 도형과 연결된 건축물대장 표제부가 없습니다. 지붕 정보는 알 수 없습니다.</p>
              </>
            )}
            {sel.ps != null && (
              <>
                <h3>우선순위 점수 (정책 점수)</h3>
                <div className="score"><b>{sel.ps.toFixed(1)}</b><span>/ 100 · {sel.pr!.toLocaleString()}위 / {sel.pn!.toLocaleString()}동</span></div>
                <table className="parts">
                  <thead><tr><th>항목 (가중치)</th><th>근거</th><th>항목 점수</th></tr></thead>
                  <tbody>
                    {SCORE_PARTS.map((p) => (
                      <tr key={p.key}><td>{p.label} ({p.w})</td><td>{p.basis(sel)}</td><td>{Math.round((sel[p.key] ?? 0) * 100)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <p className="note">먼저 찾아갈 순서를 정하는 정책 점수입니다. 가중치는 기본값이며 정확도가 있는 예측이 아닙니다. 거리는 직선거리입니다.</p>
              </>
            )}
            <h3>높이</h3>
            <dl>
              <dt>표시 높이</dt>
              <dd>{sel.h}m{sel.he ? <span className="badge">높이 추정</span> : null}</dd>
              <dt>출처</dt><dd>{sel.hsrc}</dd>
            </dl>
            <p className="note">지붕 재료는 대장 기재이며 실제와 다를 수 있습니다. 주소·지번은 표시하지 않습니다.</p>
          </>
        ) : (
          <>
            <h2>건물을 눌러 대장 기록을 확인하세요</h2>
            <p className="note">진한 주황은 대장 지붕이 슬레이트 단독으로, 연한 주황은 다른 재료와 함께(혼합) 적힌 주택입니다. 3D 높이는 보기용이며 판정 기능이 아닙니다.</p>
            <h3>읍·면·동별 대장 슬레이트 주택 (확실 ~ 최대)</h3>
            <table>
              <thead><tr><th>읍·면·동</th><th>주택</th><th>확실</th><th>최대</th></tr></thead>
              <tbody>
                {emds.map((e) => (
                  <tr key={e.name} className="row" onClick={() => flyTo(e.name)}>
                    <td>{e.name}</td><td>{e.houses.toLocaleString()}</td><td>{e.sure.toLocaleString()}</td><td>{e.slate.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="note">확실은 슬레이트 단독 기재, 최대는 혼합 기재 포함입니다. 집계는 대장 전체 기준이고, 지도에는 건물 도형과 연결된 건물만 색이 칠해집니다.</p>
          </>
        )}
      </aside>
      <Tour open={tour} onClose={() => setTour(false)} />
    </div>
  );
}
