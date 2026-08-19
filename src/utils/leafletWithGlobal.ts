import L from "leaflet";

/** leaflet-draw reads global `L`. Vite production does not set window.L by itself. */
if (typeof window !== "undefined") {
  (window as any).L = L;
}

export default L;
