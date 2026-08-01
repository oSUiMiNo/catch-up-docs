/**
 * SHA-256 の計算窓口。
 *
 * 可能なら Worker で計算し、UI スレッドを塞がない（NFR-001）。
 * Worker を作れない環境ではメインスレッドへ落とす。結果は同じ。
 */

import { logger } from '../utils/logger';

interface PendingRequest {
  resolve: (hex: string) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 0;
const pending = new Map<number, PendingRequest>();

function ensureWorker(): Worker | null {
  if (workerUnavailable) {
    return null;
  }
  if (worker) {
    return worker;
  }

  try {
    worker = new Worker(new URL('./sha256.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<{ id: number; hex?: string }>) => {
      const request = pending.get(event.data.id);
      if (!request) {
        return;
      }
      pending.delete(event.data.id);
      if (typeof event.data.hex === 'string') {
        request.resolve(event.data.hex);
      } else {
        request.reject(new Error('ハッシュを計算できませんでした'));
      }
    });
    worker.addEventListener('error', () => {
      // 以降はメインスレッドで計算する。
      workerUnavailable = true;
      for (const [, request] of pending) {
        request.reject(new Error('ハッシュを計算できませんでした'));
      }
      pending.clear();
    });
    return worker;
  } catch {
    logger.debug('Worker を作れないためメインスレッドでハッシュを計算します');
    workerUnavailable = true;
    return null;
  }
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** メインスレッドで計算する。テストと Worker 非対応環境で使う。 */
export async function sha256HexSync(bytes: ArrayBuffer): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * SHA-256 を小文字16進で返す。
 * manifest の contentSha256 と突き合わせるために使う（FR-GH-005）。
 */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const activeWorker = ensureWorker();
  if (!activeWorker) {
    return sha256HexSync(bytes);
  }

  const id = nextRequestId;
  nextRequestId += 1;

  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    // Worker へ所有権を渡すと呼び出し側で使えなくなるため、複製を送る。
    activeWorker.postMessage({ id, bytes: bytes.slice(0) });
  });
}

/** テスト用。Worker の状態を初期化する。 */
export function resetSha256WorkerForTest(): void {
  worker?.terminate();
  worker = null;
  workerUnavailable = false;
  pending.clear();
}
