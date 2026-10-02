/**
 * font/subset-hb.ts — 用 HarfBuzz 的 WASM 构建做字体子集化（ADR-003 规则 ①）。
 *
 * ## 为什么必须做这件事
 *
 * 光栅化后端（snapDOM）走的是「把 DOM 序列化成 SVG 再栅格化」，字体必须**内联**
 * 进那份 SVG —— 否则字形会回落到别的字体（实测 `embedFonts:false` 的差异量级
 * 11.297%，与故意换成另一个字体 10.742% 几乎相同，等于换了字体）。
 *
 * 而内联成本与字体体积成正比：实测 **≈ 4 µs/KB 内联 + 0.7 ms 固定开销**。
 * 一个 9.74 MB 的中文字体因此是 **129.3 ms/帧**；裁到 12 KB 之后是 **0.7 ms/帧**，
 * 而且**逐像素零差异**。差了近 185 倍。
 *
 * ## 为什么是 harfbuzzjs 而不是 subset-font
 *
 * | | harfbuzzjs | subset-font |
 * |---|---|---|
 * | 许可 | MIT | BSD-3 |
 * | 传递依赖 | **0 个** | harfbuzzjs + fontverter + p-limit |
 * | 浏览器 | 原生 ESM，`exports` 里有 `./dist/*.wasm` 供打包器取用 | 返回 Node `Buffer`，要 polyfill |
 *
 * 本项目运行时依赖本来就只有 2 个，多一个壳包和它的 3 个依赖不划算。
 *
 * ## wasm 是懒加载的
 *
 * 651 KB 的 `harfbuzz-subset.wasm` **不进主 bundle**：只有第一次真的要子集化
 * 时才 `fetch` + 实例化。首屏零成本。
 */

/** 只声明用到的导出。其余符号存在但不在这里暴露。 */
interface HbSubsetExports {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(
    data: number,
    length: number,
    mode: number,
    userData: number,
    destroy: number,
  ): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, lengthPtr: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set_drop_hints?(input: number, value: number): void;
  hb_subset_or_fail(face: number, input: number): number;
  hb_set_add(set: number, codepoint: number): void;
}

/** `HB_MEMORY_MODE_WRITABLE`：允许 HarfBuzz 就地改这块内存。 */
const HB_MEMORY_MODE_WRITABLE = 2;

let instance: Promise<HbSubsetExports> | null = null;

/**
 * 载入并实例化 subset wasm。
 *
 * **不用 `WebAssembly.instantiateStreaming`**：它要求响应带
 * `Content-Type: application/wasm`，而本项目的 e2e 服务器是自建的，
 * MIME 处理是已知雷区（`.mjs` 就踩过一次）。走 arrayBuffer 零 MIME 依赖。
 */
export async function loadSubsetWasm(source: string | ArrayBuffer | Uint8Array): Promise<HbSubsetExports> {
  let bytes: ArrayBuffer;
  if (typeof source === 'string') {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`harfbuzz-subset.wasm 加载失败：HTTP ${res.status}`);
    bytes = await res.arrayBuffer();
  } else if (source instanceof Uint8Array) {
    bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
  } else {
    bytes = source;
  }
  const { instance: inst } = await WebAssembly.instantiate(bytes, {});
  return inst.exports as unknown as HbSubsetExports;
}

/** 应用内用：从 Vite 提供的静态资源 URL 载入（只做一次）。 */
async function hb(): Promise<HbSubsetExports> {
  if (!instance) {
    const url = new URL('harfbuzzjs/dist/harfbuzz-subset.wasm', import.meta.url).href;
    instance = loadSubsetWasm(url);
  }
  return instance;
}

/**
 * 裁出只含 `glyphs` 里那些码点的子集字体。返回 SFNT（TTF）字节。
 *
 * ⚠️ 四个坑，每一个都会表现为「大多数时候正常、偶尔坏掉」：
 *
 * 1. **`memory.buffer` 的视图会在 wasm 内存增长后 detach。**
 *    官方示例开头抓了一次 `new Uint8Array(exports.memory.buffer)` 就一路用到底，
 *    那是运气 —— `malloc` 会触发 `memory.grow`，旧视图随之失效，写入静默丢失。
 *    **每一次用到堆视图之前都重新取一遍。**
 *
 * 2. **`hb_blob_get_data` 返回的是堆上的指针，不是拷贝。**
 *    必须 `.slice()` 出来再销毁 blob，否则拿到的是一块随时会被覆写的内存。
 *
 * 3. **`hb_blob_create` 用了 `HB_MEMORY_MODE_WRITABLE`**，HarfBuzz 可能直接
 *    写进我们 malloc 的那块 buffer —— 所以源数据要到最后才 `free`。
 *
 * 4. **必须 `for (const ch of glyphs)`**（按**码点**迭代）。
 *    改成 `for (let i = 0; i < s.length; i++)` 会把 emoji / 生僻字的代理对切碎。
 */
export async function subsetFont(
  fontBytes: ArrayBuffer | Uint8Array,
  glyphs: string,
  wasm?: HbSubsetExports,
): Promise<Uint8Array> {
  const h = wasm ?? (await hb());

  const src = fontBytes instanceof Uint8Array ? fontBytes : new Uint8Array(fontBytes);
  const fontPtr = h.malloc(src.byteLength);
  if (!fontPtr) throw new Error('harfbuzz: malloc 失败');
  // 坑 1：malloc 之后才取视图（它可能刚触发过内存增长）。
  new Uint8Array(h.memory.buffer).set(src, fontPtr);

  let blob = 0;
  let face = 0;
  let input = 0;
  let subset = 0;
  let outBlob = 0;
  try {
    blob = h.hb_blob_create(fontPtr, src.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
    face = h.hb_face_create(blob, 0);
    h.hb_blob_destroy(blob);
    blob = 0;

    input = h.hb_subset_input_create_or_fail();
    if (!input) throw new Error('harfbuzz: 创建 subset input 失败');
    const set = h.hb_subset_input_unicode_set(input);
    // 坑 4：for...of 按码点迭代。
    for (const ch of glyphs) {
      const cp = ch.codePointAt(0);
      if (cp !== undefined) h.hb_set_add(set, cp);
    }
    // 丢掉 hinting：对齐技术笔记里 `pyftsubset --no-hinting` 的实测配置，
    // 也是「12 KB / 0.7 ms」那两个数字的量取条件。某些构建没导出这个符号，容错。
    h.hb_subset_input_set_drop_hints?.(input, 1);

    subset = h.hb_subset_or_fail(face, input);
    h.hb_subset_input_destroy(input);
    input = 0;
    if (!subset) throw new Error('harfbuzz: hb_subset_or_fail 失败（字体损坏？）');

    outBlob = h.hb_face_reference_blob(subset);
    const len = h.hb_blob_get_length(outBlob);
    if (len === 0) return new Uint8Array(0);
    const off = h.hb_blob_get_data(outBlob, 0);
    // 坑 2：先 slice 再销毁。
    return new Uint8Array(h.memory.buffer, off, len).slice();
  } finally {
    if (outBlob) h.hb_blob_destroy(outBlob);
    if (subset) h.hb_face_destroy(subset);
    if (input) h.hb_subset_input_destroy(input);
    if (face) h.hb_face_destroy(face);
    if (blob) h.hb_blob_destroy(blob);
    // 坑 3：源数据到这里才释放。
    h.free(fontPtr);
  }
}

/** 已加载的 wasm 体积（字节）。未加载返回 null。测试与 ADR 记录用。 */
export function subsetWasmReady(): boolean {
  return instance !== null;
}
