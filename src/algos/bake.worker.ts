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
 */

import { rule110Def } from './rule110';
import type { BakeFn, BakeResult } from './types';

/** 需要进 Worker 烘焙的生成器在这里登记（新增 bake 型生成器 = 这里加一行）。 */
const BAKERS: Record<string, BakeFn> = {};
if (rule110Def.kind === 'bake') BAKERS[rule110Def.id] = rule110Def.bake;

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
