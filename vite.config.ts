// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** leaflet-draw uses global `L` and has no ESM default export — both break edit tools in production. */
function leafletDrawViteFix() {
  return {
    name: "leaflet-draw-vite-fix",
    transform(code: string, id: string) {
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.includes("/leaflet-draw/dist/leaflet.draw.js")) return null;
      if (code.includes("__cropeyeLeafletDrawFix")) return null;
      return {
        code:
          'import L from "leaflet";\n' +
          "if (typeof window !== \"undefined\") { window.L = L; }\n" +
          "const __cropeyeLeafletDrawFix = true;\n" +
          `${code}\nexport default L;\n`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), leafletDrawViteFix()],
  assetsInclude: ["**/*.geojson"],

  // leaflet-draw has no ESM default export; prebundle so production edit tools load.
  optimizeDeps: {
    include: ["leaflet", "leaflet-draw", "react-leaflet-draw"],
  },

  // Ensure single React instance (fixes "isElement" undefined errors with chunking)
  resolve: {
    dedupe: ["react", "react-dom"],
  },

  build: {
    sourcemap: false,
    minify: "esbuild",       // esbuild: safe for React; terser mangling was breaking React.isElement
    outDir: "dist",
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash].[ext]",
        sanitizeFileName(name) {
          const lastDot = name.lastIndexOf(".");
          if (lastDot !== -1) {
            const base = name.slice(0, lastDot).replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
            const ext = name.slice(lastDot + 1).toLowerCase();
            return `${base}.${ext}`;
          }
          return name.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
        },
        // Split heavy libraries so Home does not download map/charts/excel/pdf up front.
        // React stays in the main graph (dedupe above) to avoid "isElement" chunk bugs.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("leaflet")) return "leaflet";
          if (id.includes("recharts") || id.includes("/d3-") || id.includes("\\d3-")) {
            return "charts";
          }
          if (
            id.includes("xlsx") ||
            id.includes("papaparse") ||
            id.includes("file-saver")
          ) {
            return "excel";
          }
          if (id.includes("jspdf") || id.includes("html2canvas")) return "pdf";
          if (
            id.includes("@turf") ||
            id.includes("shapefile") ||
            id.includes("shpjs")
          ) {
            return "geo";
          }
          if (id.includes("framer-motion")) return "motion";
          if (id.includes("lodash")) return "lodash";
        },
      },
      external: [],
    },
    
    // Chunk size warning threshold
    chunkSizeWarningLimit: 600,
    
    // Report compressed size (gzipped)
    reportCompressedSize: true,
    
    // Don't emit asset files with source info
    assetsInlineLimit: 4096,
  },
  
  // Hide source file references in production
  define: {
    // Only set in production build, not in dev mode (breaks React Fast Refresh)
    ...(process.env.NODE_ENV === 'production' ? {
      __DEV__: false,
      'process.env.NODE_ENV': '"production"',
    } : {}),
  },
  
  // Disable dev source maps completely
  server: {
    sourcemapIgnoreList: () => {
      return true; // Ignore all source maps in dev too
    },
    // Add headers to prevent caching in development
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
    // Proxy API requests to avoid CORS issues in development
    proxy: {
      '/api/sef': {
        target: 'https://sef-cropeye.up.railway.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/sef/, ''),
      },
      '/api/analysis-timeline': {
        target: 'https://cropeye-database-production.up.railway.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/analysis-timeline/, ''),
      },
      '/api/dev-plot': {
        target: 'https://admin-cropeye.up.railway.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/dev-plot/, ''),
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, res) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Proxying request:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Proxy response:', proxyRes.statusCode, req.url);
          });
        },
      },
    },
  },
});
