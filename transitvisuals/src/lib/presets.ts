export type Preset = {
  id: number; name: string; bg: string; water: string; waterLine: string; park: string; building: string;
  roadMinor: string; roadMid: string; artery: string; rail: string; transit: string; label: string;
  train: string; sbahn: string; tram: string; bus: string; accent: string; grid?: boolean;
};
export const PRESETS: Preset[] = [
  { id: 1, name: "Night City Transit", bg: "#0f0f12", water: "#04191d", waterLine: "#00f0ff", park: "#14140f", building: "#17171c",
    roadMinor: "#24242b", roadMid: "#5a5410", artery: "#fcee0a", rail: "#ff003c", transit: "#00f0ff", label: "#fcee0a",
    train: "#ff003c", sbahn: "#00f0ff", tram: "#fcee0a", bus: "#fff7a0", accent: "#fcee0a" },
  { id: 2, name: "Tactical Holo-HUD", bg: "#020617", water: "#031a2a", waterLine: "#00f0ff", park: "#04101c", building: "#06132a",
    roadMinor: "#0a2236", roadMid: "#0f4a63", artery: "#00b8d4", rail: "#00f0ff", transit: "#7df9ff", label: "#00f0ff",
    train: "#00f0ff", sbahn: "#7df9ff", tram: "#b8fcff", bus: "#3fd8ff", accent: "#00f0ff", grid: true },
  { id: 3, name: "Cyburbia Gold & Neon", bg: "#0d041a", water: "#1a0833", waterLine: "#a855f7", park: "#120624", building: "#170a2b",
    roadMinor: "#24123d", roadMid: "#5c1f4a", artery: "#ff2a85", rail: "#ffb703", transit: "#a855f7", label: "#ffb703",
    train: "#ffb703", sbahn: "#ffd166", tram: "#a855f7", bus: "#ff2a85", accent: "#ffb703" },
  { id: 4, name: "Bio-Matter / Chitin", bg: "#140c08", water: "#0c1a08", waterLine: "#a3e635", park: "#1a1408", building: "#1f140d",
    roadMinor: "#2a1a10", roadMid: "#5a2a0c", artery: "#ea580c", rail: "#a3e635", transit: "#d9f99d", label: "#a3e635",
    train: "#a3e635", sbahn: "#d9f99d", tram: "#ea580c", bus: "#fb923c", accent: "#a3e635" },
  { id: 5, name: "Deep Space Bridge", bg: "#1e293b", water: "#0f172a", waterLine: "#334155", park: "#1b2535", building: "#253247",
    roadMinor: "#2c3a50", roadMid: "#3e4c63", artery: "#64748b", rail: "#ef4444", transit: "#10b981", label: "#94a3b8",
    train: "#ef4444", sbahn: "#10b981", tram: "#34d399", bus: "#f87171", accent: "#10b981" },
];
export const CITIES: Record<string, [number, number]> = {
  Berlin: [13.405, 52.52], Tokyo: [139.767, 35.681], London: [-0.1276, 51.5072], Paris: [2.3522, 48.8566],
  "New York": [-73.9857, 40.7484], "Zürich": [8.5402, 47.3779], Hamburg: [9.9937, 53.5511],
};
const w = (a: number, b: number) => ["interpolate", ["exponential", 1.6], ["zoom"], 10, a, 16, b];
export function paintFor(p: Preset): Record<string, Record<string, unknown>> {
  return {
    bg: { "background-color": p.bg },
    park: { "fill-color": p.park },
    water: { "fill-color": p.water },
    waterline: { "line-color": p.waterLine },
    building: { "fill-color": p.building, "fill-outline-color": p.roadMinor },
    "road-minor": { "line-color": p.roadMinor },
    "road-mid": { "line-color": p.roadMid },
    "road-artery-glow": { "line-color": p.artery },
    "road-artery": { "line-color": p.artery },
    "rail-glow": { "line-color": p.rail },
    rail: { "line-color": p.rail },
    "transit-glow": { "line-color": p.transit },
    transit: { "line-color": p.transit },
    label: { "text-color": p.label, "text-halo-color": p.bg },
  };
}
export function buildStyle(p: Preset) {
  const P = paintFor(p);
  const L = (id: string, type: string, extra: Record<string, unknown>, paint: Record<string, unknown> = {}) => ({
    id, type, source: "omt", ...extra, paint: { ...P[id], ...paint } });
  const cls = (...c: string[]) => ["in", ["get", "class"], ["literal", c]];
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: { omt: { type: "vector", url: "https://tiles.openfreemap.org/planet" } },
    layers: [
      { id: "bg", type: "background", paint: P["bg"] },
      L("park", "fill", { "source-layer": "park" }),
      L("water", "fill", { "source-layer": "water" }),
      L("waterline", "line", { "source-layer": "water" }, { "line-width": 0.8, "line-opacity": 0.35 }),
      L("building", "fill", { "source-layer": "building", minzoom: 13 }, { "fill-opacity": 0.8 }),
      L("road-minor", "line", { "source-layer": "transportation", filter: cls("minor", "service") }, { "line-width": w(0.3, 2) }),
      L("road-mid", "line", { "source-layer": "transportation", filter: cls("secondary", "tertiary") }, { "line-width": w(0.6, 3) }),
      L("road-artery-glow", "line", { "source-layer": "transportation", filter: cls("motorway", "trunk", "primary") }, { "line-width": w(3, 14), "line-blur": w(3, 10), "line-opacity": 0.25 }),
      L("road-artery", "line", { "source-layer": "transportation", filter: cls("motorway", "trunk", "primary") }, { "line-width": w(0.8, 3.5), "line-opacity": 0.85 }),
      L("rail-glow", "line", { "source-layer": "transportation", filter: cls("rail") }, { "line-width": w(3, 14), "line-blur": w(3, 10), "line-opacity": 0.35 }),
      L("rail", "line", { "source-layer": "transportation", filter: cls("rail") }, { "line-width": w(0.8, 2.5) }),
      L("transit-glow", "line", { "source-layer": "transportation", filter: cls("transit") }, { "line-width": w(3, 12), "line-blur": w(3, 8), "line-opacity": 0.35 }),
      L("transit", "line", { "source-layer": "transportation", filter: cls("transit") }, { "line-width": w(0.8, 2.2), "line-dasharray": [3, 1] }),
      { id: "label", type: "symbol", source: "omt", "source-layer": "place", filter: cls("city", "town", "suburb"),
        layout: { "text-field": ["upcase", ["get", "name"]], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-letter-spacing": 0.3 },
        paint: { ...P["label"], "text-halo-width": 1.5, "text-opacity": 0.7 } },
    ],
  };
}
