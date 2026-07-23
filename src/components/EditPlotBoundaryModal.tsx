import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapContainer, TileLayer, FeatureGroup, useMap, Marker } from "react-leaflet";
import { EditControl } from "react-leaflet-draw";
import { AlertCircle, Loader2, MapPin, Save, Trash2, X } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import { refreshApiEndpoints, updatePlotBoundary } from "../api";
import {
  notifyPlotBoundaryUpdated,
} from "../utils/plotBoundarySync";
import {
  boundaryToLeafletCoords,
  calculateAreaMetricsFromGeometry,
  centerFromBoundary,
  leafletLatLngToPoint,
  pointToLeafletLatLng,
  type GeoJsonPoint,
  type GeoJsonPolygon,
} from "../utils/plotGeometry";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png",
  iconUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png",
  shadowUrl:
    "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png",
});

const DEFAULT_CENTER: [number, number] = [17.5789, 75.053];

function FitBoundsOnLoad({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords.length >= 3) {
      const timer = window.setTimeout(() => {
        map.invalidateSize();
        map.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 18 });
      }, 150);
      return () => window.clearTimeout(timer);
    }
    if (coords.length === 0) {
      map.setView(DEFAULT_CENTER, 16);
    }
  }, [coords, map]);
  return null;
}

function MapResizeOnOpen({ active }: { active: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => map.invalidateSize(), 120);
    return () => window.clearTimeout(timer);
  }, [active, map]);
  return null;
}

function MapPanTo({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, map, zoom]);
  return null;
}

/** Keep React state in sync while the user drags edit handles (before leaflet-draw Save). */
function MapDrawSync({
  onBoundaryChange,
}: {
  onBoundaryChange: (geometry: GeoJsonPolygon) => void;
}) {
  const map = useMap();

  useEffect(() => {
    const syncLayers = (event: L.LeafletEvent) => {
      const layers = (event as { layers?: L.LayerGroup }).layers;
      layers?.eachLayer((layer: L.Layer) => {
        const geoJson = (layer as L.Polygon).toGeoJSON?.();
        if (geoJson?.geometry?.type === "Polygon") {
          onBoundaryChange(geoJson.geometry as GeoJsonPolygon);
        }
      });
    };

    map.on("draw:editvertex" as any, syncLayers);
    map.on("draw:editmove" as any, syncLayers);
    return () => {
      map.off("draw:editvertex" as any, syncLayers);
      map.off("draw:editmove" as any, syncLayers);
    };
  }, [map, onBoundaryChange]);

  return null;
}

function polygonFromLayer(layer: L.Polygon): GeoJsonPolygon | null {
  const geoJson = layer.toGeoJSON();
  if (geoJson.geometry?.type === "Polygon") {
    return geoJson.geometry as GeoJsonPolygon;
  }
  return null;
}

function commitPendingLayerEdits(group: L.FeatureGroup | null) {
  if (!group) return;
  group.eachLayer((layer) => {
    const editing = (layer as L.Polygon & { editing?: { enabled?: () => boolean; disable?: () => void } }).editing;
    if (editing?.enabled?.()) {
      editing.disable?.();
    }
  });
}

export interface EditPlotBoundaryModalProps {
  open: boolean;
  onClose: () => void;
  plotId: number | string;
  plotLabel?: string;
  /** Extra plot name variants (fastapi id, gat_plot, etc.) so Home Map can find the saved boundary. */
  plotKeys?: string[];
  initialBoundary?: GeoJsonPolygon | null;
  initialLocation?: GeoJsonPoint | null;
  onSaved?: (boundary: GeoJsonPolygon | null, location: GeoJsonPoint | null) => void;
}

