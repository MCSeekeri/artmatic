# src/exporters/ —— 导出

`export-runner`（逐帧驱动）+ `frame-sink`（webcodecs / png-sequence / gif）+
`mixdown`（纯混流）+ `gif-plan`（GIF 的纯计算：尺寸 / 抽帧 / 延迟）。

**何时读我**：改导出；加一种格式；动帧号换算 / 进度口径 / 落盘方式时。

相关：`src/core/AGENTS.md`（容量预算决定「内存还是流式」）、`src/audio/AGENTS.md`（混流）、
`tests/e2e/AGENTS.md`（导出的磁盘纪律）、根 `AGENTS.md` 硬约束 1.1（导出是紧循环）。

---

- **音频包络求值不在本目录**：`mixdown` 逐样本调 `core/audio-envelope.ts` 的
  `audioClipGainAt`（gain 曲线 × `fadeSec` × `fadeIn` / `fadeOut` × `gainDb`）。预览播放
  （`audio/player.ts`）对的是**同一个函数**。别在这里另写一份斜坡 —— 两边各写一份的
  形态是「预览听着对、导出多了一段渐入」，没有人会去逐帧比对。
- **「哪些片段出声」也不在本目录**：`mixdown` 只消费 `core/audio-plan.ts` 的
  `AudioSpan[]`（独立音频片段 + 未静音的视频内嵌音轨）。视频音轨要在调 `mixdown`
  之前 `await prepareProjectVideoAudio`（解码是异步的，混流是同步的）。
- 取样按 **`buf.sampleRate`** 映射并线性插值，不能假设素材是 48 kHz：`decodeAudio`
  给的是 44.1 kHz，视频容器里还可能是任意采样率（写死 48k 会让导出比预览快 8.8%）。
- 所有导出走统一 `FrameSink`（`exporters/frame-sink.ts`）：`webcodecs`（主路径）、
  `png-sequence`（永远可用的逃生舱）、`gif`（**分享格式**：256 色、无音轨，
  但哪儿都能直接播）。**浏览器没有 GIF 硬件编码**，它是唯一纯 CPU 的后端，
  也是唯一会**主动降分辨率与降帧率**的格式。
- **`runExport` 的 `opts.size` / `opts.frameStep` / `opts.frameRange` 只该给 GIF
  这类自带尺寸、帧率与区间约定的格式用。** 渲染分辨率就是 `size`（不做事后重采样
  —— 缩放是又一次采样，而且像素少一个量级、后面量化与 LZW 的成本跟着低）；
  `frameStep` 跳过源帧，但每个被渲的帧仍按**绝对帧号**求值，所以
  「seek(f) ≡ 顺序 step f 次」不受影响。真正的副作用是**反馈类特效
  （`u_feedback`）的帧历史步长会变大** —— 与预览的降帧率档位是同一件事，代价已知。
  进度分母必须换成 `ceil((to - from) / step)`，否则 step > 1 时进度条永远到不了 100%。
- **区间传帧号（`frameRange`，左闭右开），不传秒。** 秒 → 帧号的换算只允许有
  一处（`gif-plan.ts`），否则「面板说 6 帧、实际渲出 7 帧」这类错位迟早出现；
  `runExport` 只负责再夹一次（它是公共入口，不能指望调用方都夹好）。
- **GIF 的体积 ≈ 帧数 × 像素数**，所以面板上真正的两个旋钮是「宽度」和**「区间」**
  （只导几秒）。24 秒的片子整段导成 480px GIF 是十几 MB —— 那已经超出「能发出去」
  的范围了。区间输入框的 min/max 互相钳制（`start.max = end`），但**别指望它挡住
  一切**：`planGif` 自己会把区间夹进 `[0, duration]` 并保证至少留一帧，
  0 帧会让 GifSink 写出那个 1 字节文件。
- **GIF 的逐帧延迟必须用「累计取整求差」**（`exporters/gif-plan.ts::gifFrameDelays`）：
  GIF 只存整数厘秒，逐帧写 `round(1000 / fps)` 会**每帧都往同一个方向掉**。
  实测 60fps → 25fps（步长 2，每帧真值 3.333cs）跑 300 帧会漂掉**整整 1 秒** ——
  静态截图上完全看不出来，只有跟着音乐看才会发现。所以 GIF 的帧率档位**只能取
  能整除 100 的值**（10 / 12.5 / 20 / 25），15 这种无论怎么取整都会漂。
- **GIF 用逐帧局部色表**（每帧 +768 字节）：全局色表要么把整段 RGBA 屯在内存里，
  要么渲两遍；而对逐帧色彩剧变的算法 / 故障素材，局部色表的画质也明显更好。
