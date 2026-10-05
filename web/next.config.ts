import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 건물 단위 자료(private-data)를 /api/buildings 함수에 함께 묶는다
  outputFileTracingIncludes: { "/api/buildings": ["./private-data/**"] },
};

export default nextConfig;
