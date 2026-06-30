// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  assetsInclude: ["**/*.geojson"],

  // Ensure single React instance (fixes "isElement" undefined errors with chunking)
  resolve: {
    dedupe: ["react", "react-dom"],
  },

  build: {
    sourcemap: false,
    minify: "esbuild",       // esbuild: safe for React; terser mangling was breaking React.isElement
    outDir: "dist",
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