- **gifenc 是惰性写头的**：`GIF89a` + 逻辑屏描述符 + 色表 + NETSCAPE 循环块都由
  **第一帧**的 `writeFrame` 顺带写出。一帧都没写就 `finish()`，得到的是**只有
  trailer 的 1 字节文件** —— 那是次「成功」的空下载，比报错更难查。
  `GifSink.finalize` 在这里挡死。
- **数 GIF 帧数绝不能按 0x2C 字节计数**：那是图像描述符的标记，但 LZW 压缩数据里
  同样大量出现，实测能数出上千「帧」。唯一可靠的办法是按块结构遍历
  （`tests/e2e/export-gif.spec.ts` 的 `parseGif`，顺带也证明了结构合法）。
- **纯 CPU 编码的路径要把 `yieldEvery` 调小**（GIF 传 1）：量化一帧就是几十毫秒，
  默认的「10 帧让渡一次」会让取消按钮半秒才响应。默认值 10 是给 GPU 路径定的。
- **顺序纪律：`runExport` 里 `setExportSize` 必须早于 `configure`。**
  `configure` 需要 `opts.canvas` —— `Output` 只有 `addVideoTrack`、**没有
  `removeVideoTrack`**，而 mediabunny 的 `CanvasSource` 在**构造时**读 canvas 尺寸并缓存
  `VideoFrame` 工厂，所以不可能「先建源、事后再换 canvas」。顺序反了会产出错尺寸文件
  且控制台无提示。`Mp4Sink.configure` 会**交叉校验** `canvas.width/height` 与声明的 `size`。
- mediabunny 生命周期：加轨（`addVideoTrack` / `addAudioTrack`）→ `output.start()` →
  源 `.add(样本)` → `finalize()`。音频**建源 + 加轨**在 `configure`（start 前必须建好），
  灌 PCM 在第一次 `submit` 之前（`add()` 断言已 started）。灌早了报 `Output has not started`。
- **H.264 走四档阶梯**（`mp4-sink.ts::MP4_CODEC_LADDER`）：
  `avc1.4d0028`(Main 4.0) → `avc1.4d401f`(Main 3.1) → `avc1.42e028`(Baseline 4.0) →
  `avc1.42e01e`(Baseline 3.1)。无硬编的机器只有 OpenH264 的 **Constrained Baseline**，
  写死 Main 会把它们误判成「不支持 WebCodecs」。baseline 必须留 **4.0** 那档：
  3.1 的 coded area 上限 921600 = **720p**，1080p 被拒并报
  `the maximum coded area (921600) supported by the AVC level (3.1)` —— **别把这条读成
  「H.264 不支持」**。探测用 `probeMp4Codec()`（带 `avc: { format: 'avc' }`，与 mediabunny
  真实配置同构），选中的串必须交给 `CanvasSource` 的 `fullCodecString`，否则 mediabunny
  会自己拼一个 Main，阶梯等于没做。另：`about:blank` 不是 secure context，
  `VideoEncoder` 压根不存在，探测必须起 `http://localhost`。
- 无头环境里硬件编解码会失效 ⇒ E2E 只能断言产物**可解析**（ftyp/moov/avc1/mp4a），
  不能断言编码速度。「盒子对」也不等于「能播」—— 真正验证要把产物喂给浏览器 `<video>`
  读出 duration / 尺寸 / 非黑像素。
- **磁盘纪律**（这个项目的导出是会产生真实大文件的）：E2E 一律 320×180 / 0.5s（15 帧），
  产物落 `os.tmpdir()`，`afterEach` **无条件**删目录（断言失败时也删），并有体积上限断言
  （`< 1 MB`）。**不要为了「看得更清楚」把 E2E 时长调大** —— 长时导出稳定性是手工验一次的事。
- **落盘方式由体积决定**（见 `src/core/AGENTS.md`）：预估超过 `exportMemoryMB` 就先要一个保存位置、
  边编边写（`Platform.saveStream`）；否则在内存里产完再 `download()`。
  内存那条路的收场是**崩**（标签页 OOM 会把没保存的编辑一起带走），所以它是唯一
  按容量裁的导出路径。预估要取**峰值**而不是成品体积：PNG 那条的峰值 ≈ 3 × 成品
  （全部帧 + `zipSync` 产出的整包 + 为 `Blob` 复制的那一份），按成品算会放过本该
  走流式的导出。并且在**开跑之前**问 —— `showSaveFilePicker` 要求瞬时激活，
  逐帧循环里再问就晚了。
