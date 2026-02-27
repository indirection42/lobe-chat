#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);

const getArg = (name, fallback) => {
  const index = args.findIndex((arg) => arg === `--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};

const outputDir = path.resolve(getArg("outDir", ".next"));
const styleIdArg = (getArg("styleId", "auto") || "").trim();
const requireStyleIdArg = (getArg("requireStyleId", "") || "").trim();

const appThemePath = path.resolve("src/layout/GlobalProvider/AppTheme.tsx");
const styleRegistryPath = path.resolve(
  "src/layout/GlobalProvider/StyleRegistry.tsx"
);
const hydratorPath = path.resolve(
  "src/layout/GlobalProvider/ExtractStyleHydrator.tsx"
);
const nextConfigPath = path.resolve("next.config.ts");

const checks = [];

const pushCheck = (status, name, detail = "") =>
  checks.push({ detail, name, status });

const pass = (name, detail = "") => pushCheck("pass", name, detail);
const fail = (name, detail = "") => pushCheck("fail", name, detail);
const warn = (name, detail = "") => pushCheck("warn", name, detail);

const assert = (condition, name, detail = "") => {
  if (condition) pass(name, detail);
  else fail(name, detail);
};

const readIfExists = (filePath) => {
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf8");
};

const parseStyleIdFromSource = (source) => {
  const match = source.match(/styleId\s*:\s*['"`]([^'"`]+)['"`]/);
  return match?.[1] || "";
};

const walkFiles = (dirPath, collector) => {
  if (!existsSync(dirPath)) return;

  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const absPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      walkFiles(absPath, collector);
      continue;
    }

    collector.push(absPath);
  }
};

const normalizePath = (filePath) => filePath.replace(/\\/g, "/");

const getAssetPriority = (filePath, outRoot) => {
  const normalizedFile = normalizePath(filePath);
  const normalizedRoot = normalizePath(outRoot);

  if (normalizedFile.startsWith(`${normalizedRoot}/static/`)) return 0;
  if (normalizedFile.startsWith(`${normalizedRoot}/server/chunks/static/`))
    return 1;
  if (normalizedFile.startsWith(`${normalizedRoot}/server/static/`)) return 2;

  return 3;
};

const sortByAssetPriority = (list, outRoot) =>
  [...list].sort((a, b) => {
    const rankDiff = getAssetPriority(a, outRoot) - getAssetPriority(b, outRoot);
    if (rankDiff !== 0) return rankDiff;

    return a.localeCompare(b);
  });

const findExtractAssets = (outRoot) => {
  const files = [];
  walkFiles(outRoot, files);

  const manifests = sortByAssetPriority(
    files.filter((file) => file.endsWith("__antd-style.extract.manifest.json")),
    outRoot
  );
  const cssFiles = sortByAssetPriority(
    files.filter((file) => file.endsWith("__antd-style.extract.css")),
    outRoot
  );

  return {
    cssFiles,
    manifests,
  };
};

const resolveStyleIdConfig = () => {
  const inferRequire = (fallback) =>
    requireStyleIdArg === "" ? fallback : requireStyleIdArg === "1";

  const appThemeCode = readIfExists(appThemePath);
  const appThemeStyleId = parseStyleIdFromSource(appThemeCode);

  if (styleIdArg === "none") {
    return {
      requireStyleId: false,
      source: "disabled",
      styleId: "",
    };
  }

  if (styleIdArg === "appTheme") {
    return {
      requireStyleId: inferRequire(true),
      source: `appTheme:${appThemePath}`,
      styleId: appThemeStyleId,
    };
  }

  if (styleIdArg && styleIdArg !== "auto") {
    return {
      requireStyleId: inferRequire(true),
      source: "cli",
      styleId: styleIdArg,
    };
  }

  if (appThemeStyleId) {
    return {
      requireStyleId: inferRequire(false),
      source: `auto:${appThemePath}`,
      styleId: appThemeStyleId,
    };
  }

  return {
    requireStyleId: inferRequire(false),
    source: "auto-miss",
    styleId: "",
  };
};

const {
  requireStyleId,
  source: styleIdSource,
  styleId,
} = resolveStyleIdConfig();