const EditPlotBoundaryModal: React.FC<EditPlotBoundaryModalProps> = ({
  open,
  onClose,
  plotId,
  plotLabel,
  plotKeys = [],
  initialBoundary,
  initialLocation,
  onSaved,
}) => {
  const featureGroupRef = useRef<L.FeatureGroup>(null);
  const polygonLayerRef = useRef<L.Polygon | null>(null);

  const [currentBoundary, setCurrentBoundary] = useState<GeoJsonPolygon | null>(
    initialBoundary ?? null,
  );
  const [areaAcres, setAreaAcres] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [hadSavedBoundary, setHadSavedBoundary] = useState(false);
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  const [mapFocus, setMapFocus] = useState<[number, number] | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const displayBoundary = currentBoundary ?? initialBoundary ?? null;
  const leafletCoords = boundaryToLeafletCoords(displayBoundary);
  const boundsCoords = boundaryToLeafletCoords(initialBoundary);
  const savedLocationLatLng = pointToLeafletLatLng(initialLocation ?? null);
  const markerLatLng = (() => {
    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lat, lng] as [number, number];
    return savedLocationLatLng;
  })();
  const mapCenter =
    mapFocus ??
    (leafletCoords.length > 0
      ? ([
          leafletCoords.reduce((s, [lat]) => s + lat, 0) / leafletCoords.length,
          leafletCoords.reduce((s, [, lng]) => s + lng, 0) / leafletCoords.length,
        ] as [number, number])
      : savedLocationLatLng ?? DEFAULT_CENTER);

  useEffect(() => {
    if (!open) return;
    setCurrentBoundary(initialBoundary ?? null);
    setHadSavedBoundary(
      boundaryToLeafletCoords(initialBoundary ?? null).length >= 3,
    );
    setError(null);
    setMapReady(false);
    polygonLayerRef.current = null;
    const locationLatLng = pointToLeafletLatLng(initialLocation ?? null);
    setLatInput(locationLatLng ? locationLatLng[0].toFixed(6) : "");
    setLngInput(locationLatLng ? locationLatLng[1].toFixed(6) : "");
    // Only auto-pan to lat/long when there is no saved polygon to show.
    const hasBoundaryOnOpen =
      boundaryToLeafletCoords(initialBoundary ?? null).length >= 3;
    setMapFocus(hasBoundaryOnOpen ? null : locationLatLng);
    setLocationError(null);
  }, [open, initialBoundary, initialLocation, plotId]);

  useEffect(() => {
    if (!open || !mapReady) return;

    let cancelled = false;
    let attempts = 0;

    const syncPolygonToMap = () => {
      if (cancelled) return;

      const group = featureGroupRef.current;
      if (!group) {
        if (attempts < 30) {
          attempts += 1;
          window.setTimeout(syncPolygonToMap, 50);
        }
        return;
      }

      group.clearLayers();
      polygonLayerRef.current = null;

      const boundary = initialBoundary;
      const coords = boundaryToLeafletCoords(boundary);
      if (coords.length >= 3) {
        const polygon = L.polygon(coords, {
          color: "#059669",
          weight: 3,
          fillOpacity: 0.25,
          fillColor: "#10b981",
        });
        group.addLayer(polygon);
        polygonLayerRef.current = polygon;

        if (boundary) {
          const metrics = calculateAreaMetricsFromGeometry(boundary);
          setAreaAcres(metrics?.acres ?? null);
        }

        const map = (group as any)._map as L.Map | undefined;
        if (map) {
          window.setTimeout(() => {
            map.invalidateSize();
            map.fitBounds(L.latLngBounds(coords), { padding: [40, 40], maxZoom: 18 });
          }, 100);
        }
      } else {
        setAreaAcres(null);
      }
    };

    syncPolygonToMap();
    return () => {
      cancelled = true;
    };
  }, [open, mapReady, initialBoundary]);

  const applyGeometry = useCallback((geometry: GeoJsonPolygon) => {
    const metrics = calculateAreaMetricsFromGeometry(geometry);
    if (!metrics) {
      setError("Could not calculate area for this shape. Please redraw.");
      return;
    }
    setError(null);
    setCurrentBoundary(geometry);
    setAreaAcres(metrics.acres);
  }, []);

  const handleDrawCreated = (event: any) => {
    const layer = event.layer as L.Polygon;
    const geoJson = layer.toGeoJSON();

    if (geoJson.geometry.type !== "Polygon") return;

    featureGroupRef.current?.clearLayers();
    featureGroupRef.current?.addLayer(layer);
    polygonLayerRef.current = layer;
    applyGeometry(geoJson.geometry as GeoJsonPolygon);
  };

  const handleDrawEdited = (event: any) => {
    event.layers.eachLayer((layer: L.Layer) => {
      const geoJson = (layer as any).toGeoJSON();
      if (geoJson.geometry.type === "Polygon") {
        polygonLayerRef.current = layer as L.Polygon;
        applyGeometry(geoJson.geometry as GeoJsonPolygon);
      }
    });
  };

  const handleDrawDeleted = () => {
    featureGroupRef.current?.clearLayers();
    polygonLayerRef.current = null;
    setCurrentBoundary(null);
    setAreaAcres(null);
    setError(null);
  };

  const resolveBoundaryFromMap = (): GeoJsonPolygon | null => {
    commitPendingLayerEdits(featureGroupRef.current);

    const layer = polygonLayerRef.current;
    if (layer) {
      const fromLayer = polygonFromLayer(layer);
      if (fromLayer) return fromLayer;
    }

    if (featureGroupRef.current) {
      let fromGroup: GeoJsonPolygon | null = null;
      featureGroupRef.current.eachLayer((mapLayer) => {
        const fromLayer = polygonFromLayer(mapLayer as L.Polygon);
        if (fromLayer) fromGroup = fromLayer;
      });
      if (fromGroup) return fromGroup;
    }

    return currentBoundary;
  };

  const resolveLocationForSave = (
    boundary: GeoJsonPolygon | null,
  ): GeoJsonPoint | null => {
    if (!boundary) return null;

    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return leafletLatLngToPoint(lat, lng);
    }

    return centerFromBoundary(boundary);
  };

  const handleLatLngSearch = () => {
    const lat = Number(latInput);
    const lng = Number(lngInput);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setLocationError("Enter valid latitude and longitude.");
      return;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setLocationError("Latitude must be -90 to 90 and longitude -180 to 180.");
      return;
    }

    setLocationError(null);
    setMapFocus([lat, lng]);
  };

  const syncPlotBoundary = async (
    boundary: GeoJsonPolygon | null,
    location: GeoJsonPoint | null,
  ) => {
    await updatePlotBoundary(plotId, {
      boundary,
      location,
    });

    try {
      await refreshApiEndpoints({
        plotId,
        plotName: plotLabel || String(plotId),
      });
    } catch {
      // PATCH succeeded; refresh is best-effort
    }
  };

  const formatBoundaryError = (e: any) => {
    if (e.response?.status === 403) {
      return "You do not have permission to update this plot boundary. Please contact your field officer or support.";
    }
    return (
      e.response?.data?.detail ||
      e.response?.data?.message ||
      (typeof e.response?.data === "object"
        ? JSON.stringify(e.response.data)
        : e.message) ||
      "Failed to save plot boundary."
    );
  };

  const handleSave = async () => {
    const boundaryToSave = resolveBoundaryFromMap();

    if (!boundaryToSave?.coordinates?.[0]?.length) {
      setError("Please draw or edit the plot boundary on the map first.");
      return;
    }

    const ring = boundaryToSave.coordinates[0];
    const uniquePoints =
      ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1]
        ? ring.length - 1
        : ring.length;

    if (uniquePoints < 3) {
      setError("A plot boundary needs at least 3 corner points.");
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const locationToSave = resolveLocationForSave(boundaryToSave);
      await syncPlotBoundary(boundaryToSave, locationToSave);

      notifyPlotBoundaryUpdated({
        plotKey: plotLabel || String(plotId),
        plotId: String(plotId),
        boundary: boundaryToSave,
        extraPlotKeys: plotKeys,
      });

      onSaved?.(boundaryToSave, locationToSave);
      onClose();
    } catch (e: any) {
      setError(formatBoundaryError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!hadSavedBoundary && !currentBoundary) return;

    const confirmed = window.confirm(
      "Remove this plot boundary from the server? You can draw a new boundary later.",
    );
    if (!confirmed) return;

    try {
      setSaving(true);
      setError(null);

      await syncPlotBoundary(null, null);

      notifyPlotBoundaryUpdated({
        plotKey: plotLabel || String(plotId),
        plotId: String(plotId),
        boundary: null,
        extraPlotKeys: plotKeys,
      });

      onSaved?.(null, null);
      onClose();
    } catch (e: any) {
      setError(formatBoundaryError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const hasExistingBoundary =
    boundaryToLeafletCoords(currentBoundary ?? initialBoundary).length >= 3;

  const modal = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/55 p-3 sm:p-4">
      <div className="flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 bg-gradient-to-r from-green-50 to-emerald-50 px-4 py-4 sm:px-5">
          <div>
            <h3 className="text-lg font-bold text-gray-800">Edit Plot Boundary</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              {plotLabel ? `Plot ${plotLabel}` : "Draw your farm boundary on the map"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 transition-colors hover:bg-white/80"
            aria-label="Close"
          >
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {hasExistingBoundary ? (
              <p>
                <strong>How to edit:</strong> Click the <strong>square edit tool</strong> (top-right),
                drag corners to resize, then click <strong>Save Boundary</strong> below (you do not need
                the map toolbar checkmark). Update lat/long if needed.
              </p>
            ) : (
              <ol className="list-decimal space-y-1 pl-4">
                <li>
                  Click the <strong>pentagon icon</strong> on the top-right of the map.
                </li>
                <li>Click each corner of your plot on the satellite image.</li>
                <li>Click the first point again (or double-click) to close the shape.</li>
                <li>
                  Check the calculated area, then click <strong>Save Boundary</strong>.
                </li>
              </ol>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Plot center (lat / long)
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Same as Add Farm: enter coordinates to move the map. Saved as plot location
              (longitude, latitude).
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                placeholder="Latitude"
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <input
                type="text"
                placeholder="Longitude"
                value={lngInput}
                onChange={(e) => setLngInput(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={handleLatLngSearch}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Go to location
              </button>
            </div>
            {locationError && (
              <p className="mt-2 text-xs text-red-600">{locationError}</p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="plot-boundary-editor-map overflow-hidden rounded-xl border border-gray-200">
            <MapContainer
              key={`plot-boundary-${plotId}-${open ? "open" : "closed"}`}
              center={mapCenter}
              zoom={16}
              style={{ height: "360px", width: "100%" }}
              whenReady={() => {
                window.setTimeout(() => setMapReady(true), 80);
              }}
            >
              <TileLayer
                url="http://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
                attribution="© Google"
                maxZoom={21}
              />
              <FitBoundsOnLoad coords={boundsCoords} />
              <MapResizeOnOpen active={open} />
              {mapFocus && <MapPanTo center={mapFocus} zoom={17} />}

              {markerLatLng && <Marker position={markerLatLng} />}

              <MapDrawSync onBoundaryChange={applyGeometry} />

              <FeatureGroup ref={featureGroupRef}>
                <EditControl
                  position="topright"
                  onCreated={handleDrawCreated}
                  onEdited={handleDrawEdited}
                  onDeleted={handleDrawDeleted}
                  draw={{
                    polygon: !hasExistingBoundary,
                    rectangle: false,
                    polyline: false,
                    circle: false,
                    marker: false,
                    circlemarker: false,
                  }}
                  edit={{
                    edit: hasExistingBoundary ? {} : false,
                    remove: hasExistingBoundary,
                  }}
                />
              </FeatureGroup>
            </MapContainer>
          </div>

          {!hasExistingBoundary && areaAcres == null && (
            <p className="text-xs text-gray-500">
              No shape on the map yet. Use the pentagon tool (top-right) to draw your plot.
            </p>
          )}

          {areaAcres != null && (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <MapPin size={14} className="text-green-600" />
              Calculated area: <strong>{areaAcres.toFixed(2)} acres</strong>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-gray-100 bg-gray-50 px-4 py-4 sm:px-5">
          {(hadSavedBoundary || currentBoundary) && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              Delete Boundary
            </button>
          )}

          <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !resolveBoundaryFromMap()}
            className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            Save Boundary
          </button>
          </div>
        </div>
      </div>

      <style>{`
        .plot-boundary-editor-map .leaflet-container {
          width: 100% !important;
          height: 360px !important;
          min-height: 0 !important;
          max-width: 100% !important;
        }
        .plot-boundary-editor-map .leaflet-draw-toolbar a {
          background-color: #fff;
        }
      `}</style>
    </div>
  );

  return createPortal(modal, document.body);
};

export default EditPlotBoundaryModal;
