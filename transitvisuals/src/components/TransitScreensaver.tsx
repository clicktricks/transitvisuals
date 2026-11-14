import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { PRESETS, CITIES, buildStyle, paintFor, type Preset } from "@/lib/presets";

type Kind = "train" | "sbahn" | "tram" | "bus";
type Line = { c: [number, number][]; cum: number[]; len: number; kind: Kind };
type Info = { tripId: string; line: string; from: string; to: string; arr: number; delay: number; rt: boolean; kind: Kind };
type Veh = { l: Line; d: number; v: number; dir: 1 | -1; ph: number; live?: [number, number]; info?: Info };
const KIND_NAME: Record<string, string> = { train: "Zug", sbahn: "S-/U-Bahn", tram: "Tram", bus: "Bus" };
type Mode = "breath" | "pan" | "still";
// Karte per Maus/Touch bedienbar, sobald die Kamera steht (Stop oder Pause)
const manual = (st: { mode: Mode; paused: boolean }) => st.mode === "still" || st.paused;
const setInteract = (m: any, on: boolean) => { for (const h of [m.dragPan, m.scrollZoom, m.doubleClickZoom, m.touchZoomRotate, m.dragRotate, m.keyboard]) { if (h) on ? h.enable() : h.disable(); } };

function mkLine(c: [number, number][], kind: Kind, min = 0.002): Line | null {
  if (c.length < 2) return null;
  const cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1]! + Math.hypot(c[i]![0] - c[i - 1]![0], c[i]![1] - c[i - 1]![1]));
  const len = cum[cum.length - 1]!;
  return len > min ? { c, cum, len, kind } : null;
}
function at(l: Line, d: number): [number, number] {
  d = Math.max(0, Math.min(l.len, d));
  let i = 1; while (i < l.cum.length - 1 && l.cum[i]! < d) i++;
  const a = l.c[i - 1]!, b = l.c[i]!, c0 = l.cum[i - 1]!;
  const s = l.cum[i]! - c0 || 1, t = (d - c0) / s;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
const SPEED: Record<Kind, number> = { train: 0.0022, sbahn: 0.0016, tram: 0.0008, bus: 0.0006 };

// Live-Daten: Transitous (MOTIS) – Fahrplan + GTFS-Realtime-Verspätungen, kein API-Key nötig
const LIVE_URL = "https://api.transitous.org/api/v5/map/trips";
const LIVE_REFRESH_MS = 45000;
const MODE_KIND: Record<string, Kind> = {
  RAIL: "train", HIGHSPEED_RAIL: "train", LONG_DISTANCE: "train", NIGHT_RAIL: "train", REGIONAL_RAIL: "train",
  SUBURBAN: "sbahn", SUBWAY: "sbahn", TRAM: "tram", BUS: "bus", COACH: "bus",
};
// Streckennetz-Layer (aus den Live-Routen) – Farben je Fahrzeugart aus dem Preset
// Leuchtebenen der Karte (Original-Look) – nur per ?mapglow=false abschaltbar
const GLOW_IDS = ["road-artery-glow", "rail-glow", "transit-glow"];
const netColor = (p: Preset): any => ["match", ["get", "kind"], "train", p.train, "sbahn", p.sbahn, "tram", p.tram, p.bus];
const netW = (a: number, b: number): any => ["interpolate", ["exponential", 1.6], ["zoom"], 10, a, 16, b];
// Google-Polyline (Precision 5) -> [lon, lat][]
function decodePoly(str: string): [number, number][] {
  const out: [number, number][] = []; let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (let axis = 0; axis < 2; axis++) {
      let r = 0, sh = 0, b: number;
      do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push([lng / 1e5, lat / 1e5]);
  }
  return out;
}

export default function TransitScreensaver() {
  const mapEl = useRef<HTMLDivElement>(null), cvs = useRef<HTMLCanvasElement>(null);
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [preset, setPreset] = useState<Preset>(PRESETS[Math.min(4, Math.max(0, (+params.get("preset")! || 1) - 1))]!);
  const [mode, setMode] = useState<Mode>(params.get("zoom") === "false" ? "pan" : "breath");
  const [speed, setSpeed] = useState(+(params.get("speed") || 1) || 1);
  const [paused, setPaused] = useState(false);
  const [glowMode, setGlowMode] = useState(() => { const g = params.get("glow"); return g === "full" ? 2 : g === "soft" || g === "true" ? 1 : 0; }); // 0 aus (Standard), 1 soft, 2 voll
  const [live, setLive] = useState(params.get("live") !== "false"), [liveSt, setLiveSt] = useState<"load" | "ok" | "err">("load");
  const [ui, setUi] = useState(true), [uiOn, setUiOn] = useState(params.get("ui") !== "false");
  const [query, setQuery] = useState(""), [city, setCity] = useState(params.get("city") || "Berlin"), [err, setErr] = useState("");
  const S = useRef({ mode, speed, paused, preset, live, glow: glowMode, zoomOff: 0, center: CITIES["Berlin"]! as [number, number], t: 0, refetch: null as null | (() => void) });
  S.current.mode = mode; S.current.speed = speed; S.current.paused = paused; S.current.preset = preset; S.current.live = live; S.current.glow = glowMode;
  const mapRef = useRef<any>(null);
  const [sel, setSel] = useState<Info | null>(null);
  const selRef = useRef<Veh | null>(null), cardRef = useRef<HTMLDivElement>(null);

  async function focus(name: string) {
    setErr("");
    const k = Object.keys(CITIES).find((c) => c.toLowerCase() === name.toLowerCase());
    if (k) { S.current.center = CITIES[k]!; setCity(k); S.current.refetch?.(); if (manual(S.current)) mapRef.current?.flyTo({ center: S.current.center, zoom: 12.5 }); return; }
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(name)}`);
      const j = await r.json();
      if (!j[0]) return setErr("Nicht gefunden");
      S.current.center = [+j[0].lon, +j[0].lat]; setCity(j[0].display_name.split(",")[0]); S.current.refetch?.(); if (manual(S.current)) mapRef.current?.flyTo({ center: S.current.center, zoom: 12.5 });
    } catch { setErr("Suche fehlgeschlagen"); }
  }

  useEffect(() => { focus(city); }, []); // eslint-disable-line

  useEffect(() => {
    // Performance-Stellschrauben per URL: ?fps=30&dpr=1.5&max=900&net=true
    const MAPGLOW = params.get("mapglow") !== "false";
    const FPS = Math.max(10, +(params.get("fps") || 30)), DPRMAX = +(params.get("dpr") || 1.5), MAXV = +(params.get("max") || 900), NET = params.get("net") === "true";
    const sprites = new Map<string, HTMLCanvasElement>();
    const sprite = (col: string) => {
      let c = sprites.get(col);
      if (!c) {
        c = document.createElement("canvas"); c.width = c.height = 64;
        const x = c.getContext("2d")!; x.fillStyle = col; x.fillRect(0, 0, 64, 64);
        x.globalCompositeOperation = "destination-in";
        const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
        gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.3, "rgba(0,0,0,0.45)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        x.fillStyle = gr; x.fillRect(0, 0, 64, 64); sprites.set(col, c);
      }
      return c;
    };
    const minDt = 1000 / FPS, pr = Math.min(window.devicePixelRatio || 1, DPRMAX);
    let onWheel: ((e: WheelEvent) => void) | null = null;
    let mt: any, downX = 0, downY = 0, onDown: ((e: PointerEvent) => void) | null = null;
    let raf = 0, iv: any, iv2: any, map: any, dead = false, lastFollow = 0, onClick: ((e: MouseEvent) => void) | null = null;
    const hx = new Float32Array(MAXV + 2), hy = new Float32Array(MAXV + 2), hv: Veh[] = []; let hn = 0; // Trefferliste für Klicks
    let lines: Line[] = [], vehs: Veh[] = [];
    let netData: any = { type: "FeatureCollection", features: [] };
    let liveVehs: Veh[] = [], liveOk = false, reqId = 0, pausedMs = 0;
    (async () => {
      const mod: any = await import("maplibre-gl"); const ml = mod.default ?? mod; ml.setWorkerUrl?.(workerUrl);
      if (dead) return;
      map = new ml.Map({ container: mapEl.current!, style: buildStyle(S.current.preset) as any, pixelRatio: pr, center: S.current.center, zoom: 12.5,
        interactive: true, attributionControl: false, fadeDuration: 0 });
      setInteract(map, manual(S.current));
      mapRef.current = map;
      const collect = () => {
        if (!map.isStyleLoaded()) return;
        const fs = map.querySourceFeatures("omt", { sourceLayer: "transportation" });
        const out: Line[] = [];
        for (const f of fs) {
          const c = f.properties.class; let kind: Kind | null = null;
          if (c === "rail") kind = f.properties.subclass === "rail" || !f.properties.subclass ? (Math.random() < 0.5 ? "train" : "sbahn") : "sbahn";
          else if (c === "transit") kind = f.properties.subclass === "tram" ? "tram" : "sbahn";
          else if (c === "primary" || c === "secondary" || c === "trunk") kind = "bus";
          if (!kind) continue;
          const g = f.geometry as any;
          const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
          for (const p of parts) { const l = mkLine(p, kind); if (l) out.push(l); }
          if (out.length > 1500) break;
        }
        if (out.length) lines = out;
        const target = Math.min(700, lines.length * 2);
        while (vehs.length < target) vehs.push(spawn());
        if (vehs.length > target) vehs.length = target;
      };
      const spawn = (): Veh => {
        const l = lines[(Math.random() * lines.length) | 0]!;
        return { l, d: Math.random() * l.len, v: SPEED[l.kind] * (0.6 + Math.random() * 0.8), dir: Math.random() < 0.5 ? 1 : -1, ph: Math.random() * 6.28 };
      };
      const applyNet = () => { (map.getSource("live-net") as any)?.setData(netData); };
      const fetchLive = async () => {
        const st = S.current, id = ++reqId;
        if (!st.live) { liveVehs = []; liveOk = false; netData = { type: "FeatureCollection", features: [] }; applyNet(); return; }
        // Bounding Box: so groß wie die Ansicht bei maximalem Herauszoomen (z≈11) + Rand für Pan/Rotation
        const [lon, lat] = st.center, dpx = 360 / (512 * 2 ** Math.min(11, map.getZoom()));
        const hw = dpx * innerWidth * 0.5 * 1.15 + 0.03, hh = dpx * Math.cos((lat * Math.PI) / 180) * innerHeight * 0.5 * 1.15 + 0.02;
        const now = Date.now();
        const q = new URLSearchParams({
          zoom: "14", min: `${lat - hh},${lon + hw}`, max: `${lat + hh},${lon - hw}`, precision: "5",
          startTime: new Date(now - 60000).toISOString(), endTime: new Date(now + 240000).toISOString(),
        });
        try {
          const r = await fetch(`${LIVE_URL}?${q}`);
          if (!r.ok) throw new Error(String(r.status));
          const data: any[] = await r.json();
          if (dead || id !== reqId) return;
          const out: Veh[] = [], seen = new Set<string>(), feats: any[] = [];
          for (const s of data) {
            const kind = MODE_KIND[s.mode]; if (!kind) continue;
            const dep = Date.parse(s.departure), arr = Date.parse(s.arrival);
            if (!(arr > dep)) continue;
            const l = mkLine(decodePoly(s.polyline), kind, 0); if (!l) continue;
            if (!seen.has(s.polyline)) { seen.add(s.polyline); feats.push({ type: "Feature", properties: { kind }, geometry: { type: "LineString", coordinates: l.c } }); }
            const t0 = s.trips?.[0];
            const info: Info = { tripId: t0?.tripId || "", line: t0?.displayName || t0?.routeShortName || "", from: s.from?.name || "", to: s.to?.name || "", arr, delay: Math.round((arr - Date.parse(s.scheduledArrival)) / 60000), rt: !!s.realTime, kind };
            out.push({ l, d: 0, v: l.len / ((arr - dep) / 1000), dir: 1, ph: Math.random() * 6.28, live: [dep, arr], info });
          }
          const cur = selRef.current;
          if (cur?.info) { const m = out.find((o) => o.info!.tripId === cur.info!.tripId && o.live![0] === cur.live![0]); if (m) selRef.current = m; }
          liveVehs = out; netData = { type: "FeatureCollection", features: feats }; applyNet(); liveOk = true; setLiveSt("ok"); setErr("");
        } catch { if (!dead && id === reqId) { liveOk = false; setLiveSt("err"); } }
      };
      S.current.refetch = fetchLive; fetchLive(); iv2 = setInterval(fetchLive, LIVE_REFRESH_MS);
      map.on("moveend", () => { // im freien Modus: neuer Mittelpunkt -> Live-Daten für den neuen Ausschnitt laden
        if (!manual(S.current)) return;
        const c = map.getCenter(); S.current.center = [c.lng, c.lat];
        clearTimeout(mt); mt = setTimeout(fetchLive, 600);
      });
      onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
      addEventListener("pointerdown", onDown);
      onWheel = (e: WheelEvent) => { // Mausrad / Strg+Rad / Pinch zoomt auch während der Kamera-Automatik
        if (manual(S.current) || (e.target as HTMLElement).closest("input")) return; // sonst übernimmt die Karte selbst
        e.preventDefault();
        S.current.zoomOff = Math.max(-1.5, Math.min(4, S.current.zoomOff - e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
        clearTimeout(mt); mt = setTimeout(fetchLive, 700);
      };
      addEventListener("wheel", onWheel, { passive: false });
      onClick = (e: MouseEvent) => {
        if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // war ein Ziehen, kein Klick
        if ((e.target as HTMLElement).closest("button,input,form")) return;
        let best = -1, bd = 22 * 22;
        for (let i = 0; i < hn; i++) { const dx = hx[i]! - e.clientX, dy = hy[i]! - e.clientY, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
        const v = best >= 0 ? hv[best]! : null;
        if (v?.info) { selRef.current = v; setSel(v.info); } else { selRef.current = null; setSel(null); }
      };
      addEventListener("click", onClick);
      map.on("load", () => {
        if (!MAPGLOW) for (const id of GLOW_IDS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
        if (NET) {
        const pc = netColor(S.current.preset), layout = { "line-cap": "round", "line-join": "round" };
        map.addSource("live-net", { type: "geojson", data: netData });
        map.addLayer({ id: "live-net-glow", type: "line", source: "live-net", layout, paint: { "line-color": pc, "line-width": netW(2, 8), "line-blur": netW(2, 6), "line-opacity": 0.22 } }, "label");
        map.addLayer({ id: "live-net", type: "line", source: "live-net", layout, paint: { "line-color": pc, "line-width": netW(0.5, 1.6), "line-opacity": ["match", ["get", "kind"], "bus", 0.3, 0.75] } }, "label");
        }
        collect(); setTimeout(collect, 1500);
      });
      iv = setInterval(collect, 3000);
      let last = performance.now();
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (now - last < minDt - 2) return; // FPS-Limit
        const dt = Math.min(0.1, (now - last) / 1000); last = now;
        const st = S.current;
        if (!st.paused) st.t += dt * st.speed; else pausedMs += dt * 1000;
        const clock = Date.now() - pausedMs, useLive = st.live && liveOk, list = useLive ? liveVehs : vehs, gm = st.glow;
        let vis = 0, selSeen = false, selX = 0, selY = 0;
        hn = 0;
        const cur = selRef.current; // Auswahl auf den nächsten Abschnitt derselben Fahrt weiterschalten
        if (cur?.live && cur.info && clock > cur.live[1] && clock - lastFollow > 500) {
          lastFollow = clock; let best: Veh | null = null;
          for (const o of liveVehs) if (o.info && o.info.tripId === cur.info.tripId && o.live![0] > cur.live[0] && (!best || o.live![0] < best.live![0])) best = o;
          if (best) { selRef.current = best; setSel(best.info!); }
        }
        const t = st.t;
        if (manual(st)) { /* Kamera steht: Nutzer steuert die Karte */ } else {
          const zoom = Math.max(10, Math.min(18, (st.mode === "breath" ? 13 - 1.75 * Math.cos((2 * Math.PI * t) / 52) : 13) + st.zoomOff)); // + manueller Zoom (Mausrad)
          const dr = st.mode === "pan" ? 0.02 : 0.004;
          map.jumpTo({ center: [st.center[0] + dr * Math.sin(t / 37), st.center[1] + dr * 0.6 * Math.sin(t / 29)], zoom, bearing: 4 * Math.sin(t / 71) });
        }
        const c = cvs.current!; const dpr = pr;
        const cw = Math.round(innerWidth * dpr), ch = Math.round(innerHeight * dpr);
        if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; } // nur bei echter Größenänderung neu anlegen
        const g = c.getContext("2d")!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, innerWidth, innerHeight);
        g.globalCompositeOperation = "lighter";
        const z = map.getZoom(), sz = Math.max(1.2, (z - 10) * 0.9);
        for (let i = 0; i < list.length; i++) {
          const v = list[i]!;
          if (v.live) { // Live: Position aus (Echtzeit-)Abfahrts-/Ankunftszeit des Streckenabschnitts
            const f = (clock - v.live[0]) / (v.live[1] - v.live[0]);
            if (f < 0 || f > 1) continue;
            v.d = f * v.l.len;
          } else if (!st.paused) {
            v.d += v.dir * v.v * dt * st.speed;
            if (v.d < 0 || v.d > v.l.len) { if (lines.length) vehs[i] = spawn(); continue; }
          }
          const { x, y } = map.project(at(v.l, v.d));
          if (x < -40 || y < -40 || x > innerWidth + 40 || y > innerHeight + 40) continue;
          vis++; if (vis > MAXV) break;
          hx[hn] = x; hy[hn] = y; hv[hn] = v; hn++;
          const { x: tx, y: ty } = map.project(at(v.l, v.d - v.dir * v.v * (v.l.kind === "bus" ? 4 : 7)));
          const col = st.preset[v.l.kind];
          const pulse = 0.75 + 0.25 * Math.sin(t * 3 + v.ph);
          const grd = g.createLinearGradient(tx, ty, x, y); grd.addColorStop(0, "transparent"); grd.addColorStop(1, col);
          g.strokeStyle = grd; g.lineWidth = v.l.kind === "bus" ? sz * 0.8 : sz * 1.3; g.lineCap = "round";
          g.shadowColor = col; g.shadowBlur = gm === 2 ? 10 * pulse : 0;
          g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
          g.fillStyle = col; g.globalAlpha = pulse; g.shadowBlur = gm === 2 ? 16 * pulse : 0;
          g.beginPath(); g.arc(x, y, (v.l.kind === "bus" ? 1 : 1.5) * sz, 0, 6.283); g.fill(); g.globalAlpha = 1;
          if (gm === 1) { // soft: vorgerenderter Lichtpunkt statt Weichzeichnung (viel schneller)
            const R = sz * (v.l.kind === "bus" ? 3.5 : 5); g.globalAlpha = 0.85 * pulse;
            g.drawImage(sprite(col), x - R, y - R, 2 * R, 2 * R); g.globalAlpha = 1;
          }
          if (v === selRef.current) { // ausgewähltes Fahrzeug markieren
            selSeen = true; selX = x; selY = y;
            g.strokeStyle = "#ffffff"; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, sz * 4 + 3, 0, 6.283); g.stroke();
          }
        }
        g.shadowBlur = 0;
        const card = cardRef.current; // Infokarte folgt dem Fahrzeug
        if (card) {
          if (selSeen) { card.style.display = "block"; card.style.transform = `translate(${Math.max(8, Math.min(selX + 18, innerWidth - 270))}px, ${Math.max(8, Math.min(selY + 18, innerHeight - 130))}px)`; }
          else card.style.display = "none";
        }
      };
      raf = requestAnimationFrame(loop);
    })();
    return () => { dead = true; cancelAnimationFrame(raf); clearInterval(iv); clearInterval(iv2); if (onClick) removeEventListener("click", onClick); if (onDown) removeEventListener("pointerdown", onDown); if (onWheel) removeEventListener("wheel", onWheel); clearTimeout(mt); S.current.refetch = null; map?.remove(); };
  }, []);

  useEffect(() => { setLiveSt("load"); S.current.refetch?.(); }, [live]);

  useEffect(() => { const m = mapRef.current; if (m) setInteract(m, mode === "still" || paused); }, [mode, paused]);

  useEffect(() => {
    const m = mapRef.current; if (!m || !m.isStyleLoaded()) return;
    for (const [id, props] of Object.entries(paintFor(preset))) for (const [k, v] of Object.entries(props)) if (m.getLayer(id)) m.setPaintProperty(id, k, v);
    for (const id of ["live-net", "live-net-glow"]) if (m.getLayer(id)) m.setPaintProperty(id, "line-color", netColor(preset));
  }, [preset]);

  useEffect(() => {
    let to: any;
    let shown = false; // nur beim Wechsel neu rendern, nicht bei jedem Mausereignis
    const wake = () => { if (!shown) { shown = true; setUi(true); } clearTimeout(to); to = setTimeout(() => { shown = false; setUi(false); }, 3000); };
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key >= "1" && e.key <= "5") setPreset(PRESETS[+e.key - 1]!);
      else if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key.toLowerCase() === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      else if (e.key.toLowerCase() === "h") setUiOn((u) => !u);
      else if (e.key === "Escape") { selRef.current = null; setSel(null); }
      else if (e.key === "0") S.current.zoomOff = 0;
      else if (e.key.toLowerCase() === "g") setGlowMode((m) => (m + 1) % 3);
      wake();
    };
    wake();
    addEventListener("mousemove", wake); addEventListener("keydown", key);
    return () => { removeEventListener("mousemove", wake); removeEventListener("keydown", key); clearTimeout(to); };
  }, []);

  const show = ui && uiOn, a = preset.accent;
  const btn = (on: boolean) => ({ borderColor: a + (on ? "" : "55"), color: on ? preset.bg : a, background: on ? a : "transparent" });
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: preset.bg, cursor: show ? "default" : "none" }}>
      <div className="absolute inset-0"><div ref={mapEl} className="h-full w-full" /></div>
      <canvas ref={cvs} className="pointer-events-none absolute inset-0 h-full w-full" />
      {preset.grid && <div className="pointer-events-none absolute inset-0 opacity-40" style={{
        backgroundImage: `linear-gradient(${a}22 1px, transparent 1px), linear-gradient(90deg, ${a}22 1px, transparent 1px), linear-gradient(${a}0c 1px, transparent 1px), linear-gradient(90deg, ${a}0c 1px, transparent 1px)`,
        backgroundSize: "160px 160px,160px 160px,32px 32px,32px 32px" }} />}
      <div className="pointer-events-none absolute inset-0" style={{ background: "repeating-linear-gradient(0deg, rgba(0,0,0,.18) 0 1px, transparent 1px 3px), radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.75))" }} />
      <div className="pointer-events-none absolute bottom-6 left-8 font-mono text-[10px] uppercase tracking-[0.35em]" style={{ color: a, opacity: 0.55 }}>
        {city} · {preset.name} {live ? (liveSt === "ok" ? "· LIVE" : liveSt === "err" ? "· LIVE OFFLINE – SIMULATION" : "· LIVE LÄDT…") : "· SIMULATION"} {paused && "· PAUSED"}
      </div>
      {sel && (
        <div ref={cardRef} className="pointer-events-none absolute left-0 top-0 z-10 w-64 border px-3 py-2 font-mono text-xs uppercase tracking-wider"
          style={{ display: "none", borderColor: a + "88", background: preset.bg + "ee", color: a }}>
          <div className="mb-1 flex items-baseline justify-between gap-2"><span className="text-sm font-bold" style={{ color: preset[sel.kind] }}>{sel.line || KIND_NAME[sel.kind]}</span><span className="opacity-60">{KIND_NAME[sel.kind]}</span></div>
          <div className="opacity-90">{sel.from} → {sel.to}</div>
          <div className="mt-1 opacity-70">an {new Date(sel.arr).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} · {sel.rt ? (sel.delay > 0 ? `+${sel.delay} min` : sel.delay < 0 ? `${sel.delay} min` : "pünktlich") : "Fahrplan"}</div>
        </div>
      )}
      <div className="absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-4 p-6 font-mono text-xs transition-opacity duration-700"
        style={{ opacity: show ? 1 : 0, pointerEvents: show ? "auto" : "none", color: a }}>
        <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) focus(query.trim()); }} className="flex flex-col gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="› STADT / REGION SUCHEN"
            className="w-72 border bg-transparent px-3 py-2 uppercase tracking-widest outline-none placeholder:opacity-50"
            style={{ borderColor: a + "66", color: a, background: preset.bg + "e6" }} />
          <div className="flex flex-wrap gap-1">
            {Object.keys(CITIES).map((c) => <button type="button" key={c} onClick={() => focus(c)} className="border px-2 py-1 uppercase" style={btn(city === c)}>{c}</button>)}
          </div>
          {err && <span>{err}</span>}
        </form>
        <div className="flex flex-col items-end gap-2" style={{ background: preset.bg + "aa" }}>
          <div className="flex gap-1">{PRESETS.map((p) => <button key={p.id} title={p.name} onClick={() => setPreset(p)} className="border px-3 py-1" style={btn(p.id === preset.id)}>{p.id}</button>)}</div>
          <div className="flex gap-1">{(["breath", "pan", "still"] as Mode[]).map((m) => <button key={m} onClick={() => setMode(m)} className="border px-2 py-1 uppercase" style={btn(mode === m)}>{{ breath: "Zoom", pan: "Pan", still: "Stop" }[m]}</button>)}
            <button onClick={() => setPaused(!paused)} className="border px-2 py-1 uppercase" style={btn(paused)}>Pause</button>
            <button onClick={() => setLive(!live)} className="border px-2 py-1 uppercase" style={btn(live)}>Live</button>
            <button onClick={() => setGlowMode((m) => (m + 1) % 3)} className="border px-2 py-1 uppercase" style={btn(glowMode > 0)}>Glow {["aus", "soft", "voll"][glowMode]}</button></div>
          <label className="flex items-center gap-2 uppercase">Tempo {speed.toFixed(1)}×
            <input type="range" min={0.2} max={4} step={0.1} value={speed} onChange={(e) => setSpeed(+e.target.value)} style={{ accentColor: a }} /></label>
          <span className="opacity-50">1–5 PRESET · SPACE PAUSE · F VOLLBILD · G GLOW · H UI · RAD ZOOM · 0 RESET</span>
        </div>
      </div>
    </div>
  );
}
