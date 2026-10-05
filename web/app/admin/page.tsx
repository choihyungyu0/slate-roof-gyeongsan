import type { Metadata } from "next";

import AdminGate from "./AdminGate";

export const metadata: Metadata = { title: "온지붕 · 행정 담당자 화면", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminGate />;
}
