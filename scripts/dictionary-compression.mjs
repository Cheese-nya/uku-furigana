import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const BROTLI_OPTIONS = {
  params: {
    [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_GENERIC,
  },
};

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const isGzip = bytes => bytes[0] === 0x1f && bytes[1] === 0x8b;

function rawBytes(file) {
  const bytes = fs.readFileSync(file);
  return isGzip(bytes) ? zlib.gunzipSync(bytes) : bytes;
}

function brotliName(name) {
  return name.endsWith('.gz') ? `${name.slice(0, -3)}.br` : `${name}.br`;
}

/**
 * Writes a content-addressed Brotli set for `names` and removes the previous set.
 * The caller updates its manifest only after this resolves, so a failed build never
 * points at missing files.
 */
function writeBrotliSet(sourceDir, names, seed) {
  const files = new Map();
  const combined = crypto.createHash('sha256');
  combined.update(seed);

  for (const name of names) {
    const raw = rawBytes(path.join(sourceDir, name));
    const brotli = zlib.brotliCompressSync(raw, BROTLI_OPTIONS);
    if (!zlib.brotliDecompressSync(brotli).equals(raw)) {
      throw new Error(`Brotli round-trip failed for ${name}`);
    }
    const hash = sha256(raw);
    combined.update(`\0${name}\0${hash}`);
    files.set(name, { raw, brotli, hash });
  }

  const directory = combined.digest('hex').slice(0, 16);
  const assetsDir = path.join(sourceDir, 'assets');
  fs.rmSync(assetsDir, { recursive: true, force: true });
  const targetDir = path.join(assetsDir, directory);
  fs.mkdirSync(targetDir, { recursive: true });

  const entries = {};
  for (const [name, { raw, brotli, hash }] of files) {
    const output = brotliName(name);
    fs.writeFileSync(path.join(targetDir, output), brotli);
    entries[name] = {
      brotli: `assets/${directory}/${output}`,
      size: raw.byteLength,
      sha256: hash,
      brotliSize: brotli.byteLength,
    };
  }

  return { directory, entries };
}

/** Adds `brotliBaseUrl` / `brotliShards` to a point-lookup index, keeping the gzip `shards` for old clients. */
export function writeLookupCompressedAssets(directory) {
  const indexFile = path.join(directory, 'index.json');
  if (!fs.existsSync(indexFile)) return null;
  const manifest = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  const shards = Array.isArray(manifest.shards) ? manifest.shards.filter(name => typeof name === 'string') : [];
  if (!shards.length) throw new Error(`${indexFile} has no shards`);

  const set = writeBrotliSet(
    directory,
    shards,
    `lookup\0${manifest.id ?? ''}\0${manifest.revision ?? ''}\0${manifest.count ?? ''}\0`,
  );
  const brotliShards = {};
  for (const shard of shards) brotliShards[shard] = set.entries[shard].brotli;

  const next = {
    ...manifest,
    brotliBaseUrl: `assets/${set.directory}/`,
    brotliShards,
  };
  fs.writeFileSync(indexFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    directory,
    shards: shards.length,
    bytes: shards.reduce((sum, name) => sum + set.entries[name].brotliSize, 0),
  };
}

/** Writes the tokenizer dictionary's Brotli manifest. Original `.gz` files remain the fallback. */
export function writeKuromojiCompressedAssets(directory) {
  const manifestFile = path.join(directory, 'manifest.json');
  if (!fs.existsSync(directory)) return null;
  const names = fs
    .readdirSync(directory)
    .filter(name => name.endsWith('.gz'))
    .sort();
  if (!names.length) return null;

  const set = writeBrotliSet(directory, names, 'kuromoji\0');
  const manifest = {
    version: 1,
    revision: set.directory,
    files: set.entries,
  };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    directory,
    files: names.length,
    bytes: names.reduce((sum, name) => sum + set.entries[name].brotliSize, 0),
  };
}
