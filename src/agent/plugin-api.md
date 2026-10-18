## 1. File shape

A plugin is **one ESM file**. No imports, no relative modules, no top-level side
effects, no DOM / WebGL access at module scope (the host imports your file into
the page realm, but execution happens later, inside the renderer).

```js
export const plugin = {
  format: 'artmatic-plugin',
  apiVersion: 1,
  id: 'my-plugin',                 // [a-z0-9][a-z0-9._-]*, <= 64
  name: 'My plugin',
  author: 'you', version: '1.0.0', license: 'MIT',
  effects: [ /* see section 3 */ ],
  generators: [ /* see section 4 */ ],
};
```

`effects` and `generators` may be omitted, but at least one must be non-empty.
Every `id` inside the arrays is **local**; the host exposes it as
`"<plugin id>/<local id>"`. Use local ids inside the source, qualified ids when
you call `artmatic_add_effect` / `artmatic_add_clip`.

## 2. Parameters (`params`)

`params` is an array of plain objects. All variants share `key`, `labelKey`
(a plain string is fine - it is shown as-is) and `type`.

| type | required fields | notes |
|---|---|---|
| `range` | `min`, `max`, `step`, `defaultValue` | the only type that can be keyframed |
| `select` | `defaultValue`, `options: [{ value, labelKey }]` | dispatched as an `int` index, see section 5 |
| `checkbox` | `defaultValue` (0 or 1) | dispatched as `int` |
| `color` | `defaultValue` (`#rrggbb`) | dispatched as `vec3` in 0..1 |
| `bitmask` | `bits`, `defaultValue`, `groups` | generator-only in practice |
| `pattern` | `defaultValue` (string) | generator-only |
| `text` | `defaultValue` (string) | not keyframable |

Keep keys short and stable: they become the uniform names `u_<key>`.

## 3. Effect definition

```js
{
  id: 'scanline',
  name: 'Scanline',
  desc: 'A moving bright line.',
  category: 'style',                 // style|color|glitch|geometry|blur|signal
  tags: ['overlay'],
  params: [
    { key: 'amount', labelKey: 'Amount', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
    { key: 'tint',   labelKey: 'Tint',   type: 'color', defaultValue: '#ffffff' },
  ],
  shader: {
    // fragment WITHOUT the shared head (printed above this guide)
    fragment: `
void main() {
  vec4 src = texture(u_texture, vUv);
  float y = fract(vUv.y + u_time * 0.2);
  float line = smoothstep(0.02, 0.0, abs(y - 0.5));
  outColor = vec4(mix(src.rgb, u_tint, line * u_amount), src.a);
}`,
    setUniforms: (gl, locs, values) => {
      const a = locs.u_amount; if (a) gl.uniform1f(a, Number(values.amount) || 0);
      const t = locs.u_tint;   if (t) {
        const hex = String(values.tint || '#ffffff');
        const n = parseInt(hex.slice(1), 16);
        gl.uniform3f(t, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
      }
    },
  },
}
```

Optional `shader` fields (only use them when you actually need them):

- `prePasses: [{ fragment, linearFilter?, feedback?, delayedInput? }]` - full-screen
  passes before the main pass. The first reads the effect input, the last one's
  output becomes `u_texture` of the main pass. **Dispatch your parameters in every
  pass that declares them** (the host calls `setUniforms` once per pass).
- `feedback: true` - allocate a per-instance history texture (`u_feedback`).
  Required if the fragment samples `u_feedback`; otherwise it reads an unbound
  texture and looks like "no trail" with no error.
- `hdrFeedback: true` - 16-bit history for slow state accumulation.
- `linearFilter` / `opaqueOutput` / `stateful` - see the type definitions.

## 4. Generator definition (`realtime` only)

```js
{
  id: 'ripple',
  name: 'Ripple',
  params: [
    { key: 'freq', labelKey: 'Frequency', type: 'range', min: 1, max: 40, step: 0.5, defaultValue: 12 },
    { key: 'amp',  labelKey: 'Amplitude', type: 'range', min: 0, max: 1, step: 0.01, defaultValue: 0.5 },
  ],
  fragment: `
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float v = sin(r * u_freq * 6.2831 - u_time * 2.0) * exp(-r * 4.0) * u_amp;
  vec3 c = mix(vec3(0.02, 0.03, 0.05), vec3(0.6, 0.9, 1.0), 0.5 + 0.5 * v);
  outColor = vec4(c, 1.0);
}`,
  setUniforms: (gl, locs, values) => {
    const f = locs.u_freq; if (f) gl.uniform1f(f, Number(values.freq) || 0);
    const a = locs.u_amp;  if (a) gl.uniform1f(a, Number(values.amp) || 0);
  },
}
```

`bake` and `sim` generators are **not** pluggable: their implementation functions
have to run in a Worker or satisfy a deterministic step contract that the host
validates. `realtime` is enough for full-screen procedural scenes.

**Select parameters cannot be dispatched with `uniform1f`.** Map the string value
to an integer index yourself and write it with `uniform1i`, as section 5 shows.

## 5. Dispatch rules (the silent-failure list)

- **Uniform type must match the declaration.** Writing an `int` with
  `uniform1f` (or a `float` with `uniform1i`) raises `INVALID_OPERATION` and
  **silently does nothing** - the value stays 0 and the parameter looks dead.
- `u_time` is **seconds**, not an accumulated phase. If your effect has a `speed`
  parameter, compute the phase in closed form: `float phase = u_time * u_speed;`.
  Never keep state in JS between frames.
- All randomness must be reproducible: use `u_seed` (per-frame seed) or a hash of
  the coordinates. Never call `Math.random()` inside `setUniforms`.
- Anything your fragment declares as `uniform ... u_<key>;` and never reads is
  reported as `dropped-uniform` - that means the parameter will do nothing.
  Declare only what you use.
- `half`, `input`, `output`, `filter` are reserved words in GLSL ES 3.00. Do not
  use them as variable names.

## 6. Workflow

1. `artmatic_plugin_try({ id, name, source })` - validates the manifest, imports
   the module and compiles every shader with the **real** GL context. Returns
   `effects` / `generators` (qualified ids) and a list of issues with `path` and
   `detail`.
2. Fix the source based on the issues and call `plugin_try` again with the same
   id (it hot-replaces the previous draft).
3. Once the status is `ok`, use the qualified id in `artmatic_add_effect` or
   `artmatic_add_clip({ kind: 'algo', generator: '<qualified id>' })` and take a
   screenshot with `artmatic_render_frame`.
4. `artmatic_plugin_install({ id })` - asks the user for approval, then writes
   `<project>/plugins/<id>.js`. Without a project directory the plugin stays in
   memory for this session only.

## 7. Minimal checklist before calling `plugin_try`

- [ ] `format: 'artmatic-plugin'`, `apiVersion: 1`, lowercase `id`
- [ ] at least one effect or generator
- [ ] every `params[].key` is unique and matches a `u_<key>` used in `setUniforms`
- [ ] fragment does **not** redeclare any uniform from the shared head
- [ ] `setUniforms` writes every parameter (otherwise the parameter is dead)
- [ ] no `Math.random()`, no `Date.now()`, no state kept between frames
