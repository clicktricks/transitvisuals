import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";

const TransitScreensaver = lazy(() => import("@/components/TransitScreensaver"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Neon Transit — Cyberpunk Screensaver" },
      { name: "description", content: "Animated sci-fi transit network screensaver with breathing zoom and five neon presets." },
      { property: "og:title", content: "Neon Transit — Cyberpunk Screensaver" },
      { property: "og:description", content: "Animated sci-fi transit network screensaver with breathing zoom and five neon presets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return <div className="fixed inset-0 bg-background">{ok && <Suspense fallback={null}><TransitScreensaver /></Suspense>}</div>;
}
