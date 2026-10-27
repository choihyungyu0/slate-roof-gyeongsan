"use client";

import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

// 첫 화면: 읍·면·동 단위 집계. 건물 단위 지도(/map)로 들어가는 링크를 둔다.
const SURE = "#f0703c";   // 확실(슬레이트 단독 기재)
const MIXED = "#f2c08a";  // 혼합 기재까지(최대)
const PICK = "#ffe066";
const M_PER_HOUSE = 4;    // 기둥 높이: 주택 1동 = 4m
const VWORLD_KEY = process.env.NEXT_PUBLIC_VWORLD_KEY;

type Summary = {
  houses: number; code: number; sure: number; max: number;
  llm?: { n: number; same4: number; same2: number };
  permit?: { n: number; any: number };
  transfer?: { name: string; uniq: number; unmatched: number; miss_pct: number; sure: number; max: number }[];
};
type Emd = { cd: string; name: string; houses: number; sure: number; max: number; share: number };

export default function PublicMap() {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [emds, setEmds] = useState<Emd[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [sum, setSum] = useState<Summary | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#121418" } }] },
      center: [128.80, 35.80], zoom: 10.4, pitch: 50, bearing: -12, maxPitch: 70, attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "건축물대장 표제부(국토교통부) · 브이월드" }));

    map.on("load", async () => {
      const json = (await fetch("/data/emd.geojson").then((r) => r.json())) as GeoJSON.FeatureCollection;
      if (VWORLD_KEY) {
        map.addSource("aerial", { type: "raster", tileSize: 256, maxzoom: 19,
          tiles: [`https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Satellite/{z}/{y}/{x}.jpeg`] });
        map.addLayer({ id: "aerial", type: "raster", source: "aerial", paint: { "raster-opacity": 0.55 } });
      }
      map.addSource("emd", { type: "geojson", data: json, promoteId: "emd_cd" });
      map.addLayer({ id: "emd-line", type: "line", source: "emd", paint: { "line-color": "#c9ccd2", "line-width": 1 } });
      // 아래쪽(진한 주황) = 확실, 위쪽(연한 주황) = 혼합 기재분. 전체 높이 = 최대
      map.addLayer({ id: "col-sure", type: "fill-extrusion", source: "emd", paint: {
        "fill-extrusion-color": ["case", ["boolean", ["feature-state", "picked"], false], PICK, SURE],
        "fill-extrusion-height": ["*", ["get", "slate_sure"], M_PER_HOUSE], "fill-extrusion-opacity": 0.9 } });
      map.addLayer({ id: "col-mixed", type: "fill-extrusion", source: "emd", paint: {
        "fill-extrusion-color": ["case", ["boolean", ["feature-state", "picked"], false], PICK, MIXED],
        "fill-extrusion-base": ["*", ["get", "slate_sure"], M_PER_HOUSE],
        "fill-extrusion-height": ["*", ["get", "slate_houses"], M_PER_HOUSE], "fill-extrusion-opacity": 0.9 } });
      // 주택이 많은 읍·면에는 이름과 확실~최대 수를 기둥 위에 적는다
      for (const f of json.features) {
        const p = f.properties as { emd_kor_nm: string; slate_sure: number; slate_houses: number };
        if (p.slate_houses < 100) continue;
        let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
        const walk = (c: unknown): void => {
          if (typeof (c as number[])[0] === "number") {
            const [x, y] = c as number[];
            x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
          } else (c as unknown[]).forEach(walk);
        };
        walk((f.geometry as GeoJSON.Polygon).coordinates);
        const d = document.createElement("div");
        d.className = "collabel";
        d.innerHTML = `<b>${p.emd_kor_nm}</b>${p.slate_sure.toLocaleString()}~${p.slate_houses.toLocaleString()}`;
        new maplibregl.Marker({ element: d }).setLngLat([(x0 + x1) / 2, (y0 + y1) / 2]).addTo(map);
      }
      setEmds(json.features.map((f) => {
        const p = f.properties as { emd_cd: string; emd_kor_nm: string; houses: number; slate_sure: number; slate_houses: number; slate_share_pct: number };
        return { cd: p.emd_cd, name: p.emd_kor_nm, houses: p.houses, sure: p.slate_sure, max: p.slate_houses, share: p.slate_share_pct };
      }).sort((a, b) => b.max - a.max));
    });
    const onClick = (ev: maplibregl.MapLayerMouseEvent) => {
      const cd = (ev.features?.[0]?.properties as { emd_cd?: string } | undefined)?.emd_cd;
      if (cd) setSel(cd);
    };
    for (const id of ["col-sure", "col-mixed"]) {
      map.on("click", id, onClick);
      map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
    }
    return () => map.remove();
  }, []);

  useEffect(() => {
    fetch("/data/summary.json").then((r) => r.json()).then(setSum).catch(() => setSum(null));
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("emd")) return;
    map.removeFeatureState({ source: "emd" });
    if (sel) map.setFeatureState({ source: "emd", id: sel }, { picked: true });
  }, [sel]);

  const total = emds.reduce((a, e) => ({ houses: a.houses + e.houses, sure: a.sure + e.sure, max: a.max + e.max }), { houses: 0, sure: 0, max: 0 });
  const picked = emds.find((e) => e.cd === sel);

  return (
    <div className="app with-banner">
      <div className="demo-banner">시연용 공개 화면 · 도입 시 건물 단위 정보는 행정망 내부 전용</div>
      <div className="map">
        <div className="canvas" ref={el} />
        <div className="bar">
          <div className="brand">온지붕<small>건축물대장 AI 기반 석면 슬레이트 주택 발굴</small></div>
        </div>
        <div className="legend">
          <div><i style={{ background: SURE }} />확실 — 지붕이 슬레이트로만 적힌 주택</div>
          <div><i style={{ background: MIXED }} />혼합 기재까지 더한 최대 (예: 기와/스레트)</div>
          <div className="note">기둥 높이 = 읍·면·동별 주택 수 · 건축물대장 기재 기준, 현장 미확인</div>
        </div>
      </div>
      <aside>
        <h2>경산시 대장 슬레이트 주택</h2>
        <div className="score"><b>{total.sure ? `${total.sure.toLocaleString()} ~ ${total.max.toLocaleString()}` : "…"}</b><span>동 (확실 ~ 최대)</span></div>
        <p className="note">건축물대장 지붕 코드와 자유기재란을 함께 읽어 집계했습니다. 주택류 표제부 {total.houses.toLocaleString()}동 기준이며 미등재 건축물은 포함되지 않습니다.</p>
        <a className="go" href="/map">건물 단위 지도 열기 →</a>
        {picked && (
          <>
            <h3>{picked.name}</h3>
            <dl>
              <dt>주택</dt><dd>{picked.houses.toLocaleString()}동</dd>
              <dt>확실</dt><dd>{picked.sure.toLocaleString()}동</dd>
              <dt>최대</dt><dd>{picked.max.toLocaleString()}동 (주택의 {picked.share}%)</dd>
            </dl>
          </>
        )}
        {sum && (
          <>
            <h3>어떻게 찾았나 · 어디까지 확인했나</h3>
            <ul className="facts">
              <li><b>코드만 세면 {sum.code.toLocaleString()}동, 자유기재까지 읽으면 최대 {sum.max.toLocaleString()}동.</b> 지붕 코드로는 안 잡히던 {(sum.max - sum.code).toLocaleString()}동({((sum.max - sum.code) / sum.max * 100).toFixed(1)}%)을 자유기재란 정규화로 찾았습니다.</li>
              {sum.llm && <li>자유기재 표기 {sum.llm.n.toLocaleString()}종을 규칙표와 LLM이 따로 분류해 비교했습니다. 4분류 일치 {(sum.llm.same4 / sum.llm.n * 100).toFixed(1)}%, 슬레이트 포함 여부 일치 {(sum.llm.same2 / sum.llm.n * 100).toFixed(1)}%. 정확도가 아니라 두 방법의 일치율입니다.</li>}
              {sum.transfer && <li>같은 규칙표를 고치지 않고 적용하면 {sum.transfer.map((t) => `${t.name} 표기 ${t.uniq.toLocaleString()}종 중 ${t.unmatched}종`).join(", ")}만 미분류였습니다. 코드 누락 비율은 {sum.transfer.map((t) => `${t.name} ${t.miss_pct}%`).join(", ")}로 시·군마다 다릅니다.</li>}
              {sum.permit && <li>대수선·철거멸실 인허가 기록과 필지 단위로 대조하면 겹치는 주택은 {sum.permit.any}동({(sum.permit.any / sum.permit.n * 100).toFixed(1)}%)뿐입니다. 인허가 기록으로는 지붕 개량 여부를 가릴 수 없어 현장 확인이 필요합니다.</li>}
              <li>모든 수치는 건축물대장 기재 기준이며 현장에서 확인한 값이 아닙니다.</li>
            </ul>
          </>
        )}
        <h3>읍·면·동별 (확실 ~ 최대)</h3>
        <table>
          <thead><tr><th>읍·면·동</th><th>주택</th><th>확실</th><th>최대</th></tr></thead>
          <tbody>
            {emds.map((e) => (
              <tr key={e.cd} className={e.cd === sel ? "row on" : "row"} onClick={() => setSel(e.cd)}>
                <td>{e.name}</td><td>{e.houses.toLocaleString()}</td><td>{e.sure.toLocaleString()}</td><td>{e.max.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="note">건물 단위 지도에서는 건물별 대장 기록과 우선순위 점수, 찾아가는 신청 목록을 볼 수 있습니다. 주소·지번·소유자 정보는 싣지 않습니다.</p>
      </aside>
    </div>
  );
}
