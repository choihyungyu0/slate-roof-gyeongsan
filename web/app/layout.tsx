import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const NAME = "온지붕";
const TAGLINE = "건축물대장 AI 기반 석면 슬레이트 주택 발굴";

export const metadata: Metadata = {
  metadataBase: new URL("https://slate-roof-gyeongsan.vercel.app"),
  title: NAME,
  description: TAGLINE,
  applicationName: NAME,
  openGraph: { title: NAME, description: TAGLINE, siteName: NAME, type: "website", locale: "ko_KR", url: "/" },
  twitter: { card: "summary", title: NAME, description: TAGLINE },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
