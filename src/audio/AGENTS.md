# src/audio/ —— 离线音频

离线 FFT · BPM / offset 估计 · 波形桶 · 播放器。
**音频分析一律离线预计算**（给生成器的是「曲线的查表」，`at(t)` 是 t 的纯函数）——
逐帧按 `dt` 推进的有状态量在 seek 下不可复现。

**何时读我**：改 `audio/**`；给算法生成器加一个吃音频 / 频谱 / 特征的东西。

相关：`src/algos/AGENTS.md`（`AlgoFeatureSource` 注入点与 uniform 口径）、
根 `AGENTS.md` 硬约束 1.1 / 1.3。

---

- **预览播放的响度与导出同源**：`player.ts` 给每个片段挂一个 `GainNode`，曲线由
  `core/audio-envelope.ts::sampleAudioEnvelope` 采样（gain 曲线 × `fadeSec` ×
  `fadeIn` / `fadeOut`），用 `setValueCurveAtTime` 排进 WebAudio。导出走
  `exporters/mixdown.ts` 的逐样本求值。**不要在播放器里另写一条淡变斜坡**。
- **音频特征层**（`audio/features.ts` + `algos/feature-source.ts`）：
  - **必须离线预计算**。上游的 `Impulse.step(dt)` / `approach` 是逐帧按 `dt` 推进的有状态量，
    与硬约束 1.1 冲突（seek 不可复现）。这里给的是**曲线的查表**：`at(t)` 是 t 的纯函数。
  - 与频谱**共用一趟 FFT 走查**：`computeSpectrum(buffer, onProgress, onFrame)` 的钩子挂上
    特征累加器。帧数 / hop 由 `planSpectrum()` 唯一定义 —— 自己抄一遍那套算术，
    表现是「特征曲线尾部静默变成 0」。
  - 接口注入（`AlgoFeatureSource`），`render-core` 依然不 import `audio/`。主应用给
    `ProjectAudio`（频谱 + 特征一次算完），lab 给 `createLabFeatures()` 的合成特征。
  - **冲量是闭式的**：`exp(-距今多久 / decay)`，不是累加器。kick / bar 由**拍网格**给
    （JS 侧才拿得到 `BeatGrid`），hit 由 **onset 年龄**给。
  - `u_ages` 是 `vec4`（最近四个 onset 的年龄），没有 onset 时给哨兵 9。
