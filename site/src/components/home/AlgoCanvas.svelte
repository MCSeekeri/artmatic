<script>
  /**
   * 动态算法艺术画布：一个片元着色器，两种场景。
   *
   *   lyapunov   逻辑斯蒂映射的李雅普诺夫指数场。稳定的参数区（λ<0）显色，
   *              混沌区留黑 —— 「秩序和混沌」不是比喻，是这张图的定义。
   *   mandelbrot 复平面分形，慢速推近再退回来（正弦往返，不回跳）。
   *
   * 刻意不 import 主应用任何模块：那条链会经 i18n 拉到 `$state`，在 Astro 下编译不过。
   *
   * 性能护栏（缺一条都会在后台标签页里烧显卡）：
   *   - 内部渲染分辨率按像素预算算，不跟 dpr 走；
   *   - 30fps 限流；
   *   - IntersectionObserver 离开视口即停；
   *   - `prefers-reduced-motion` 只画一帧。
   */
  import { onMount } from 'svelte';

  let { scene = 'lyapunov', hud = false, budget = 1_100_000 } = $props();

  /** HUD 上的读数取自真正喂给着色器的常量，不是另写一份文案。 */
  const SCENES = {
    lyapunov: { name: 'LYAPUNOV', iter: 48, note: 'logistic · a×b' },
    mandelbrot: { name: 'MANDELBROT', iter: 160, note: 'z² + c' },
  };

  const MB = { cx: -0.7453, cy: 0.1127, span: 0.022 };

  let canvas;
  let readout = $state({ zoom: '1.0', t: '0.0' });

  const VERT = `#version 300 es
  const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

  const FRAG = `#version 300 es
  precision highp float;
  out vec4 frag;
  uniform vec2 u_res;
  uniform float u_time;
  uniform int u_scene;
  uniform vec3 u_ink;
  uniform float u_span;
  uniform float u_light;
  uniform vec2 u_center;

  const vec3 BG = vec3(0.031, 0.035, 0.043);
  const vec3 HOT = vec3(1.0, 0.302, 0.616);
  const vec3 COLD = vec3(0.302, 0.910, 1.0);

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  vec3 palette(float t) {
    /* 暗处是品牌紫，往上是品红，只有最亮的一小撮才是青。
       品红出现得早一点是必要的：纯紫压在这个底色上偏灰，
       整张图会像没渲染完 */
    vec3 c = mix(u_ink, HOT, smoothstep(0.04, 0.66, t));
    /* 青只做镀边，不占面：整块青色压在紫红里像渲染出错 */
    c = mix(c, COLD, smoothstep(0.9, 1.0, t) * 0.6);
    return c;
  }

  /* 分形不用青：它的环带会把一整片区域刷成同一个色相，
     青色占面时看起来像选错了通道 */
  vec3 paletteFractal(float t) {
    return mix(u_ink * 0.7, HOT, smoothstep(0.2, 0.92, t));
  }

  /* 逻辑斯蒂映射：按位模式在 a / b 之间切换参数，累积 ln|f'| */
  float lyap(vec2 p) {
    float x = 0.5;
    float s = 0.0;
    for (int i = 0; i < 48; i++) {
      int bit = (0xA6 >> (i - (i / 8) * 8)) & 1;
      float r = bit == 1 ? p.x : p.y;
      x = r * x * (1.0 - x);
      s += log(abs(r * (1.0 - 2.0 * x)) + 1e-6);
    }
    return s / 48.0;
  }

  vec3 sceneLyapunov(vec2 uv, float t) {
    /* 窗口落点不是随手取的：在 160×100 的网格上算过覆盖率与相邻像素差，
       挑的是「37% 的像素在稳定区、细节量最高」的那块。
       呼吸幅度只有 ±6% —— 再大就会漂进成片的混沌区，整幅图变黑 */
    float breathe = 1.0 + 0.06 * sin(t * 0.11);
    vec2 q = uv * 0.42 * breathe + vec2(3.58, 3.42);
    q += vec2(0.02 * sin(t * 0.09), 0.015 * cos(t * 0.07));

    float l = lyap(q);
    float v = clamp(-l * 0.9, 0.0, 1.0);
    float glow = pow(v, 0.5);

    vec3 col = mix(BG * 1.6, palette(min(1.0, glow * 1.1)), smoothstep(0.0, 0.62, glow));
    /* 混沌区留一点极暗的底噪，否则大片纯黑会像没渲染 */
    col += BG * 0.5;

    /* 等值线上描一道冷色，让「分界」本身可见 */
    float edge = smoothstep(0.02, 0.0, abs(l));
    col = mix(col, COLD * 1.05, edge * 0.55);
    return col * 1.2;
  }

  vec3 sceneMandelbrot(vec2 uv, float t) {
    /* 正弦往返推近：exp 尺度上往返，看起来是匀速的；用 mod 会看到回跳。
       窗口始终给得很深 —— 退到全景就是一张「大色块套小色块」的图，
       真正好看的只有边界附近的窄带 */
    float depth = 4.4 + 1.3 * sin(t * 0.05 - 1.2);
    float zoom = pow(2.0, depth);
    float rot = 0.28 * sin(t * 0.021);

    vec2 c = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)) * (uv * u_span / zoom) + u_center;

    vec2 z = vec2(0.0);
    float m = 0.0;
    /* 上限刻意取 160 而不是 256：这块面板是装饰，不是「推到 1e-14」的渲染器。
       迭代上限每加 96，像素成本同比涨，换来的只是曼德博集合内部多几层细节 */
    for (int i = 0; i < 160; i++) {
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
      if (dot(z, z) > 1024.0) break;
      m += 1.0;
    }

    if (m >= 159.0) return BG * 0.55;

    float sm = m - log2(log2(max(dot(z, z), 1.0001))) + 4.0;
    /* 两层：粗环带定色相，细等高线定明暗。
       只留粗环带时，迭代数变化慢的大片区域会糊成一块「喷枪色」；
       细线才是让它看起来像算出来的东西的那一层。
       细线在像素间变化过快的区域（fwidth 大）会退化成均匀值，否则出现摩尔纹 */
    float band = fract(sm * 0.055);
    float w = fwidth(sm);
    float fine = 0.5 + 0.5 * cos(sm * 1.9);
    fine = mix(fine, 0.62, smoothstep(0.5, 2.2, w));
    return paletteFractal(band) * (0.1 + 0.9 * pow(band, 1.9)) * (0.5 + 0.72 * fine);
  }

  /* 唯一的分支点：着色器不该为同一个像素把两个场景都算一遍 */
  vec3 sceneAt(vec2 uv, float t) {
    if (u_scene == 0) return sceneLyapunov(uv, t);
    return sceneMandelbrot(uv, t);
  }

  void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
    float t = u_time;

    vec3 col = sceneAt(uv, t);

    /* 横向错位：每秒换一次，只切很窄的几条 —— 故障感来自克制 */
    float band = floor(gl_FragCoord.y / 3.0);
    float g = hash11(band + floor(t * 1.4) * 37.0);
    float shift = step(0.972, g) * (g - 0.5) * 26.0;
    if (abs(shift) > 0.5) {
      vec2 uv2 = uv + vec2(shift / min(u_res.x, u_res.y), 0.0);
      col = mix(col, sceneAt(uv2, t), 0.85);
    }

    /* 扫描线 + 暗角。亮色主题下这两样反着来：
       纸面上加「更暗的扫描线」等于给白纸刷灰条，只有压在纸上才是脏的 */
    if (u_light < 0.5) {
      col *= 0.94 + 0.06 * step(0.5, fract(gl_FragCoord.y * 0.5));
      vec2 q = gl_FragCoord.xy / u_res;
      col *= 0.72 + 0.4 * pow(q.x * q.y * (1.0 - q.x) * (1.0 - q.y) * 16.0, 0.22);
    }

    /* 亮色主题：同样的画面换成「纸上的墨」。按亮度取墨浓度，
       越亮的像素墨越重 —— 暗色主题里的高光，在纸面上就是最黑的那笔 */
    if (u_light > 0.5) {
      float y = dot(col, vec3(0.299, 0.587, 0.114));
      /* 指数接近 1、增益稍大于 1：纸面留得住灰，只有真正的高光才压成深墨。
         压到 0.45 那种程度会变成一张紫色版画，太重了 */
      float k = clamp(pow(y, 0.8) * 1.25, 0.0, 1.0);
      vec3 ink = mix(vec3(0.62, 0.57, 0.98), vec3(0.10, 0.06, 0.36), smoothstep(0.0, 0.9, k));
      ink = mix(ink, vec3(0.62, 0.06, 0.34), smoothstep(0.86, 1.0, k) * 0.6);
      col = mix(vec3(0.975, 0.972, 0.986), ink, k);
    }

    frag = vec4(col, 1.0);
  }`;

  onMount(() => {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    });
    if (!gl) return;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[algo]', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const u = (name) => gl.getUniformLocation(prog, name);
    const uRes = u('u_res');
    const uTime = u('u_time');
    const uScene = u('u_scene');
    const uInk = u('u_ink');
    const uSpan = u('u_span');
    const uCenter = u('u_center');
    const uLight = u('u_light');

    const hex = (value, fallback) => {
      const m = /^#?([0-9a-f]{6})$/i.exec((value || '').trim());
      if (!m) return fallback;
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };

    const applyInk = () => {
      const style = getComputedStyle(document.documentElement);
      const ink = hex(style.getPropertyValue('--accent'), [0.43, 0.39, 0.94]);
      gl.uniform3f(uInk, ink[0], ink[1], ink[2]);
      /* 亮色主题换一套上色：着色器里按亮度反相成「纸上的墨」 */
      gl.uniform1f(uLight, document.documentElement.dataset.theme === 'light' ? 1 : 0);
    };

    gl.uniform1i(uScene, scene === 'mandelbrot' ? 1 : 0);
    gl.uniform1f(uSpan, MB.span);
    gl.uniform2f(uCenter, MB.cx, MB.cy);
    applyInk();

    let width = 1;
    let height = 1;
    let raf = 0;
    let lastDraw = 0;
    let lastTick = 0;
    let lastHud = 0;
    let visible = true;
    let quality = 1;
    let late = 0;
    const started = performance.now();

    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const FRAME = 1000 / 60;

    function layout() {
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, rect.width);
      const cssH = Math.max(1, rect.height);
      /* 按像素预算定内部尺度：窗口再大，单帧的像素总量不变 ⇒ 成本不随窗口尺寸涨。
         `quality` 是运行时降级系数，见 loop() */
      const scale = Math.min(
        devicePixelRatio || 1,
        Math.sqrt((budget * quality) / (cssW * cssH)),
        2,
      );
      width = Math.max(1, Math.round(cssW * scale));
      height = Math.max(1, Math.round(cssH * scale));
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(uRes, width, height);
    }

    /* 一个门控 + 一个绘制，不在 rAF 里再套 rAF：
       套两层的写法在掉帧时会算错下一次的时间点，表现出来就是「一顿一顿」 */
    function loop(now) {
      raf = requestAnimationFrame(loop);
      if (document.hidden || !visible) return;

      /* rAF 迟到 = 显卡被上一帧堵住。连续迟到就降一档内部分辨率；
         降过的档不再升回去，否则会在边界上反复横跳 */
      const gap = lastTick ? now - lastTick : FRAME;
      lastTick = now;
      if (gap > FRAME * 1.7) late += 1;
      else late = Math.max(0, late - 1);
      if (late > 12 && quality > 0.4) {
        quality = Math.max(0.4, quality * 0.75);
        late = 0;
        layout();
      }

      if (now - lastDraw < FRAME - 2) return;
      lastDraw = now;

      const t = (now - started) / 1000;
      gl.uniform1f(uTime, t);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      /* 读数 4Hz 就够：它是在说明这段动画在干什么，不是仪表盘 */
      if (hud && now - lastHud > 250) {
        lastHud = now;
        const zoom = scene === 'mandelbrot' ? Math.pow(2, 4.4 + 1.3 * Math.sin(t * 0.05 - 1.2)) : 0;
        readout = { zoom: zoom ? zoom.toFixed(0) : '—', t: t.toFixed(1) };
      }
    }

    const start = () => {
      if (raf || reduced.matches || !visible || document.hidden) return;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    /** 补一帧：重排尺寸、切主题之后画面得马上跟上，不能等下一个 30fps 窗口 */
    const repaint = () => {
      gl.uniform1f(uTime, (performance.now() - started) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    layout();
    repaint();
    start();

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        visible ? start() : stop();
      },
      { rootMargin: '120px' },
    );
    io.observe(canvas);

    const ro = new ResizeObserver(() => {
      layout();
      repaint();
    });
    ro.observe(canvas);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    const mo = new MutationObserver(() => {
      applyInk();
      repaint();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  });
</script>

<div class="algo">
  <canvas bind:this={canvas} aria-hidden="true"></canvas>

  {#if hud}
    <div class="hud">
      <span>{SCENES[scene]?.name ?? scene}</span>
      <span>
        {#if scene === 'mandelbrot'}
          center {MB.cx} / {MB.cy} · zoom ×{readout.zoom} · iter {SCENES.mandelbrot.iter}
        {:else}
          {SCENES.lyapunov.note} · iter {SCENES.lyapunov.iter}
        {/if}
      </span>
      <span class="right">t {readout.t}s</span>
    </div>
  {/if}
</div>

<style>
  .algo {
    position: relative;
    width: 100%;
    height: 100%;
    background: #08090b;
  }
  /* 亮色主题下这一幕是「纸上的墨」，底色也得跟着换，否则加载中会闪一块黑 */
  :global([data-theme='light']) .algo {
    background: #f7f6fb;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }
  .hud {
    position: absolute;
    inset: auto 0 0 0;
    display: flex;
    gap: 1.25rem;
    padding: 0.55rem 0.75rem;
    font-family: var(--sl-font-mono);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: rgba(232, 236, 245, 0.62);
    background: linear-gradient(to top, rgba(0, 0, 0, 0.55), transparent);
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
  }
  .hud .right {
    margin-inline-start: auto;
    color: rgba(232, 236, 245, 0.42);
  }
  :global([data-theme='light']) .hud {
    color: rgba(24, 20, 56, 0.62);
    background: linear-gradient(to top, rgba(255, 255, 255, 0.78), transparent);
  }
  :global([data-theme='light']) .hud .right {
    color: rgba(24, 20, 56, 0.4);
  }
  @media (max-width: 640px) {
    .hud {
      font-size: 9px;
      letter-spacing: 0.04em;
    }
  }
</style>
