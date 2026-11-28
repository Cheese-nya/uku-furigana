/**
 * Downloads and verifies the official NDLOCR-Lite ONNX model suite + configs from
 * ndl-lab/ndlocr-lite, caches them under `.cache/ndlocr-lite/`, converts `ndl.yaml` and
 * `NDLmoji.yaml` into compact `ndl-config.json`, writes `manifest.json`, and copies the
 * runtime files into `public/vendor/ndlocr-lite/`.
 *
 * Set UKU_SKIP_OCR_MODELS=1 to skip downloading the ~150 MB model weights (used by `npm test`).
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, '.cache', 'ndlocr-lite');
const targetDir = join(root, 'public', 'vendor', 'ndlocr-lite');

const UPSTREAM_BASE =
  process.env.UKU_NDLOCR_BASE_URL ||
  'https://raw.githubusercontent.com/ndl-lab/ndlocr-lite/master';

export const MODEL_FILES = [
  {
    key: 'deim',
    name: 'deim-s-1024x1024-261124.onnx',
    remotePath: 'src/model/deim-s-1024x1024-261124.onnx',
    size: 40280965,
  },
  {
    key: 'parseq30',
    name: 'parseq-ndl-24x256-30-tiny-499epoch-261124.onnx',
    remotePath: 'src/model/parseq-ndl-24x256-30-tiny-499epoch-261124.onnx',
    size: 36738502,
  },
  {
    key: 'parseq50',
    name: 'parseq-ndl-24x384-50-tiny-278epoch-261124.onnx',
    remotePath: 'src/model/parseq-ndl-24x384-50-tiny-278epoch-261124.onnx',
    size: 37808553,
  },
  {
    key: 'parseq100',
    name: 'parseq-ndl-24x768-100-tiny-153epoch-261124.onnx',
    remotePath: 'src/model/parseq-ndl-24x768-100-tiny-153epoch-261124.onnx',
    size: 42588187,
  },
];

const CONFIG_SOURCES = [
  { name: 'ndl.yaml', remotePath: 'src/config/ndl.yaml' },
  { name: 'NDLmoji.yaml', remotePath: 'src/config/NDLmoji.yaml' },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseNdlYaml(source) {
  const classes = {};
  const markdown = {};
  let section = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '');
    if (!line.trim()) continue;
    if (/^names:\s*$/.test(line.trim())) {
      section = 'names';
      continue;
    }
    if (/^markdown:\s*$/.test(line.trim())) {
      section = 'markdown';
      continue;
    }
    const match = /^\s+(\d+):\s*(.+?)\s*$/.exec(line);
    if (!match || !section) continue;
    const id = Number(match[1]);
    const val = match[2].replace(/^['"]|['"]$/g, '');
    if (section === 'names') classes[id] = val;
    else markdown[id] = val;
  }
  const classList = [];
  const maxId = Math.max(...Object.keys(classes).map(Number));
  for (let i = 0; i <= maxId; i += 1) {
    classList.push(classes[i] ?? `unknown_${i}`);
  }
  if (classList.length < 17) {
    throw new Error(`Expected >= 17 NDL classes in ndl.yaml, got ${classList.length}`);
  }
  return { classes: classList, markdown };
}

function parseNdlMojiYaml(source) {
  for (const rawLine of source.split(/\r?\n/)) {
    const match = /^\s*charset_train:\s*(".*")\s*$/.exec(rawLine);
    if (match) {
      const parsed = JSON.parse(match[1]);
      const chars = Array.from(parsed);
      if (chars.length < 1000) {
        throw new Error(`Unexpectedly short NDLmoji charset_train: ${chars.length}`);
      }
      return chars;
    }
  }
  throw new Error('Could not locate charset_train in NDLmoji.yaml');
}

async function downloadFile(url, destPath, expectedSize) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (expectedSize !== undefined && bytes.byteLength !== expectedSize) {
    throw new Error(`Size mismatch for ${url}: expected ${expectedSize}, got ${bytes.byteLength}`);
  }
  writeFileSync(destPath, bytes);
  return bytes;
}

async function ensureCachedFile(remotePath, cacheName, expectedSize) {
  const cachedPath = join(cacheDir, cacheName);
  if (existsSync(cachedPath)) {
    const stats = statSync(cachedPath);
    if (expectedSize === undefined || stats.size === expectedSize) {
      return readFileSync(cachedPath);
    }
  }
  const url = `${UPSTREAM_BASE}/${remotePath}`;
  console.log(`==> Downloading ${cacheName}...`);
  return downloadFile(url, cachedPath, expectedSize);
}

export async function syncOcrModels() {
  if (process.env.UKU_SKIP_OCR_MODELS === '1') {
    console.log('==> Skipping NDLOCR-Lite model download (UKU_SKIP_OCR_MODELS=1)');
    return;
  }

  mkdirSync(cacheDir, { recursive: true });
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  const ndlYamlBytes = await ensureCachedFile(CONFIG_SOURCES[0].remotePath, CONFIG_SOURCES[0].name);
  const mojiYamlBytes = await ensureCachedFile(CONFIG_SOURCES[1].remotePath, CONFIG_SOURCES[1].name);
  const { classes, markdown } = parseNdlYaml(Buffer.from(ndlYamlBytes).toString('utf8'));
  const charset = parseNdlMojiYaml(Buffer.from(mojiYamlBytes).toString('utf8'));

  const configJson = JSON.stringify({ classes, markdown, charset });
  const configPath = join(targetDir, 'ndl-config.json');
  writeFileSync(configPath, configJson, 'utf8');
  const configBuf = Buffer.from(configJson, 'utf8');

  const filesManifest = {
    'ndl-config.json': {
      key: 'config',
      size: configBuf.byteLength,
      sha256: sha256(configBuf),
    },
  };

  for (const entry of MODEL_FILES) {
    const cachedBytes = await ensureCachedFile(entry.remotePath, entry.name, entry.size);
    const outPath = join(targetDir, entry.name);
    copyFileSync(join(cacheDir, entry.name), outPath);
    filesManifest[entry.name] = {
      key: entry.key,
      size: cachedBytes.byteLength,
      sha256: sha256(cachedBytes),
    };
  }

  const manifest = {
    version: 1,
    revision: 'ndlocr-lite-261124',
    files: filesManifest,
  };
  writeFileSync(join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('==> NDLOCR-Lite models ready in public/vendor/ndlocr-lite');
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirect) {
  await syncOcrModels();
}
