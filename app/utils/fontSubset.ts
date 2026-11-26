// app/utils/fontSubset.ts
/**
 * Subset a TrueType font to the given text with HarfBuzz (hb-subset.wasm from harfbuzzjs, served from /fonts).
 * @pdf-lib/fontkit's own subsetter drops most CJK glyphs, so the PDF exporter embeds this pre-subset font instead.
 */

interface HbSubsetExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_set_add(set: number, codepoint: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

let hbPromise: Promise<HbSubsetExports> | null = null;

async function loadHarfBuzz(url: string): Promise<HbSubsetExports> {
  if (!hbPromise) {
    hbPromise = fetch(url)
      .then(res => {
        if (!res.ok) throw new Error(`HarfBuzz 加载失败: ${res.status}`);
        return res.arrayBuffer();
      })
      .then(bytes => WebAssembly.instantiate(bytes))
      .then(({ instance }) => instance.exports as unknown as HbSubsetExports)
      .catch(error => {
        hbPromise = null;
        throw error;
      });
  }
  return hbPromise;
}

/** Returns a font containing only the glyphs needed for `text` (plus .notdef). */
export async function subsetFont(fontBytes: ArrayBuffer, text: string, wasmUrl = '/fonts/hb-subset.wasm'): Promise<Uint8Array> {
  const hb = await loadHarfBuzz(wasmUrl);
  const fontPtr = hb.malloc(fontBytes.byteLength);
  let blob = 0;
  let face = 0;
  let input = 0;
  let subset = 0;
  let result = 0;
  try {
    new Uint8Array(hb.memory.buffer).set(new Uint8Array(fontBytes), fontPtr);
    blob = hb.hb_blob_create(fontPtr, fontBytes.byteLength, 2 /* HB_MEMORY_MODE_WRITABLE */, 0, 0);
    face = hb.hb_face_create(blob, 0);
    hb.hb_blob_destroy(blob);
    blob = 0;
    input = hb.hb_subset_input_create_or_fail();
    if (!input) throw new Error('字体子集化失败');
    const unicodes = hb.hb_subset_input_unicode_set(input);
    for (const char of new Set(text || ' ')) {
      const code = char.codePointAt(0);
      if (code !== undefined) hb.hb_set_add(unicodes, code);
    }
    subset = hb.hb_subset_or_fail(face, input);
    hb.hb_subset_input_destroy(input);
    input = 0;
    if (!subset) throw new Error('字体子集化失败');
    result = hb.hb_face_reference_blob(subset);
    const offset = hb.hb_blob_get_data(result, 0);
    const length = hb.hb_blob_get_length(result);
    return new Uint8Array(hb.memory.buffer, offset, length).slice();
  } finally {
    if (result) hb.hb_blob_destroy(result);
    if (subset) hb.hb_face_destroy(subset);
    if (input) hb.hb_subset_input_destroy(input);
    if (face) hb.hb_face_destroy(face);
    if (blob) hb.hb_blob_destroy(blob);
    hb.free(fontPtr);
  }
}