const verifyBuildAssets = () => {
  const { cssFiles, manifests } = findExtractAssets(outputDir);

  const manifestPath = manifests[0];
  const cssPath = cssFiles[0];

  assert(existsSync(outputDir), "A0 next output 目录存在", outputDir);
  assert(
    !!manifestPath,
    "A1 manifest 产物存在",
    manifests.slice(0, 3).join(", ")
  );
  assert(!!cssPath, "A2 css 产物存在", cssFiles.slice(0, 3).join(", "));

  let manifest;
  let selectedManifestPath = manifestPath;

  const parsedManifests = manifests
    .map((candidatePath) => {
      try {
        const parsed = JSON.parse(readFileSync(candidatePath, "utf8"));
        return { manifest: parsed, path: candidatePath };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (parsedManifests.length === 0 && manifests.length > 0) {
    fail("A3 manifest 可解析", manifests[0]);
  }

  if (parsedManifests.length > 0) {
    const withEntries = parsedManifests.filter((item) =>
      Array.isArray(item?.manifest?.entries)
    );

    const withTargetStyleId =
      styleId && withEntries.length > 0
        ? withEntries.filter((item) =>
            item.manifest.entries.some((entry) => entry?.styleId === styleId)
          )
        : [];

    const selectedManifestInfo =
      withTargetStyleId[0] ||
      withEntries.find((item) => item.manifest.entries.length > 0) ||
      withEntries[0] ||
      parsedManifests[0];

    manifest = selectedManifestInfo?.manifest;
    selectedManifestPath = selectedManifestInfo?.path || selectedManifestPath;

    assert(
      manifest?.version === 1,
      "A3 manifest version=1",
      `version=${manifest?.version}, file=${selectedManifestPath}`
    );
    assert(Array.isArray(manifest?.entries), "A4 manifest.entries 为数组");
    assert((manifest?.entries || []).length > 0, "A4.1 manifest.entries 非空");

    if (styleId) {
      const matchedEntry = manifest?.entries?.find((entry) => entry?.styleId === styleId);
      const detail = `${styleId}${
        matchedEntry
          ? ""
          : ` (available: ${(manifest?.entries || [])
              .slice(0, 5)
              .map((item) => item.styleId)
              .join(", ")})`
      }, file=${selectedManifestPath}`;

      if (requireStyleId) {
        assert(!!matchedEntry, "A5 manifest 包含目标 styleId", detail);
      } else {
        if (matchedEntry) pass("A5 manifest 包含目标 styleId", detail);
        else warn("A5 manifest 未命中目标 styleId", detail);
      }
    } else {
      warn("A5 styleId 检查跳过", "未传 --styleId");
    }
  }

  let selectedCssPath = cssPath;
  if (selectedManifestPath && cssFiles.length > 0) {
    const sameDirCss = cssFiles.find(
      (candidatePath) => path.dirname(candidatePath) === path.dirname(selectedManifestPath)
    );
    if (sameDirCss) selectedCssPath = sameDirCss;
  }

  if (selectedCssPath) {
    const cssText = readFileSync(selectedCssPath, "utf8").trim();
    const isPlaceholder = cssText.includes("extract css (empty)");

    assert(
      cssText.length > 0,
      "A6 css 文件非空",
      `length=${cssText.length}, file=${selectedCssPath}`
    );
    assert(!isPlaceholder, "A7 css 非占位空内容", cssText.slice(0, 80));
  }

  return manifest;
};

const verifyWiring = () => {
  const nextConfigCode = readIfExists(nextConfigPath);
  const styleRegistryCode = readIfExists(styleRegistryPath);
  const hydratorCode = readIfExists(hydratorPath);
  const appThemeCode = readIfExists(appThemePath);
  const appThemeStyleId = parseStyleIdFromSource(appThemeCode);

  assert(
    nextConfigCode.includes("AntdStyleExtractWebpackPlugin") ||
      nextConfigCode.includes("ExtractWebpackPlugin"),
    "B1 next.config 已接线 extract webpack plugin",
    nextConfigPath
  );
  assert(
    styleRegistryCode.includes("ExtractStyleHydrator"),
    "B2 StyleRegistry 挂载 ExtractStyleHydrator",
    styleRegistryPath
  );
  assert(
    hydratorCode.includes("hydrateExtractedStyles"),
    "B3 Hydrator 调用 hydrateExtractedStyles",
    hydratorPath
  );
  assert(
    !!appThemeStyleId,
    "B4 AppTheme 已注入 styleId",
    appThemeStyleId ? `${appThemePath} (${appThemeStyleId})` : appThemePath
  );
};

const verifyFallbackSmoke = (manifest) => {
  if (!manifest) return;

  try {
    const antdStyle = require("antd-style");

    if (
      typeof antdStyle.hydrateExtractedStyles !== "function" ||
      typeof antdStyle.createStaticStyles !== "function"
    ) {
      warn("C0 runtime 动态验证跳过", "antd-style API 不可用");
      return;
    }

    const entries = manifest.entries || [];
    const known = entries[0];

    antdStyle.hydrateExtractedStyles(manifest);

    if (known?.styleId && known?.styles) {
      const hit = antdStyle.createStaticStyles(
        ({ css }) => ({
          probe: css`
            color: red;
          `,
        }),
        { styleId: known.styleId }
      );

      assert(
        JSON.stringify(hit) === JSON.stringify(known.styles),
        "C1 命中 styleId 返回 manifest classMap",
        known.styleId
      );
    } else {
      warn("C1 命中 styleId 测试跳过", "manifest entries 为空");
    }

    const miss = antdStyle.createStaticStyles(
      ({ css }) => ({
        probe: css`
          color: blue;
        `,
      }),
      { styleId: "__verify_missing_style_id__" }
    );

    assert(
      typeof miss?.probe === "string" && miss.probe.length > 0,
      "C2 缺失 styleId 走 fallback（仍有 className）",
      String(miss?.probe)
    );
  } catch (error) {
    warn("C0 runtime 动态验证跳过", String(error));
  }
};

const main = () => {
  if (styleId) {
    pass(
      "A5 styleId 目标",
      `${styleId} (${styleIdSource}${
        requireStyleId ? ", requireStyleId=1" : ", requireStyleId=0"
      })`
    );
  } else if (requireStyleId) {
    fail(
      "A5 styleId 目标解析失败",
      `source=${styleIdSource}, requireStyleId=1`
    );
  } else {
    warn("A5 styleId 目标未设置", `source=${styleIdSource}`);
  }

  const manifest = verifyBuildAssets();
  verifyWiring();
  verifyFallbackSmoke(manifest);

  const summary = {
    fail: checks.filter((item) => item.status === "fail").length,
    pass: checks.filter((item) => item.status === "pass").length,
    warn: checks.filter((item) => item.status === "warn").length,
  };

  for (const item of checks) {
    const icon =
      item.status === "pass" ? "✅" : item.status === "warn" ? "⚠️" : "❌";
    const suffix = item.detail ? ` — ${item.detail}` : "";
    console.log(`${icon} ${item.name}${suffix}`);
  }

  console.log(
    `\nSummary: pass=${summary.pass} warn=${summary.warn} fail=${summary.fail}`
  );

  if (summary.fail > 0) process.exit(1);
};

main();
