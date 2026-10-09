/**
 * transitions/catalog-info.ts — 转场的**展示信息**目录：中文名 + 一句话说明。
 *
 * 与 `effects/catalog.ts` 是同一件事的两个面：那个介绍特效，这个介绍转场。
 * 与 `transitions/catalog.ts` 分工也清楚 —— 那个讲「这条转场的着色器要什么」
 * （从上游派生、运行时才知道），这里讲「怎么把它介绍给人看」（手写、编译期可查）。
 *
 * ## 为什么这里破例翻译了
 *
 * `transitions/types.ts` 原本写着「名称与参数名刻意不翻译」——那时界面上只有
 * 一个下拉，显示 `CrossZoom` 还能对着上游文档查。转场过百、又有了缩略图之后，
 * 这条理由反过来了：**列表里全是英文 id 时根本扫不动**，而缩略图已经能表达
 * 「它在怎么切」，名字只需要让人快速定位。
 *
 * 折中办法是**两个都给**：选择器与检查器显示中文名，**上游 id 一并显示**
 * （等宽小字 / 列表视图的标签）——「去上游查这条转场」这条路没有被堵上。
 *
 * ## 参数名仍然不翻译
 *
 * `pixelSize` / `blocksize` / `shadow_colour` 这类**参数名**照旧显示原文：
 * 它们是 GLSL uniform 的名字，翻译之后就对着文档找不到那一行了。
 *
 * ## 新增转场 = 两处
 *
 * 上游加一条转场 → 这里补一条 + 语言表补两条（`tns.name.*` / `tns.desc.*`），
 * 由 `tests/unit/transition-catalog-info.test.ts` 断言「每条转场都有条目 /
 * 没有孤儿条目 / 名字互不重复」变成明确报错，而不是界面上悄悄退回英文 id。
 */

import type { MessageKey } from '../../i18n/locales';

export interface TransitionCatalogEntry {
  /** 中文名。存**文案键**，由 UI 侧 `tr()` 解析（理由同 `effects/types.ts` 的 labelKey）。 */
  nameKey: MessageKey;
  /** 一句话说明。同上。 */
  descKey: MessageKey;
}

/**
 * 目录表。键 = 上游 id（`TransitionEntry.id`）。顺序与 `TRANSITIONS` 的 id 升序一致，
 * 方便与语言表逐行对照。
 */
