import path from "node:path";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import type { ProxyOptions } from "vite";
import { entries } from "../../../.github/scripts/changelog.cjs";

const appVersion = entries(readFileSync(new URL("../../../CHANGELOG.md", import.meta.url), "utf8"))[0].tag;

const target = process.env.SOCIOTECHNIC_API_URL ?? "http://127.0.0.1:4748";
const proxy: ProxyOptions = {
  target,
  changeOrigin: true,
  configure(server) {
    server.on("proxyReq", (request, incoming) => {
      if (["http://localhost:5173", "http://127.0.0.1:5173"].includes(incoming.headers.origin ?? "")) {
        request.setHeader("origin", new URL(target).origin);
      }
    });
  },
};

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy: { "/api": proxy, "/events": proxy, "/legacy": proxy } },
});
