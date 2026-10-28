/**
 * pool-pinyin.ts — 媒体池搜索的拼音支持（**按需加载**）。
 *
 * ## 为什么不复用 `i18n/pinyin.ts` 的手写表
 *
 * 那张表的前提是「要转的只有目录里的一百多个词」，所以列出来很划算。
 * **媒体名是用户数据**（`片头_v2_最终.mp4`、自己起的别名……），是开放集，
 * 没法列成表 —— 打拼音搜不到自己的素材，搜索框就等于残了一半。
 *
 * ## 为什么可以引一个库
 *
 * 代价被两件事关住：
 *  1. **动态 import**：只有用户真的去点媒体池的搜索框时才拉这块 chunk，
 *     首屏、lab、排版页的 bundle 图里都没有它；
 *  2. 只对**含汉字的串**跑转换（拉丁文件名本来就在 haystack 里）。
 *
 * 加载失败（离线 / chunk 404）时退回手写表，搜索功能不消失 —— 只是中文名
 * 搜不到拼音。
 */

import { pinyinHaystack } from '../i18n/pinyin';

/** 汉字。没有汉字的串不必过字典。 */
const HAN = /[\u4e00-\u9fff]/;

let convert: ((text: string) => string) | null = null;
let loading: Promise<void> | null = null;

/** 转换器是否已经就绪（测试与「要不要重建索引」用）。 */
export function poolPinyinReady(): boolean {
  return convert !== null;
}

/**
 * 拉起转换器。**幂等**：重复调用返回同一个 Promise。
 *
 * 由搜索框的 `focus` 触发 —— 用户点进来的那一刻开始下载，等他打完第一个词
 * 时通常已经就绪；没就绪的那几帧只是少了一种命中方式，不影响包含 / 子序列。
 */
export function loadPoolPinyin(): Promise<void> {
  if (convert) return Promise.resolve();
  loading ??= import('pinyin-pro')
    .then(({ pinyin }) => {
      convert = (text: string): string => {
        const parts = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
          // 纯汉字音节才是要的；标点、扩展名、带空格的拉丁词块丢掉（原文已在 haystack 里）。
          .map((t) => t.trim())
          .filter((t) => /^[a-z]+$/i.test(t));
        return parts.join(' ');
      };
    })
    .catch(() => {
      // 失败就停在手写表那条路上。**不抛**：搜索是高频路径，一个 chunk 拉不下来
      // 不该弹出错误条。
      loading = null;
    });
  return loading;
}

/**
 * 一个名字的拼音 haystack：带空格全拼 / 连写全拼 / 首字母。
 *
 * 三种形态都要，与 `i18n/pinyin.ts` 的理由相同（用户三种都会打）。
 * 转换器没就绪、或串里没有汉字时退回手写表。
 */
export function poolPinyinHaystack(text: string): string {
  if (!text) return '';
  if (!convert || !HAN.test(text)) return pinyinHaystack(text);
  const syllables = convert(text);
  if (!syllables) return '';
  const parts = syllables.split(' ');
  return `${syllables} ${parts.join('')} ${parts.map((s) => s[0]).join('')}`;
}
