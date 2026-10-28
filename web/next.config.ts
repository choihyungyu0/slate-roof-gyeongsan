import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 질의 도우미 API가 서버에서 읽는 배포 자료를 함수에 함께 싣는다
  outputFileTracingIncludes: {
    "/api/ask": ["./public/data/ask_index.json", "./public/data/emd.geojson", "./public/data/rules.json", "./public/data/legal_basis.json",
      "./public/data/summary.json", "./public/data/review.json"],
  },
};

export default nextConfig;
