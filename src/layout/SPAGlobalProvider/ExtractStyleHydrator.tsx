'use client';

import { hydrateExtractedStyles, type ExtractStyleManifest } from 'antd-style';
import { useLayoutEffect } from 'react';

const getExtractAssetUrls = () => {
  const base = import.meta.env.BASE_URL || '/';
  const root = new URL(base, window.location.origin);

  return {
    cssUrl: new URL('assets/__antd-style.extract.css', root).toString(),
    manifestUrl: new URL('assets/__antd-style.extract.manifest.json', root).toString(),
  };
};

const ensureExtractCss = (cssUrl: string) => {
  const existing = document.querySelector<HTMLLinkElement>(
    `link[data-antd-style-extract="${cssUrl}"]`,
  );
  if (existing) return;

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = cssUrl;
  link.dataset.antdStyleExtract = cssUrl;
  document.head.append(link);
};

const ExtractStyleHydrator = () => {
  useLayoutEffect(() => {
    if (process.env.NEXT_PUBLIC_ANTD_STYLE_EXTRACT !== '1') return;

    const { cssUrl, manifestUrl } = getExtractAssetUrls();

    let canceled = false;

    const run = async () => {
      try {
        ensureExtractCss(cssUrl);

        const res = await fetch(manifestUrl, { cache: 'force-cache' });
        if (!res.ok || canceled) return;

        const manifest = (await res.json()) as ExtractStyleManifest;
        if (!manifest?.entries?.length || canceled) return;

        hydrateExtractedStyles(manifest);
      } catch {
        // best-effort hydration, keep runtime fallback path
      }
    };

    void run();

    return () => {
      canceled = true;
    };
  }, []);

  return null;
};

export default ExtractStyleHydrator;
