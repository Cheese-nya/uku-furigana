import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import postcss from 'postcss';
import cascadeLayers from '@csstools/postcss-cascade-layers';

const root = new URL('../', import.meta.url).pathname;
const read = path => readFileSync(join(root, path), 'utf8');

test('production browser targets keep the supported old WebView baseline', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.browserslist, [
    'Chrome >= 92',
    'Edge >= 92',
    'Firefox >= 111',
    'Safari >= 16.4',
  ]);
  assert.ok(pkg.devDependencies['@csstools/postcss-cascade-layers']);
  assert.ok(pkg.devDependencies.postcss);
});

test('PostCSS flattens layers while preserving priority and valid fallback syntax', async () => {
  const config = (await import('../postcss.config.mjs')).default;
  assert.equal(Object.keys(config.plugins)[0], '@tailwindcss/postcss');
  assert.ok(config.plugins['@csstools/postcss-cascade-layers']);

  // Mirror Tailwind's bundle: an early theme layer and a later utility layer.
  // The utility must still win after @layer is compiled away.
  const source = `@layer theme { .target { color: red; } }\n@layer utilities { .target { color: blue; } }`;
  const { css } = await postcss([cascadeLayers()]).process(source, { from: undefined });
  assert.doesNotMatch(css, /@layer/);
  assert.match(css, /:not\(#\\#\)/);
  const colours = [...css.matchAll(/\.target[^{]*\{[^}]*color:\s*(red|blue)/g)].map(m => m[1]);
  assert.deepEqual(colours, ['red', 'blue']);
  assert.ok(css.indexOf('color: blue') > css.indexOf('color: red'));
});

test('legacy fallbacks are guarded and modern spring easing remains available', () => {
  const css = read('app/globals.css');
  assert.doesNotThrow(() => postcss.parse(css), 'globals.css must stay parseable');
  assert.match(css, /@supports \(transition-timing-function: linear\(0, 1\)\)/);
  assert.match(css, /--spring-bouncy: cubic-bezier\(/);
  assert.match(css, /--spring-bouncy: linear\(/);
  assert.match(css, /@supports not \(translate: 0px\)/);
  assert.match(css, /\.lookup-bottom-card \{ transform: translateY\(/);
  assert.match(css, /\.modal-sheet\[data-visible='false'\] \{ transform: translateY\(100%\)/);
  assert.match(css, /\.reader-capsule \{ transform: translateX\(-50%\)/);
  assert.match(css, /--danger-wash: rgba\(/);
  assert.match(css, /--danger-soft: rgba\(/);
  assert.match(css, /--ok-wash: rgba\(/);
  assert.match(css, /--review-soft: rgba\(/);
});

test('modal heights and drag transforms have explicit legacy support', () => {
  const modal = read('app/components/Modal.tsx');
  const css = read('app/globals.css');
  assert.match(css, /\.modal-sheet \{ max-height: var\(--modal-max-height, 92vh\); \}/);
  assert.match(css, /\.modal-body \{ max-height: var\(--modal-body-max-height, calc\(92vh - 130px\)\); \}/);
  assert.match(css, /@supports \(height: 1dvh\)/);
  assert.match(modal, /className="modal-body overflow-y-auto/);
  assert.match(modal, /data-visible=\{visible \? 'true' : 'false'\}/);
  assert.match(modal, /CSS\.supports\?\.\('translate', '0'\)/);
  assert.match(modal, /sheet\.style\.transform = `translateY\(/);
  assert.match(modal, /el\.style\.transform = ''/);
});

test('static CSS bundle emits no cascade layers', t => {
  const chunks = join(root, 'out/_next/static/chunks');
  if (!existsSync(chunks)) {
    t.skip('no static bundle in out/; run npm run build:web to check it');
    return;
  }
  const styles = readdirSync(chunks).filter(name => name.endsWith('.css'));
  assert.ok(styles.length, 'expected a compiled stylesheet in out/');
  for (const file of styles) {
    const css = readFileSync(join(chunks, file), 'utf8');
    assert.doesNotMatch(css, /@layer\b/, `${file} must not retain @layer`);
  }
});
