import axios from "axios";
import { getFastApiToken } from "./auth";

const EVENTS_BASE_URL =
  import.meta.env.VITE_DEV_EVENTS_API_URL ||
  import.meta.env.VITE_FASTAPI_AUTH_BASE_URL ||
  "https://events-cropeye.up.railway.app";

function formatPlotIdForEventsApi(plotId: string | number): string {
  return String(plotId).trim().replace(/ /g, "+");
}

function encodePlotIdForEventsUrl(plotId: string | number): string {
  return encodeURIComponent(formatPlotIdForEventsApi(plotId));
}

const eventsClient = axios.create({
  baseURL: EVENTS_BASE_URL,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

eventsClient.interceptors.request.use((config) => {
  const token = getFastApiToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * Fetch plot polygon from Events `/analyze` and return Leaflet coords `[lat, lng][]`.
 */
export async function fetchPlotBoundaryCoordinates(
  plotId: string | number,
): Promise<[number, number][]> {
  const tzOffsetMs = new Date().getTimezoneOffset() * 60000;
  const today = new Date(Date.now() - tzOffsetMs).toISOString().slice(0, 10);

  const response = await eventsClient.post(
    `/analyze?plot_name=${encodePlotIdForEventsUrl(plotId)}&date=${today}`,
  );

  const ring = response.data?.features?.[0]?.geometry?.coordinates?.[0];
  if (!Array.isArray(ring) || ring.length === 0) {
    return [];
  }

  return ring.map(
    ([lng, lat]: [number, number]) => [lat, lng] as [number, number],
  );
}
