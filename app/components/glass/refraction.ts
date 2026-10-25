/**
 * Liquid Glass refraction (Chromium only).
 *
 * Each registered glass element gets its own SVG filter whose displacement
 * map is generated for the element's exact size and corner radius: content
 * behind the rim is pulled inward like a lens, with a slight colour split.
 * Chromium is the only engine that honours `backdrop-filter: url(#…)`;
 * everywhere else (iOS WKWebView, Safari, Firefox) the CSS fallback in
 * globals.css — blur + saturate + specular rim — is what renders.
 */

const NS = 'http://www.w3.org/2000/svg';

export interface GlassOptions {
  /** Lens mode: narrow bevel and slight magnification, no colour split. */
  lens?: boolean;
}

interface GlassEntry {
  filter: SVGFilterElement;
  image: SVGFEImageElement;
  maps: Array<[SVGFEDisplacementMapElement, number]>;
  lens: boolean;
  key: string;
}

let defs: SVGDefsElement | null = null;
let nextId = 0;
let observer: ResizeObserver | null = null;
const entries = new Map<Element, GlassEntry>();
const mapCache = new Map<string, string>();

export function refractionSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (!/Chrome\//.test(ua) || /CriOS|FxiOS/.test(ua)) return false;
  if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) return false;
  return true;
}

function ensureDefs(): SVGDefsElement {
  if (defs && defs.isConnected) return defs;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.pointerEvents = 'none';
  defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);
  document.documentElement.dataset.refract = 'on';
  return defs;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const key in attrs) node.setAttribute(key, String(attrs[key]));
  parent.appendChild(node);
  return node;
}

const clamp255 = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

/** Displacement map for a rounded rect: R/G encode the x/y offset (128 = none). */
function buildMap(w: number, h: number, radius: number, bezel: number, scale: number, magnify: number): string {
  const key = [w, h, radius, bezel, scale, magnify].join('/');
  const cached = mapCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(radius, hw, hh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hw;
      const py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - r);
      const qy = Math.abs(py) - (hh - r);
      let dist: number;
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy);
        dist = len - r;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
      } else if (qx > qy) {
        dist = qx - r; nx = Math.sign(px); ny = 0;
      } else {
        dist = qy - r; nx = 0; ny = Math.sign(py);
      }
      const inside = Math.max(0, -dist);
      let dx = 0;
      let dy = 0;
      if (inside < bezel) {
        const strength = Math.pow(1 - inside / bezel, 2.4);
        dx = -nx * strength * scale * 0.5;
        dy = -ny * strength * scale * 0.5;
      }
      if (magnify) {
        dx += px * (1 / magnify - 1);
        dy += py * (1 / magnify - 1);
      }
      const i = (y * w + x) * 4;
      data[i] = clamp255(128 + (dx / scale) * 255);
      data[i + 1] = clamp255(128 + (dy / scale) * 255);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  if (mapCache.size > 64) mapCache.clear();
  mapCache.set(key, url);
  return url;
}

function createFilter(lens: boolean): Omit<GlassEntry, 'key' | 'lens'> {
  const id = `lg-refract-${++nextId}`;
  const filter = svgEl('filter', { id, x: 0, y: 0, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse', 'color-interpolation-filters': 'sRGB' }, ensureDefs());
  svgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: lens ? 0.4 : 2, result: 'blur' }, filter);
  const image = svgEl('feImage', { x: 0, y: 0, result: 'map', preserveAspectRatio: 'none' }, filter);
  const channel = (k: number, name: string, matrix: string): [SVGFEDisplacementMapElement, number] => {
    const map = svgEl('feDisplacementMap', { in: 'blur', in2: 'map', xChannelSelector: 'R', yChannelSelector: 'G', result: `${name}d` }, filter);
    svgEl('feColorMatrix', { in: `${name}d`, type: 'matrix', values: matrix, result: name }, filter);
    return [map, k];
  };
  const maps = [
    channel(1, 'r', '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'),
    channel(lens ? 1 : 0.93, 'g', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'),
    channel(lens ? 1 : 0.86, 'b', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'),
  ];
  svgEl('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }, filter);
  svgEl('feBlend', { in: 'rg', in2: 'b', mode: 'screen', result: 'rgb' }, filter);
  svgEl('feColorMatrix', { in: 'rgb', type: 'saturate', values: lens ? 1.2 : 1.6 }, filter);
  return { filter, image, maps };
}

function update(el: HTMLElement): void {
  const entry = entries.get(el);
  if (!entry) return;
  const w = Math.round(el.offsetWidth);
  const h = Math.round(el.offsetHeight);
  if (!w || !h) return;
  const key = `${w}x${h}`;
  if (entry.key === key) return;
  entry.key = key;
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  const { lens } = entry;
  const scale = lens ? 12 : Math.min(70, Math.max(34, Math.min(w, h) * 0.55));
  const bezel = lens ? Math.min(8, h / 3) : Math.min(22, (Math.min(w, h) / 2) * 0.8);
  const url = buildMap(w, h, radius, bezel, scale, lens ? 1.06 : 0);
  entry.filter.setAttribute('width', String(w));
  entry.filter.setAttribute('height', String(h));
  entry.image.setAttribute('width', String(w));
  entry.image.setAttribute('height', String(h));
  entry.image.setAttribute('href', url);
  for (const [map, k] of entry.maps) map.setAttribute('scale', String(scale * k));
}

/** Register an element as refracting glass. Returns an unregister function. */
// While anything scrolls, html[data-scrolling] swaps the refraction for plain blur (globals.css): the SVG
// displacement is rasterised on the CPU every frame, which is what made scrolling stutter. It comes back
// a moment after the scrolling stops.
let scrollWatch = false;
function watchScrolling() {
  if (scrollWatch) return;
  scrollWatch = true;
  const root = document.documentElement;
  let timer = 0;
  document.addEventListener('scroll', () => {
    if (!timer) root.dataset.scrolling = '';
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { timer = 0; delete root.dataset.scrolling; }, 180);
  }, { capture: true, passive: true });
}

export function registerGlass(el: HTMLElement, options: GlassOptions = {}): () => void {
  if (!refractionSupported()) return () => {};
  watchScrolling();
  const lens = !!options.lens;
  const { filter, image, maps } = createFilter(lens);
  entries.set(el, { filter, image, maps, lens, key: '' });
  const value = `url(#${filter.id})`;
  el.style.backdropFilter = value;
  el.style.setProperty('-webkit-backdrop-filter', value);
  observer ??= new ResizeObserver(list => { for (const item of list) update(item.target as HTMLElement); });
  observer.observe(el);
  update(el);
  return () => {
    observer?.unobserve(el);
    entries.delete(el);
    filter.remove();
    el.style.backdropFilter = '';
    el.style.removeProperty('-webkit-backdrop-filter');
  };
}
