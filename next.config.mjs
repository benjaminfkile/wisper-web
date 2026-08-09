/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The browser calls same-origin `/wisper/*`; Next proxies to the Wisper API so
  // there is no CORS. ONE canonical env drives BOTH this server-side rewrite AND
  // the client's direct WebSocket origin (shellSocketUrl): NEXT_PUBLIC_WISPER_API_ORIGIN.
  // It must be NEXT_PUBLIC_ because the browser (which builds the WS URL) can only
  // read public vars; the server reads it here too, so there is no duplicate to
  // drift. WISPER_API_URL stays honored as a fallback for older setups.
  async rewrites() {
    const target =
      process.env.NEXT_PUBLIC_WISPER_API_ORIGIN ||
      process.env.WISPER_API_URL ||
      "http://localhost:8080";
    return [{ source: "/wisper/:path*", destination: `${target}/:path*` }];
  },
};

export default nextConfig;
