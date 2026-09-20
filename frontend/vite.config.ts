import { networkInterfaces } from "node:os";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

// The API keeps its frozen SPEC §8 paths (no /api prefix), and several of them collide
// with SPA routes (/hotspots/:id). So the browser calls /api/* and the dev/preview
// server proxies it to FastAPI with the prefix stripped — no CORS needed. The proxy
// runs on this machine, so a phone on the same Wi-Fi reaches the API through it too.
// Virtual adapters (WSL, VirtualBox, VMware, Hyper-V) also hand out IPv4 addresses, and
// a phone can't reach those. Real Wi-Fi / Ethernet first so the printed URL is the one
// to type.
const VIRTUAL = /virtualbox|vethernet|vmware|hyper-?v|wsl|docker|loopback|bluetooth/i;
const PHYSICAL = /wi-?fi|wlan|wireless|ethernet|^en\d|^eth\d/i;

function lanAddresses(): string[] {
  const found: { name: string; address: string }[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) found.push({ name, address: a.address });
    }
  }
  const rank = (name: string) => (VIRTUAL.test(name) ? 2 : PHYSICAL.test(name) ? 0 : 1);
  return found.sort((a, b) => rank(a.name) - rank(b.name)).map((n) => n.address);
}

/** Prints the address to open on a phone connected to the same Wi-Fi. */
function phoneUrlBanner(port: number): Plugin {
  return {
    name: "plasticwatch:phone-url",
    apply: "serve",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const urls = lanAddresses().map((ip) => `http://${ip}:${port}`);
        setTimeout(() => {
          if (urls.length === 0) {
            server.config.logger.warn("  ➜  Phone:   no LAN address found (Wi-Fi off?)");
            return;
          }
          server.config.logger.info(`\n  📱  Open on your phone (same Wi-Fi): ${urls.join("  |  ")}`);
          server.config.logger.info("      If it doesn't load, allow Node.js through the firewall.\n");
        }, 80);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_TARGET || "https://plasticwatch.onrender.com";
  const proxy = {
    "/api": {
      target,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api/, ""),
    },
  };
  return {
    plugins: [react(), tailwindcss(), phoneUrlBanner(5173)],
    // host: true binds 0.0.0.0 so real phones on the LAN can open the app.
    server: { host: true, port: 5173, proxy },
    preview: { host: true, port: 4173, proxy },
  };
});
