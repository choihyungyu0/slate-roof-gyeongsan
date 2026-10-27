import type { Metadata } from "next";

import AdminView from "./AdminView";

export const metadata: Metadata = { title: "온지붕 · 행정 화면", robots: { index: false, follow: false } };

export default function Page() {
  return <AdminView />;
}
