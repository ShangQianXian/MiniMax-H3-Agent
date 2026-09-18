/**
 * 前端工具：文件读取、媒体探测（尺寸 / 时长）、字节格式化、时间格式化、剪贴板。
 * 刻意不做有损压缩，只在超限时给出可执行的建议。
 */
import { MAX_REQUEST_BYTES } from '@h3/shared';

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatTime(seconds: number | undefined | null): string {
  if (!seconds) return '—';
  const date = new Date(seconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatRelative(ms: number | null): string {
  if (!ms) return '未保存';
  const diff = Date.now() - ms;
  if (diff < 5000) return '刚刚已保存';
  if (diff < 60000) return `${Math.round(diff / 1000)} 秒前已保存`;
  if (diff < 3600000) return `${Math.round(diff / 60000)} 分钟前已保存`;
  return `${Math.round(diff / 3600000)} 小时前已保存`;
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

export function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取文件失败。'));
    reader.readAsDataURL(file);
  });
}

export interface MediaProbe {
  width?: number;
  height?: number;
  durationSec?: number;
}

/** 用浏览器原生能力探测媒体尺寸与时长，不引入任何依赖。 */
export function probeMedia(url: string, kind: 'image' | 'video' | 'audio'): Promise<MediaProbe> {
  return new Promise((resolve) => {
    if (kind === 'image') {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => resolve({});
      image.src = url;
      return;
    }
    const media = document.createElement(kind === 'video' ? 'video' : 'audio');
    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      const result: MediaProbe = { durationSec: Math.round(media.duration * 10) / 10 };
      if (kind === 'video' && media instanceof HTMLVideoElement) {
        result.width = media.videoWidth;
        result.height = media.videoHeight;
      }
      resolve(result);
    };
    media.onerror = () => resolve({});
    media.src = url;
  });
}

export interface UploadOutcome {
  url: string;
  bytes: number;
  mime: string;
  name: string;
  assetId?: string;
  probe: MediaProbe;
  /** 转为 data URI 会超出 64MB 请求体上限时的可执行建议 */
  warning?: string;
}

/** Base64 膨胀后是否会撑爆请求体上限（保守按 1.34 倍估算）。 */
export function willExceedBodyLimit(bytes: number): boolean {
  return bytes * 1.34 > MAX_REQUEST_BYTES * 0.9;
}

export async function fileToOutcome(
  file: File,
  kind: 'image' | 'video' | 'audio',
): Promise<UploadOutcome> {
  const dataUri = await readFileAsDataUri(file);
  const probe = await probeMedia(dataUri, kind);
  const warning = willExceedBodyLimit(file.size)
    ? `该文件 ${formatBytes(file.size)}，内联为 Base64 后约 ${formatBytes(file.size * 1.34)}，接近或超过接口 64 MB 请求体上限。建议改用公网 URL，或先压缩 / 裁剪素材。`
    : undefined;
  return {
    url: dataUri,
    bytes: file.size,
    mime: file.type || 'application/octet-stream',
    name: file.name,
    probe,
    ...(warning ? { warning } : {}),
  };
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** 生成可直接粘贴到终端的 curl，便于排查。 */
export function buildCurl(
  path: string,
  body: unknown,
  options: { apiKeyPlaceholder?: string } = {},
): string {
  const key = options.apiKeyPlaceholder ?? '$MINIMAX_API_KEY';
  return [
    `curl -X POST 'https://api.minimax.cn${path}' \\`,
    `  -H 'Authorization: Bearer ${key}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${JSON.stringify(body)}'`,
  ].join('\n');
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
