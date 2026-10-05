"use client";

import maplibregl, { type LngLatBoundsLike, type MapGeoJSONFeature } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

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
};
type Emd = { name: string; houses: number; sure: number; slate: number; share: number; bounds: LngLatBoundsLike; center: [number, number] };

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

export default function MapView() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const picked = useRef<number | null>(null);
  const [emds, setEmds] = useState<Emd[]>([]);
  const [counts, setCounts] = useState<Record<number, number>>({});
  const [sel, setSel] = useState<Props | null>(null);
  const [ready, setReady] = useState(false);
  const [aerial, setAerial] = useState(false);

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
        fetch("/data/buildings.geojson").then((r) => r.json() as Promise<GeoJSON.FeatureCollection>),
      ]);
      if (VWORLD_KEY) {
        map.addSource("aerial", {
          type: "raster", tileSize: 256, maxzoom: 19,
          tiles: [`https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Satellite/{z}/{y}/{x}.jpeg`],
        });
        map.addLayer({ id: "aerial", type: "raster", source: "aerial", layout: { visibility: "none" }, paint: { "raster-opacity": 0.85 } });
      }
      map.addSource("emd", { type: "geojson", data: emdJson });
      map.addLayer({ id: "emd-fill", type: "fill", source: "emd", paint: { "fill-color": "#1a1d23", "fill-opacity": 0.6 } });
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
      for (const f of bld.features) c[(f.properties as Props).cat]++;
      setCounts(c);
      const list = emdJson.features.map((f): Emd => {
        const b = ringBounds(f.geometry);
        const p = f.properties as { emd_kor_nm: string; houses: number; slate_sure: number; slate_houses: number; slate_share_pct: number };
        return { name: p.emd_kor_nm, houses: p.houses, sure: p.slate_sure, slate: p.slate_houses, share: p.slate_share_pct,
          bounds: [[b[0], b[1]], [b[2], b[3]]], center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] };
      }).sort((a, b) => b.slate - a.slate);
      setEmds(list);
      for (const e of list) {
        const d = document.createElement("div");
        d.className = "emdlabel";
        d.textContent = e.name;
        new maplibregl.Marker({ element: d }).setLngLat(e.center).addTo(map);
      }
      setReady(true);
    });

    map.on("click", "bld", (ev) => {
      const f = ev.features?.[0] as MapGeoJSONFeature | undefined;
      if (!f || f.id == null) return;
      if (picked.current != null) map.setFeatureState({ source: "bld", id: picked.current }, { picked: false });
      picked.current = f.id as number;
      map.setFeatureState({ source: "bld", id: picked.current }, { picked: true });
      setSel(f.properties as Props);
    });
    map.on("mouseenter", "bld", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "bld", () => { map.getCanvas().style.cursor = ""; });
    return () => map.remove();
  }, []);

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
          <div className="brand">지붕 아래 사람<small>경산시 읍·면 8곳 건물 지도</small></div>
          <select aria-label="읍·면으로 이동" defaultValue="" onChange={(e) => flyTo(e.target.value)}>
            <option value="" disabled>읍·면으로 이동</option>
            {emds.map((e) => <option key={e.name} value={e.name}>{e.name} · 슬레이트 주택 {e.sure.toLocaleString()}~{e.slate.toLocaleString()}동</option>)}
          </select>
          {VWORLD_KEY && <button aria-pressed={aerial} onClick={toggleAerial}>항공영상</button>}
        </div>
        <div className="legend">
          {CATS.map((c) => (
            <div key={c.cat}><i style={{ background: c.color }} />{c.label}<span className="n">{(counts[c.cat] ?? 0).toLocaleString()}</span></div>
          ))}
          <div className="note">색은 건축물대장 기재 기준 · 현장 미확인</div>
        </div>
      </div>
      <aside>
        {sel && cat ? (
          <>
            <span className="tag" style={{ background: cat.color }}>{cat.label}</span>
            <h3>건축물대장</h3>
            {sel.reg ? (
              <dl>
                <dt>읍·면</dt><dd>{sel.emd}</dd>
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
                <dl><dt>읍·면</dt><dd>{sel.emd}</dd><dt>GIS 용도</dt><dd>{sel.use || "미확인"}</dd></dl>
                <p className="note">이 건물 도형과 연결된 건축물대장 표제부가 없습니다. 지붕 정보는 알 수 없습니다.</p>
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
            <h3>읍·면별 대장 슬레이트 주택 (확실 ~ 최대)</h3>
            <table>
              <thead><tr><th>읍·면</th><th>주택</th><th>확실</th><th>최대</th></tr></thead>
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
    </div>
  );
}
