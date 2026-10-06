/**
 * bake.worker.ts — 烘焙 Worker（硬约束 1.4：算法烘焙不在主线程）。
 *
 * 消息协议：
 *   主 → Worker  { type:'bake', reqId, genId, params, seed }
 *                 { type:'cancel', reqId }
 *   Worker → 主  { type:'done', reqId, result }（result.data 走 transferable）
 *                 { type:'error', reqId, message }
 *
 * bake 函数是纯 TS（不碰 GL），worker 与主线程共用同一份实现——
 * 这也是「预览与导出是同一次随机」在烘焙侧的落实。
 *
 * 登记表在 `bakers.ts`（**唯一真源**，由单测守卫覆盖）。别把 def 列表写回
 * 这个文件：那张表原来就在这里，代价是「漏登记不会报错」。
 */

import { BAKERS } from './bakers';
import type { BakeResult } from './types';

interface BakeRequest {
  type: 'bake';
  reqId: number;
  genId: string;
  params: Record<string, number | string>;
  seed: number;
}
interface CancelRequest {
  type: 'cancel';
  reqId: number;
}

const cancelled = new Set<number>();

self.onmessage = (e: MessageEvent<BakeRequest | CancelRequest>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    cancelled.add(msg.reqId);
    return;
  }
  const bake = BAKERS[msg.genId];
  if (!bake) {
    postMessage({ type: 'error', reqId: msg.reqId, message: `未知生成器 ${msg.genId}` });
    return;
  }
  try {
    const result: BakeResult = bake(msg.params, msg.seed);
    if (cancelled.has(msg.reqId)) {
      cancelled.delete(msg.reqId);
      return;
    }
    postMessage({ type: 'done', reqId: msg.reqId, result });
  } catch (err) {
    postMessage({ type: 'error', reqId: msg.reqId, message: String(err) });
  }
};
