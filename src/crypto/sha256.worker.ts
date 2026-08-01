/// <reference lib="webworker" />
/**
 * SHA-256 の計算を UI スレッドから追い出すための Worker（NFR-001）。
 *
 * 20 MB の文書を取得したときにハッシュ計算で画面が固まらないようにする。
 */

declare let self: DedicatedWorkerGlobalScope;

interface DigestRequest {
  id: number;
  bytes: ArrayBuffer;
}

interface DigestResponse {
  id: number;
  hex?: string;
  error?: string;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

self.addEventListener('message', (event: MessageEvent<DigestRequest>) => {
  const { id, bytes } = event.data;

  crypto.subtle
    .digest('SHA-256', bytes)
    .then((digest) => {
      const response: DigestResponse = { id, hex: toHex(digest) };
      self.postMessage(response);
    })
    .catch(() => {
      const response: DigestResponse = { id, error: 'digest-failed' };
      self.postMessage(response);
    });
});