export const TRANSITION_CATALOG: Record<string, TransitionCatalogEntry> = {
  AdvancedMosaic: { nameKey: 'tns.name.advancedMosaic', descKey: 'tns.desc.advancedMosaic' },
  angular: { nameKey: 'tns.name.angular', descKey: 'tns.desc.angular' },
  BlockDissolve: { nameKey: 'tns.name.blockDissolve', descKey: 'tns.desc.blockDissolve' },
  BookFlip: { nameKey: 'tns.name.bookFlip', descKey: 'tns.desc.bookFlip' },
  Bounce: { nameKey: 'tns.name.bounce', descKey: 'tns.desc.bounce' },
  BowTieHorizontal: { nameKey: 'tns.name.bowTieHorizontal', descKey: 'tns.desc.bowTieHorizontal' },
  BowTieVertical: { nameKey: 'tns.name.bowTieVertical', descKey: 'tns.desc.bowTieVertical' },
  BowTieWithParameter: { nameKey: 'tns.name.bowTie', descKey: 'tns.desc.bowTie' },
  Box: { nameKey: 'tns.name.box', descKey: 'tns.desc.box' },
  burn0: { nameKey: 'tns.name.burn', descKey: 'tns.desc.burn' },
  ButterflyWaveScrawler: { nameKey: 'tns.name.butterflyWave', descKey: 'tns.desc.butterflyWave' },
  cannabisleaf: { nameKey: 'tns.name.cannabisLeaf', descKey: 'tns.desc.cannabisLeaf' },
  chessboard: { nameKey: 'tns.name.chessboard', descKey: 'tns.desc.chessboard' },
  circle: { nameKey: 'tns.name.circle', descKey: 'tns.desc.circle' },
  CircleCrop: { nameKey: 'tns.name.circleCrop', descKey: 'tns.desc.circleCrop' },
  circleopen: { nameKey: 'tns.name.circleOpen', descKey: 'tns.desc.circleOpen' },
  colorphase: { nameKey: 'tns.name.colorPhase', descKey: 'tns.desc.colorPhase' },
  ColourDistance: { nameKey: 'tns.name.colourDistance', descKey: 'tns.desc.colourDistance' },
  'coord-from-in': { nameKey: 'tns.name.coordFromIn', descKey: 'tns.desc.coordFromIn' },
  CrazyParametricFun: { nameKey: 'tns.name.crazyParametric', descKey: 'tns.desc.crazyParametric' },
  crosshatch: { nameKey: 'tns.name.crosshatch', descKey: 'tns.desc.crosshatch' },
  crosswarp: { nameKey: 'tns.name.crosswarp', descKey: 'tns.desc.crosswarp' },
  CrossZoom: { nameKey: 'tns.name.crossZoom', descKey: 'tns.desc.crossZoom' },
  cube: { nameKey: 'tns.name.cube', descKey: 'tns.desc.cube' },
  DefocusBlur: { nameKey: 'tns.name.defocusBlur', descKey: 'tns.desc.defocusBlur' },
  'directional-easing': { nameKey: 'tns.name.directionalEasing', descKey: 'tns.desc.directionalEasing' },
  Directional: { nameKey: 'tns.name.directional', descKey: 'tns.desc.directional' },
  DirectionalScaled: { nameKey: 'tns.name.directionalScaled', descKey: 'tns.desc.directionalScaled' },
  directionalwarp: { nameKey: 'tns.name.directionalWarp', descKey: 'tns.desc.directionalWarp' },
  directionalwipe: { nameKey: 'tns.name.directionalWipe', descKey: 'tns.desc.directionalWipe' },
  dissolve: { nameKey: 'tns.name.dissolve', descKey: 'tns.desc.dissolve' },
  DoomScreenTransition: { nameKey: 'tns.name.doomScreen', descKey: 'tns.desc.doomScreen' },
  doorway: { nameKey: 'tns.name.doorway', descKey: 'tns.desc.doorway' },
  Dreamy: { nameKey: 'tns.name.dreamy', descKey: 'tns.desc.dreamy' },
  DreamyZoom: { nameKey: 'tns.name.dreamyZoom', descKey: 'tns.desc.dreamyZoom' },
  Drop_Zone_Flicker: { nameKey: 'tns.name.dropZoneFlicker', descKey: 'tns.desc.dropZoneFlicker' },
  EdgeTransition: { nameKey: 'tns.name.edge', descKey: 'tns.desc.edge' },
  fade: { nameKey: 'tns.name.fade', descKey: 'tns.desc.fade' },
  fadecolor: { nameKey: 'tns.name.fadeColor', descKey: 'tns.desc.fadeColor' },
  fadegrayscale: { nameKey: 'tns.name.fadeGrayscale', descKey: 'tns.desc.fadeGrayscale' },
  FilmBurn: { nameKey: 'tns.name.filmBurn', descKey: 'tns.desc.filmBurn' },
  flyeye: { nameKey: 'tns.name.flyEye', descKey: 'tns.desc.flyEye' },
  Fold: { nameKey: 'tns.name.fold', descKey: 'tns.desc.fold' },
  fragment: { nameKey: 'tns.name.fragment', descKey: 'tns.desc.fragment' },
  GlitchDisplace: { nameKey: 'tns.name.glitchDisplace', descKey: 'tns.desc.glitchDisplace' },
  GlitchMemories: { nameKey: 'tns.name.glitchMemories', descKey: 'tns.desc.glitchMemories' },
  GridFlip: { nameKey: 'tns.name.gridFlip', descKey: 'tns.desc.gridFlip' },
  heart: { nameKey: 'tns.name.heart', descKey: 'tns.desc.heart' },
  hexagonalize: { nameKey: 'tns.name.hexagonalize', descKey: 'tns.desc.hexagonalize' },
  HorizontalClose: { nameKey: 'tns.name.horizontalClose', descKey: 'tns.desc.horizontalClose' },
  HorizontalOpen: { nameKey: 'tns.name.horizontalOpen', descKey: 'tns.desc.horizontalOpen' },
  HSVfade: { nameKey: 'tns.name.hsvFade', descKey: 'tns.desc.hsvFade' },
  InvertedPageCurl: { nameKey: 'tns.name.invertedPageCurl', descKey: 'tns.desc.invertedPageCurl' },
  kaleidoscope: { nameKey: 'tns.name.kaleidoscope', descKey: 'tns.desc.kaleidoscope' },
  LeftRight: { nameKey: 'tns.name.leftRight', descKey: 'tns.desc.leftRight' },
  LinearBlur: { nameKey: 'tns.name.linearBlur', descKey: 'tns.desc.linearBlur' },
  luminance_melt: { nameKey: 'tns.name.luminanceMelt', descKey: 'tns.desc.luminanceMelt' },
  morph: { nameKey: 'tns.name.morph', descKey: 'tns.desc.morph' },
  mosaic_transition: { nameKey: 'tns.name.mosaicTransition', descKey: 'tns.desc.mosaicTransition' },
  Mosaic: { nameKey: 'tns.name.mosaic', descKey: 'tns.desc.mosaic' },
  multiply_blend: { nameKey: 'tns.name.multiplyBlend', descKey: 'tns.desc.multiplyBlend' },
  old_tv_lost_signal: { nameKey: 'tns.name.oldTvLostSignal', descKey: 'tns.desc.oldTvLostSignal' },
  Overexposure: { nameKey: 'tns.name.overexposure', descKey: 'tns.desc.overexposure' },
  parametric_glitch: { nameKey: 'tns.name.parametricGlitch', descKey: 'tns.desc.parametricGlitch' },
  perlin: { nameKey: 'tns.name.perlin', descKey: 'tns.desc.perlin' },
  pinwheel: { nameKey: 'tns.name.pinwheel', descKey: 'tns.desc.pinwheel' },
  pixelize: { nameKey: 'tns.name.pixelize', descKey: 'tns.desc.pixelize' },
  polar_function: { nameKey: 'tns.name.polarFunction', descKey: 'tns.desc.polarFunction' },
  PolkaDotsCurtain: { nameKey: 'tns.name.polkaDots', descKey: 'tns.desc.polkaDots' },
  powerKaleido: { nameKey: 'tns.name.powerKaleido', descKey: 'tns.desc.powerKaleido' },
  PuzzleRight: { nameKey: 'tns.name.puzzleRight', descKey: 'tns.desc.puzzleRight' },
  Radial: { nameKey: 'tns.name.radial', descKey: 'tns.desc.radial' },
  randomNoisex: { nameKey: 'tns.name.randomNoise', descKey: 'tns.desc.randomNoise' },
  randomsquares: { nameKey: 'tns.name.randomSquares', descKey: 'tns.desc.randomSquares' },
  Rectangle: { nameKey: 'tns.name.rectangle', descKey: 'tns.desc.rectangle' },
  RectangleCrop: { nameKey: 'tns.name.rectangleCrop', descKey: 'tns.desc.rectangleCrop' },
  Revolve_Left: { nameKey: 'tns.name.revolve', descKey: 'tns.desc.revolve' },
  ripple: { nameKey: 'tns.name.ripple', descKey: 'tns.desc.ripple' },
  Rolls: { nameKey: 'tns.name.rolls', descKey: 'tns.desc.rolls' },
  rotate_scale_fade: { nameKey: 'tns.name.rotateScaleFade', descKey: 'tns.desc.rotateScaleFade' },
  RotateScaleVanish: { nameKey: 'tns.name.rotateScaleVanish', descKey: 'tns.desc.rotateScaleVanish' },
  rotateTransition: { nameKey: 'tns.name.rotate', descKey: 'tns.desc.rotate' },
  'scale-in': { nameKey: 'tns.name.scaleIn', descKey: 'tns.desc.scaleIn' },
  SimpleFlip: { nameKey: 'tns.name.simpleFlip', descKey: 'tns.desc.simpleFlip' },
  SimpleZoom: { nameKey: 'tns.name.simpleZoom', descKey: 'tns.desc.simpleZoom' },
  SimpleZoomOut: { nameKey: 'tns.name.simpleZoomOut', descKey: 'tns.desc.simpleZoomOut' },
  Slides: { nameKey: 'tns.name.slides', descKey: 'tns.desc.slides' },
  splitSlideInHorizontal: { nameKey: 'tns.name.splitSlideInH', descKey: 'tns.desc.splitSlideInH' },
  splitSlideInOutHorizontal: { nameKey: 'tns.name.splitSlideInOutH', descKey: 'tns.desc.splitSlideInOutH' },
  splitSlideInOutVertical: { nameKey: 'tns.name.splitSlideInOutV', descKey: 'tns.desc.splitSlideInOutV' },
  splitSlideInVertical: { nameKey: 'tns.name.splitSlideInV', descKey: 'tns.desc.splitSlideInV' },
  splitSlideOutHorizontal: { nameKey: 'tns.name.splitSlideOutH', descKey: 'tns.desc.splitSlideOutH' },
  splitSlideOutVertical: { nameKey: 'tns.name.splitSlideOutV', descKey: 'tns.desc.splitSlideOutV' },
  squareswire: { nameKey: 'tns.name.squaresWire', descKey: 'tns.desc.squaresWire' },
  squeeze: { nameKey: 'tns.name.squeeze', descKey: 'tns.desc.squeeze' },
  StarWipe: { nameKey: 'tns.name.starWipe', descKey: 'tns.desc.starWipe' },
  static_wipe: { nameKey: 'tns.name.staticWipe', descKey: 'tns.desc.staticWipe' },
  StaticFade: { nameKey: 'tns.name.staticFade', descKey: 'tns.desc.staticFade' },
  StereoViewer: { nameKey: 'tns.name.stereoViewer', descKey: 'tns.desc.stereoViewer' },
  StripDatamoshGlitch: { nameKey: 'tns.name.stripDatamosh', descKey: 'tns.desc.stripDatamosh' },
  swap: { nameKey: 'tns.name.swap', descKey: 'tns.desc.swap' },
  Swirl: { nameKey: 'tns.name.swirl', descKey: 'tns.desc.swirl' },
  tangentMotionBlur: { nameKey: 'tns.name.tangentMotionBlur', descKey: 'tns.desc.tangentMotionBlur' },
  TilesWave: { nameKey: 'tns.name.tilesWave', descKey: 'tns.desc.tilesWave' },
  TopBottom: { nameKey: 'tns.name.topBottom', descKey: 'tns.desc.topBottom' },
  TVStatic: { nameKey: 'tns.name.tvStatic', descKey: 'tns.desc.tvStatic' },
  undulatingBurnOut: { nameKey: 'tns.name.undulatingBurn', descKey: 'tns.desc.undulatingBurn' },
  VerticalClose: { nameKey: 'tns.name.verticalClose', descKey: 'tns.desc.verticalClose' },
  VerticalOpen: { nameKey: 'tns.name.verticalOpen', descKey: 'tns.desc.verticalOpen' },
  WaterDrop: { nameKey: 'tns.name.waterDrop', descKey: 'tns.desc.waterDrop' },
  wind: { nameKey: 'tns.name.wind', descKey: 'tns.desc.wind' },
  windowblinds: { nameKey: 'tns.name.windowBlinds', descKey: 'tns.desc.windowBlinds' },
  windowslice: { nameKey: 'tns.name.windowSlice', descKey: 'tns.desc.windowSlice' },
  wipeDown: { nameKey: 'tns.name.wipeDown', descKey: 'tns.desc.wipeDown' },
  wipeLeft: { nameKey: 'tns.name.wipeLeft', descKey: 'tns.desc.wipeLeft' },
  wipeRight: { nameKey: 'tns.name.wipeRight', descKey: 'tns.desc.wipeRight' },
  wipeUp: { nameKey: 'tns.name.wipeUp', descKey: 'tns.desc.wipeUp' },
  x_axis_translation: { nameKey: 'tns.name.xAxisTranslation', descKey: 'tns.desc.xAxisTranslation' },
  ZoomInCircles: { nameKey: 'tns.name.zoomInCircles', descKey: 'tns.desc.zoomInCircles' },
  zoomInOut: { nameKey: 'tns.name.zoomInOut', descKey: 'tns.desc.zoomInOut' },
  ZoomLeftWipe: { nameKey: 'tns.name.zoomLeftWipe', descKey: 'tns.desc.zoomLeftWipe' },
  ZoomRigthWipe: { nameKey: 'tns.name.zoomRightWipe', descKey: 'tns.desc.zoomRightWipe' },
};

/** 查一条转场的展示信息。未知 id（工程来自更新的版本）→ null，UI 退回显示 id。 */
export function transitionCatalogInfo(id: string): TransitionCatalogEntry | null {
  return TRANSITION_CATALOG[id] ?? null;
}
