#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);

const args = process.argv.slice(2);

const getArg = (name, fallback) => {
  const index = args.findIndex((arg) => arg === `--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};

const styleIdArg = (getArg('styleId', 'auto') || '').trim();
const requireStyleIdArg = (getArg('requireStyleId', '') || '').trim();
const explicitDist = getArg('dist', undefined);
const targetArg = getArg('targets', 'desktop');
const appThemePath = path.resolve('src/layout/GlobalProvider/AppTheme.tsx');

const targetToDist = {
  desktop: path.resolve(getArg('distDesktop', 'dist/desktop')),
  mobile: path.resolve(getArg('distMobile', 'dist/mobile')),
};

const targets = explicitDist
  ? [{ name: getArg('label', 'custom'), distDir: path.resolve(explicitDist) }]
  : targetArg
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((target) => ({
        name: target,
        distDir: targetToDist[target] ?? path.resolve(target),
      }));

const checks = [];

const pushCheck = (status, name, detail = '') => checks.push({ detail, name, status });

const pass = (name, detail = '') => pushCheck('pass', name, detail);
const fail = (name, detail = '') => pushCheck('fail', name, detail);
const warn = (name, detail = '') => pushCheck('warn', name, detail);

const assert = (condition, name, detail) => {
  if (condition) pass(name, detail);
  else fail(name, detail);
};

const readIfExists = (filePath) => {
  if (!existsSync(filePath)) return undefined;
  return readFileSync(filePath, 'utf8');
};

const parseStyleIdFromSource = (source) => {
  const match = source.match(/styleId\s*:\s*['"`]([^'"`]+)['"`]/);
  return match?.[1] || '';
};

const resolveStyleIdConfig = () => {
  const inferRequire = (fallback) =>
    requireStyleIdArg === '' ? fallback : requireStyleIdArg === '1';

  const appThemeCode = readIfExists(appThemePath) || '';
  const appThemeStyleId = parseStyleIdFromSource(appThemeCode);

  if (styleIdArg === 'none') {
    return {
      requireStyleId: false,
      source: 'disabled',
      styleId: '',
    };
  }

  if (styleIdArg === 'appTheme') {
    return {
      requireStyleId: inferRequire(true),
      source: `appTheme:${appThemePath}`,
      styleId: appThemeStyleId,
    };
  }

  if (styleIdArg && styleIdArg !== 'auto') {
    return {
      requireStyleId: inferRequire(true),
      source: 'cli',
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
    source: 'auto-miss',
    styleId: '',
  };
};

const { requireStyleId, source: styleIdSource, styleId } = resolveStyleIdConfig();

const verifyBuildAssets = ({ name, distDir }) => {
  const prefix = `[${name}]`;
  const assetsDir = path.join(distDir, 'assets');
  const manifestPath = path.join(assetsDir, '__antd-style.extract.manifest.json');
  const cssPath = path.join(assetsDir, '__antd-style.extract.css');

  const htmlCandidates = [
    path.join(distDir, 'index.html'),
    path.join(distDir, 'index.mobile.html'),
  ];
  const htmlPath = htmlCandidates.find((candidate) => existsSync(candidate));

  let manifest;

  assert(existsSync(distDir), `${prefix} A0 dist 目录存在`, distDir);
  assert(existsSync(assetsDir), `${prefix} A0 assets 目录存在`, assetsDir);

  assert(existsSync(manifestPath), `${prefix} A1 manifest 存在`, manifestPath);
  assert(existsSync(cssPath), `${prefix} A2 css 产物存在`, cssPath);

  if (existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      assert(
        manifest?.version === 1,
        `${prefix} A3 manifest version=1`,
        `version=${manifest?.version}`,
      );
      assert(Array.isArray(manifest?.entries), `${prefix} A4 manifest.entries 为数组`, '');
      assert((manifest?.entries || []).length > 0, `${prefix} A4.1 manifest.entries 非空`, '');

      if (styleId) {
        const matchedEntry = manifest?.entries?.find((entry) => entry?.styleId === styleId);
        const isAppThemeTarget =
          styleIdSource.startsWith('auto:') || styleIdSource.startsWith('appTheme:');
        const hint =
          !matchedEntry && isAppThemeTarget
            ? ' (hint: AppTheme 样式含模板插值时会走 runtime fallback)'
            : '';
        const detail = `${styleId}${
          matchedEntry
            ? ''
            : ` (available: ${(manifest?.entries || [])
                .slice(0, 5)
                .map((e) => e.styleId)
                .join(', ')})${hint}`
        }`;

        if (requireStyleId) {
          assert(!!matchedEntry, `${prefix} A5 manifest 包含目标 styleId`, detail);
        } else {
          if (matchedEntry) pass(`${prefix} A5 manifest 包含目标 styleId`, detail);
          else warn(`${prefix} A5 manifest 未命中目标 styleId`, detail);
        }
      } else {
        warn(`${prefix} A5 styleId 检查跳过`, '未传 --styleId');
      }
    } catch (error) {
      fail(`${prefix} A3 manifest 可解析`, String(error));
    }
  }

  if (existsSync(cssPath)) {
    const cssText = readFileSync(cssPath, 'utf8');
    const cssTrimmed = cssText.trim();
    const isPlaceholder = cssTrimmed.includes('extract css (empty)');

    assert(cssTrimmed.length > 0, `${prefix} A6 css 文件非空`, `length=${cssTrimmed.length}`);
    assert(!isPlaceholder, `${prefix} A7 css 非占位空内容`, cssTrimmed.slice(0, 80));
  }

  if (htmlPath) {
    const html = readIfExists(htmlPath) || '';
    assert(
      html.includes('__antd-style.extract.css'),
      `${prefix} B1 html 包含 extract css link`,
      htmlPath,
    );
  } else {
    warn(`${prefix} B1 html 检查跳过`, `${htmlCandidates.join(' / ')} 均不存在`);
  }

  return manifest;
};

const verifyRuntimeWiring = () => {
  const spaProviderPath = path.resolve('src/layout/SPAGlobalProvider/index.tsx');
  const hydratorPath = path.resolve('src/layout/SPAGlobalProvider/ExtractStyleHydrator.tsx');

  const spaProviderCode = readIfExists(spaProviderPath) || '';
  const hydratorCode = readIfExists(hydratorPath) || '';
  const appThemeCode = readIfExists(appThemePath) || '';
  const appThemeStyleId = parseStyleIdFromSource(appThemeCode);

  assert(
    spaProviderCode.includes('ExtractStyleHydrator'),
    'B2 SPAGlobalProvider 挂载 ExtractStyleHydrator',
    spaProviderPath,
  );
  assert(
    hydratorCode.includes('hydrateExtractedStyles'),
    'B3 Hydrator 调用 hydrateExtractedStyles',
    hydratorPath,
  );
  assert(
    !!appThemeStyleId,
    'B4 AppTheme 已注入 styleId',
    appThemeStyleId ? `${appThemePath} (${appThemeStyleId})` : appThemePath,
  );
};

const verifyFallbackSmoke = (manifest) => {
  if (!manifest) return;

  try {
    const antdStyle = require('antd-style');

    if (
      typeof antdStyle.hydrateExtractedStyles !== 'function' ||
      typeof antdStyle.createStaticStyles !== 'function'
    ) {
      warn('C0 runtime 动态验证跳过', 'antd-style API 不可用');
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
        { styleId: known.styleId },
      );

      const hitOk = JSON.stringify(hit) === JSON.stringify(known.styles);
      assert(hitOk, 'C1 命中 styleId 返回 manifest classMap', known.styleId);
    } else {
      warn('C1 命中 styleId 测试跳过', 'manifest entries 为空');
    }

    const miss = antdStyle.createStaticStyles(
      ({ css }) => ({
        probe: css`
          color: blue;
        `,
      }),
      { styleId: '__verify_missing_style_id__' },
    );

    assert(
      typeof miss?.probe === 'string' && miss.probe.length > 0,
      'C2 缺失 styleId 走 fallback（仍有 className）',
      String(miss?.probe),
    );
  } catch (error) {
    warn('C0 runtime 动态验证跳过', String(error));
  }
};

const main = () => {
  if (targets.length === 0) {
    fail('参数错误', '未提供有效 target 或 dist');
  }

  if (styleId) {
    pass(
      'A5 styleId 目标',
      `${styleId} (${styleIdSource}${
        requireStyleId ? ', requireStyleId=1' : ', requireStyleId=0'
      })`,
    );
  } else if (requireStyleId) {
    fail('A5 styleId 目标解析失败', `source=${styleIdSource}, requireStyleId=1`);
  } else {
    warn('A5 styleId 目标未设置', `source=${styleIdSource}`);
  }

  const manifests = targets.map(verifyBuildAssets).filter(Boolean);

  verifyRuntimeWiring();
  verifyFallbackSmoke(manifests[0]);

  const summary = {
    fail: checks.filter((c) => c.status === 'fail').length,
    pass: checks.filter((c) => c.status === 'pass').length,
    warn: checks.filter((c) => c.status === 'warn').length,
  };

  for (const item of checks) {
    const icon = item.status === 'pass' ? '✅' : item.status === 'warn' ? '⚠️' : '❌';
    const suffix = item.detail ? ` — ${item.detail}` : '';
    console.log(`${icon} ${item.name}${suffix}`);
  }

  console.log(`\nSummary: pass=${summary.pass} warn=${summary.warn} fail=${summary.fail}`);

  if (summary.fail > 0) process.exit(1);
};

main();
