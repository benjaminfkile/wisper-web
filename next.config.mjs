/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The browser calls same-origin `/wisper/*`; Next proxies to the Wisper API so
  // there is no CORS. NEXT_PUBLIC_WISPER_API_ORIGIN drives both this server-side
  // rewrite and the client's direct WebSocket origin (shellSocketUrl); it must be
  // NEXT_PUBLIC_ so the browser (which builds the WS URL) can read it too.
  async rewrites() {
    const target = process.env.NEXT_PUBLIC_WISPER_API_ORIGIN || "http://localhost:8080";
    return [{ source: "/wisper/:path*", destination: `${target}/:path*` }];
  },
};

export default nextConfig;
