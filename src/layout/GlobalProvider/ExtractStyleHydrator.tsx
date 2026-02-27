"use client";

import * as antdStyle from "antd-style";
import { useEffect } from "react";

interface ExtractStyleManifest {
  entries?: Array<{
    styleId: string;
    styles: Record<string, string>;
  }>;
  version: 1;
}

const hydrateExtractedStyles = (antdStyle as any).hydrateExtractedStyles as
  | ((manifest: ExtractStyleManifest) => void)
  | undefined;

const MANIFEST_PATHS = [
  "/_next/static/__antd-style.extract.manifest.json",
  "/_next/__antd-style.extract.manifest.json",
  "/__antd-style.extract.manifest.json",
];

const CSS_PATHS = [
  "/_next/static/__antd-style.extract.css",
  "/_next/__antd-style.extract.css",
  "/__antd-style.extract.css",
];

const fetchFirstManifest = async (): Promise<ExtractStyleManifest | null> => {
  for (const path of MANIFEST_PATHS) {
    try {
      const res = await fetch(path, { cache: "force-cache" });
      if (!res.ok) continue;

      const data = (await res.json()) as ExtractStyleManifest;
      if (!data?.entries?.length) continue;

      return data;
    } catch {
      // ignore and fallback to next candidate path
    }
  }

  return null;
};

const ensureExtractCssLoaded = async () => {
  if (typeof document === "undefined") return;

  for (const path of CSS_PATHS) {
    const exists = document.querySelector(
      `link[data-antd-style-extract="${path}"]`
    );
    if (exists) return;

    try {
      const res = await fetch(path, { method: "HEAD" });
      if (!res.ok) continue;

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = path;
      link.dataset.antdStyleExtract = path;
      document.head.append(link);
      return;
    } catch {
      // ignore and fallback to next candidate path
    }
  }
};

const ExtractStyleHydrator = () => {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ANTD_STYLE_EXTRACT !== "1") return;
    if (typeof hydrateExtractedStyles !== "function") return;

    let disposed = false;

    const run = async () => {
      const manifest = await fetchFirstManifest();
      if (!manifest || disposed) return;

      hydrateExtractedStyles(manifest);
      await ensureExtractCssLoaded();
    };

    run();

    return () => {
      disposed = true;
    };
  }, []);

  return null;
};

export default ExtractStyleHydrator;
