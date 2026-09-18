/**
 * 素材与产物落盘。
 *
 * 背景：接口的 content.url 只接受公网 URL / mm_file:// / data URI，且请求体总计 ≤ 64 MB；
 * 产物返回的是**限时下载链接**、任务记录只保留 7 天。因此需要本地转存，避免用户素材与成果丢失。
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { AppConfig } from '../config.ts';
import { nowSeconds, plain, plainAll, type Db } from '../db.ts';
import { MOCK_ARTIFACT_BYTES, MOCK_CDN_PREFIX } from './mock.ts';

export interface AssetRecord {
  id: string;
  projectId: string | null;
  kind: string;
  originUrl: string;
  localPath: string;
  mime: string;
  bytes: number;
  sha256: string;
  durationSec: number | null;
  originalName: string;
  createdAt: number;
}

type AssetRow = {
  id: string;
  project_id: string | null;
  kind: string;
  origin_url: string;
  local_path: string;
  mime: string;
  bytes: number;
  sha256: string;
  duration_sec: number | null;
  original_name: string;
  created_at: number;
};

function rowToAsset(row: AssetRow): AssetRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    originUrl: row.origin_url,
    localPath: row.local_path,
    mime: row.mime,
    bytes: row.bytes,
    sha256: row.sha256,
    durationSec: row.duration_sec,
    originalName: row.original_name,
    createdAt: row.created_at,
  };
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
};

export function extensionFor(mime: string, fallbackName?: string): string {
  const known = EXT_BY_MIME[mime.toLowerCase()];
  if (known) return known;
  if (fallbackName) {
    const ext = extname(fallbackName);
    if (ext) return ext;
  }
  return '.bin';
}

export class AssetService {
  private readonly db: Db;
  private readonly config: AppConfig;

  constructor(db: Db, config: AppConfig) {
    this.db = db;
    this.config = config;
  }

  private dirFor(projectId: string | null): string {
    return join(this.config.assetsDir, projectId ?? '_shared');
  }

  private dirForArtifacts(): string {
    return this.config.artifactsDir;
  }

  list(projectId?: string): AssetRecord[] {
    const rows = projectId
      ? this.db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
      : this.db.prepare('SELECT * FROM assets ORDER BY created_at DESC').all();
    return plainAll<AssetRow>(rows).map(rowToAsset);
  }

  get(id: string): AssetRecord | null {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    return row ? rowToAsset(plain<AssetRow>(row)) : null;
  }

  /** 按本地落盘路径反查素材，用于页面刷新后恢复产物预览。 */
  getByLocalPath(localPath: string): AssetRecord | null {
    if (!localPath) return null;
    const row = this.db.prepare('SELECT * FROM assets WHERE local_path = ? LIMIT 1').get(localPath);
    return row ? rowToAsset(plain<AssetRow>(row)) : null;
  }

  private insert(input: Omit<AssetRecord, 'id' | 'createdAt'>): AssetRecord {
    const id = randomUUID();
    const ts = nowSeconds();
    this.db
      .prepare(
        `INSERT INTO assets (id, project_id, kind, origin_url, local_path, mime, bytes, sha256, duration_sec, original_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.kind,
        input.originUrl,
        input.localPath,
        input.mime,
        input.bytes,
        input.sha256,
        input.durationSec,
        input.originalName,
        ts,
      );
    return this.get(id)!;
  }

  /** 保存浏览器直传的二进制素材。 */
  async saveUpload(input: {
    buffer: Buffer;
    mime: string;
    kind: string;
    projectId: string | null;
    originalName?: string;
    durationSec?: number;
  }): Promise<AssetRecord> {
    const dir = this.dirFor(input.projectId);
    await mkdir(dir, { recursive: true });
    const ext = extensionFor(input.mime, input.originalName);
    const fileName = `${randomUUID()}${ext}`;
    const localPath = join(dir, fileName);
    await writeFile(localPath, input.buffer);

    return this.insert({
      projectId: input.projectId,
      kind: input.kind,
      originUrl: '',
      localPath,
      mime: input.mime,
      bytes: input.buffer.byteLength,
      sha256: createHash('sha256').update(input.buffer).digest('hex'),
      durationSec: input.durationSec ?? null,
      originalName: input.originalName ?? fileName,
    });
  }

  /** 登记一个已在公网的素材（不下载，只记元数据）。 */
  registerRemote(input: {
    url: string;
    kind: string;
    projectId: string | null;
    mime?: string;
    bytes?: number;
    originalName?: string;
  }): AssetRecord {
    return this.insert({
      projectId: input.projectId,
      kind: input.kind,
      originUrl: input.url,
      localPath: '',
      mime: input.mime ?? '',
      bytes: input.bytes ?? 0,
      sha256: '',
      durationSec: null,
      originalName: input.originalName ?? input.url.split('/').pop() ?? input.url,
    });
  }

  /**
   * 把限时产物 URL 下载到本地。产物链接会过期，转存是刚需。
   * MOCK 模式下直接从内存取一个最小 MP4，不访问外网。
   */
  async fetchArtifact(input: {
    url: string;
    taskId: string;
    projectId: string | null;
    kind?: string;
  }): Promise<AssetRecord> {
    const dir = this.dirForArtifacts();
    await mkdir(dir, { recursive: true });

    let mime = 'video/mp4';
    let buffer: Buffer;

    if (input.url.startsWith(MOCK_CDN_PREFIX)) {
      buffer = MOCK_ARTIFACT_BYTES;
    } else {
      const response = await fetch(input.url);
      if (!response.ok) {
        throw new Error(`下载产物失败：HTTP ${response.status}`);
      }
      mime = response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'video/mp4';
      buffer = Buffer.from(await response.arrayBuffer());
    }

    const ext = extensionFor(mime);
    const localPath = join(dir, `${input.taskId}${ext}`);
    await writeFile(localPath, buffer);

    return this.insert({
      projectId: input.projectId,
      kind: input.kind ?? (mime.startsWith('video') ? 'video' : 'artifact'),
      originUrl: input.url,
      localPath,
      mime,
      bytes: buffer.byteLength,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      durationSec: null,
      originalName: `${input.taskId}${ext}`,
    });
  }

  /** 读取本地文件用于回放（支持 Range，由路由层处理）。 */
  stat(id: string): { path: string; bytes: number; mime: string } | null {
    const asset = this.get(id);
    if (!asset || !asset.localPath) return null;
    if (!existsSync(asset.localPath)) return null;
    const stat = statSync(asset.localPath);
    return { path: asset.localPath, bytes: stat.size, mime: asset.mime || 'application/octet-stream' };
  }

  createStream(path: string, range?: { start: number; end: number }) {
    return createReadStream(path, range);
  }

  async readText(id: string, maxBytes = 5 * 1024 * 1024): Promise<string | null> {
    const asset = this.get(id);
    if (!asset || !asset.localPath) return null;
    const buffer = await readFile(asset.localPath);
    return buffer.subarray(0, maxBytes).toString('utf8');
  }
}
