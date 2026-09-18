/**
 * 设置弹窗：API Key、Base URL、并发、Mock 模式、接口连通性测试。
 * API Key 只写不读 —— 服务端永远只回显掩码。
 */
import { useState } from 'react';
import { api, ApiRequestError, type SettingsSnapshot } from '../api/client.ts';

interface Props {
  settings: SettingsSnapshot | null;
  onClose: () => void;
  onSaved: (next: SettingsSnapshot) => void;
}

export function SettingsDialog({ settings, onClose, onSaved }: Props) {
  const [baseUrl, setBaseUrl] = useState(settings?.baseUrl ?? 'https://api.minimax.cn');
  const [apiKey, setApiKey] = useState('');
  const [concurrency, setConcurrency] = useState(settings?.concurrency ?? 2);
  const [mock, setMock] = useState(settings?.mock ?? false);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.updateSettings({
        baseUrl,
        ...(apiKey.trim().length > 0 ? { apiKey: apiKey.trim() } : {}),
        concurrency,
        mock,
      });
      onSaved(next);
      setApiKey('');
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : (cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    setTestResult(null);
    setError(null);
    try {
      const result = await api.testSettings();
      if (result.ok) {
        setTestResult({ ok: true, text: `连通正常，账号下最近 7 天共 ${result.total ?? 0} 条任务记录。` });
      } else {
        const detail = result.error as { hint?: string; message?: string } | undefined;
        setTestResult({ ok: false, text: detail?.hint ?? detail?.message ?? '测试失败。' });
      }
    } catch (cause) {
      setTestResult({ ok: false, text: (cause as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="panel w-[520px] max-w-full p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-medium">设置</h2>
          <button type="button" className="btn btn-xs btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[12px] text-mist-300">API Key</span>
            <input
              className="field mono mt-1"
              type="password"
              placeholder={settings?.apiKeyMasked ? `已配置：${settings.apiKeyMasked}（留空表示不修改）` : '尚未配置'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
            />
            <span className="mt-1 block text-[11px] leading-snug text-mist-400">
              在 platform.minimaxi.com → 账户管理 → 接口密钥 获取。Key 只保存在本机服务端，不会进入浏览器存储。
              {settings?.apiKeyFromEnv && ' 当前来自仓库根目录的 .env。'}
            </span>
          </label>

          <label className="block">
            <span className="text-[12px] text-mist-300">API Base URL</span>
            <input
              className="field mono mt-1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
            <span className="mt-1 block text-[11px] text-mist-400">
              国内站 https://api.minimax.cn，海外站 https://api.minimaxi.com
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[12px] text-mist-300">并发任务数</span>
              <input
                className="field mt-1"
                type="number"
                min={1}
                max={8}
                value={concurrency}
                onChange={(event) => setConcurrency(Number(event.target.value))}
              />
            </label>
            <label className="mt-5 flex items-center gap-2 text-[12px] text-mist-300">
              <input type="checkbox" checked={mock} onChange={(event) => setMock(event.target.checked)} />
              MOCK 模式（不调用真实接口）
            </label>
          </div>

          <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-2 text-[11px] leading-relaxed text-mist-400">
            <div>
              数据目录：<span className="mono">{settings?.dataDir ?? '—'}</span>
            </div>
            <div>
              数据库：<span className="mono">{settings?.dbPath ?? '—'}</span>
            </div>
          </div>

          {testResult && (
            <div
              className={
                testResult.ok
                  ? 'rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-2 text-[11px] text-emerald-300'
                  : 'rounded-lg border border-rose-500/40 bg-rose-500/5 p-2 text-[11px] text-rose-300'
              }
            >
              {testResult.text}
            </div>
          )}
          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={busy}>
            保存
          </button>
          <button type="button" className="btn" onClick={() => void handleTest()} disabled={busy}>
            测试连通性
          </button>
          <span className="ml-auto text-[11px] text-mist-400">测试使用任务列表接口，不产生费用</span>
        </div>
      </div>
    </div>
  );
}
