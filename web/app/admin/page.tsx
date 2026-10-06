import type { Metadata } from "next";

import MapView from "../MapView";

export const metadata: Metadata = { title: "온지붕 · 건물 단위 지도" };

export default function Page() {
  return <MapView />;
}
