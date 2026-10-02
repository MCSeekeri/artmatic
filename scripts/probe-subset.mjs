/**
 * 一次性验证脚本：HarfBuzz WASM 子集化在本机是否真的可用、体积与耗时各是多少。
 *
 * 不进产品代码、不进测试套件 —— 它读的是本机系统字体（许可不允许分发），
 * 所以只作为开发期的探针存在。ADR 里的实测数字由它产出。
 *
 *   node scripts/probe-subset.mjs
 */
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const WASM = 'node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm';

async function loadHb() {
  const bytes = await readFile(WASM);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
}

function subset(h, src /* Uint8Array */, glyphs) {
  const fontPtr = h.malloc(src.byteLength);
  // malloc 之后才取视图：它可能刚触发过内存增长，旧视图会 detach。
  new Uint8Array(h.memory.buffer).set(src, fontPtr);

  const blob = h.hb_blob_create(fontPtr, src.byteLength, 2 /* WRITABLE */, 0, 0);
  const face = h.hb_face_create(blob, 0);
  h.hb_blob_destroy(blob);

  const input = h.hb_subset_input_create_or_fail();
  const set = h.hb_subset_input_unicode_set(input);
  for (const ch of glyphs) h.hb_set_add(set, ch.codePointAt(0));
  if (h.hb_subset_input_set_drop_hints) h.hb_subset_input_set_drop_hints(input, 1);

  const out = h.hb_subset_or_fail(face, input);
  h.hb_subset_input_destroy(input);
  if (!out) throw new Error('hb_subset_or_fail 返回 0');

  const rb = h.hb_face_reference_blob(out);
  const len = h.hb_blob_get_length(rb);
  const off = h.hb_blob_get_data(rb, 0);
  // 先 slice 再销毁：这是堆上的视图，不是拷贝。
  const result = len ? new Uint8Array(h.memory.buffer, off, len).slice() : new Uint8Array(0);

  h.hb_blob_destroy(rb);
  h.hb_face_destroy(out);
  h.hb_face_destroy(face);
  h.free(fontPtr);
  return result;
}

const wasmSize = (await readFile(WASM)).byteLength;
const h = await loadHb();
console.log(`wasm: ${(wasmSize / 1024).toFixed(0)} KB`);
const probes = ['hb_subset_or_fail', 'hb_subset_input_set_drop_hints', 'hb_set_add', 'malloc'];
for (const name of probes) console.log(`  导出 ${name}: ${typeof h[name]}`);
console.log('');

const GLYPHS = '高浓度CO₂胁迫下C₃杨树与C₄玉米的生理和分子响应差异 中文混排测试标题 0123456789';

for (const file of process.argv.slice(2)) {
  const src = await readFile(file);
  try {
    const t0 = performance.now();
    const out = subset(h, src, GLYPHS);
    const t1 = performance.now();
    console.log(
      `${file}\n  全量 ${(src.byteLength / 1024).toFixed(0)} KB → 子集 ${(out.byteLength / 1024).toFixed(1)} KB ` +
        `(${((out.byteLength / src.byteLength) * 100).toFixed(2)}%)  耗时 ${(t1 - t0).toFixed(1)} ms`,
    );
    // 头部魔数校验：0x00010000 = TrueType
    const magic = (out[0] << 24) | (out[1] << 16) | (out[2] << 8) | out[3];
    console.log(`  头部 0x${(magic >>> 0).toString(16)}   ${out.byteLength > 0 ? 'OK' : '空结果！'}`);
  } catch (err) {
    // HarfBuzz 只吃 SFNT —— woff/woff2 走到这里。产品代码里的对策是
    // 「不做子集化，原样内联」（见 isSubsettable）。
    console.log(`${file}\n  不可子集化：${err.message}`);
  }
}
