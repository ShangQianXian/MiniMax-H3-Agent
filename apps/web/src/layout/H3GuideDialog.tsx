/**
 * H3 创作指南：把 7 份官方文档里真正会影响创作决策的内容浓缩成一页。
 * 同时也是「参数为什么被禁用」的权威解释入口。
 */
import { useState } from 'react';
import {
  IMAGE_FREE_COUNT,
  MEDIA_LIMITS,
  MODEL_CAPABILITIES,
  REGEN_BASE_VIDEO_SPEC,
  TEXT_MAX_CHARS,
  formatBytes,
} from '@h3/shared';

interface Props {
  onClose: () => void;
}

type Tab = 'prompt' | 'capability' | 'media' | 'cost';

const TABS: Array<[Tab, string]> = [
  ['prompt', '提示词'],
  ['capability', '能力与场景'],
  ['media', '素材规格'],
  ['cost', '计费'],
];

export function H3GuideDialog({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('prompt');

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="panel flex max-h-[80vh] w-[680px] max-w-full flex-col p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-ink-700 px-4 py-2.5">
          <h2 className="text-[14px] font-medium">H3 创作指南</h2>
          <span className="chip !text-[10px]">依据 docs/api 官方文档</span>
          <button type="button" className="btn btn-xs btn-ghost ml-auto" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="flex shrink-0 border-b border-ink-700 px-2">
          {TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={
                tab === value
                  ? 'border-b-2 border-accent-500 px-3 py-2 text-[12px] text-mist-100'
                  : 'border-b-2 border-transparent px-3 py-2 text-[12px] text-mist-400 hover:text-mist-200'
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-[12px] leading-relaxed text-mist-200">
          {tab === 'prompt' && (
            <div className="space-y-3">
              <Section title="必填规则">
                <Bullet>每次请求<b>必须</b>包含一个非空 <Code>text</Code> 项，缺失会直接返回参数错误。</Bullet>
                <Bullet>
                  视频生成与 Context-IR 的 prompt 上限 <b>{TEXT_MAX_CHARS}</b> 字符；视频再生成上限 <b>40000</b> 字符。
                </Bullet>
              </Section>

              <Section title="结构化写法（推荐）">
                <Bullet>按 <b>镜头 → 主体 → 动作 → 环境 → 光线 → 音效</b> 的顺序写，模型对分镜式描述响应最好。</Bullet>
                <Bullet>
                  多镜头用 <Code>[Shot 1]</Code> <Code>[Shot 2]</Code> 分段，并在镜头切换处给出时间点（如{' '}
                  <Code>At 00:02.800</Code>）——这正是 H3-Context-IR 产出的格式。
                </Bullet>
                <Bullet>
                  需要声音时补三段：<Code>overall_soundscape</Code>（环境音）、<Code>non_diegetic_music</Code>
                  （配乐）、角色台词直接写在正文里。
                </Bullet>
                <Bullet>音色参考请在提示词里点名「音色参考音频1」，并同时挂上对应的参考音频素材。</Bullet>
              </Section>

              <Section title="H3-Context-IR 的用法">
                <Bullet>
                  它<b>只输出增强提示词，不会创建视频任务</b>。适合把一句话扩写成结构化分镜，再把结果接到视频生成节点。
                </Bullet>
                <Bullet>
                  再生成时必须使用<b>当时真正送入模型的那版 prompt</b>（也就是 Context-IR 之后的结果），不能用原始一句话。
                  本项目的任务表同时保存两份，再生成节点会优先取最终版。
                </Bullet>
              </Section>
            </div>
          )}

          {tab === 'capability' && (
            <div className="space-y-3">
              <Section title="模型能力矩阵">
                <Table
                  head={['能力', 'MiniMax-H3', 'MiniMax-H3-Max']}
                  rows={[
                    ['文生视频 / 图生视频', '✅', '✅'],
                    ['多模态参考（参考图/视频/音频）', '✅', '❌'],
                    ['分辨率', MODEL_CAPABILITIES['MiniMax-H3'].resolutions.join(' / '), MODEL_CAPABILITIES['MiniMax-H3-Max'].resolutions.join(' / ')],
                    ['时长', '4–15 秒', '5–15 秒（无 4 秒）'],
                  ]}
                />
              </Section>

              <Section title="三种场景如何判定">
                <Bullet>
                  <b>t2va 文生视频</b>：content 只有 text。<b>ratio 必填且不能是 adaptive</b>，必须写明 16:9 等具体比例。
                </Bullet>
                <Bullet>
                  <b>i2va 图生视频</b>：出现 first_frame / last_frame。<b>宽高比由图片决定，ratio 恒为 adaptive</b>，
                  传其他值会被忽略。首帧 ≤1、尾帧 ≤1，首尾帧需成对。
                </Bullet>
                <Bullet>
                  <b>r2va 多模态参考</b>：出现任一 reference_*。参考图 ≤9、参考视频 ≤3、参考音频 ≤3，ratio 可选默认 adaptive。
                </Bullet>
                <Bullet className="text-amber-300">
                  图生视频与多模态参考<b>互斥</b>：同一个 content 里不能既出现首/尾帧又出现参考素材。
                  需要两种效果请拆成两个节点分别运行。
                </Bullet>
              </Section>

              <Section title="视频再生成（768P → 2K）">
                <Bullet><Code>source_task_id</Code> 与 <Code>content</Code>（含 base_video）<b>必须且只能提供其一</b>。</Bullet>
                <Bullet>按任务 ID 模式<b>需要开通白名单</b>，源任务须属当前账号、状态 succeeded、7 天内。</Bullet>
                <Bullet>
                  源视频须符合 H3 768P 输出规格：<b>含音轨</b>、{REGEN_BASE_VIDEO_SPEC.fps}fps、
                  宽高均可被 {REGEN_BASE_VIDEO_SPEC.dimensionMultiple} 整除、
                  面积 ∈ [{REGEN_BASE_VIDEO_SPEC.minArea.toLocaleString()}, {REGEN_BASE_VIDEO_SPEC.maxArea.toLocaleString()}] 像素、
                  总帧数 {REGEN_BASE_VIDEO_SPEC.minFrames}–{REGEN_BASE_VIDEO_SPEC.maxFrames}。
                  <b>不支持任意视频的通用处理。</b>
                </Bullet>
              </Section>

              <Section title="任务状态机">
                <Table
                  head={['当前状态', '可以做什么']}
                  rows={[
                    ['queued 排队中', '可以取消，且不扣费'],
                    ['running 运行中', '不可取消、不可删除（接口限制）'],
                    ['succeeded 成功', '可以删除记录，可以转存产物'],
                    ['failed 失败', '可以删除记录'],
                    ['cancelled 已取消', '不可重复操作'],
                  ]}
                />
                <Bullet className="text-amber-300">任务记录只保留最近 7 天，产物是限时下载链接，请及时转存。</Bullet>
              </Section>
            </div>
          )}

          {tab === 'media' && (
            <div className="space-y-3">
              <Section title="请求体总大小 ≤ 64 MB">
                <Bullet>
                  Base64 会放大约 <b>33%</b>。大文件请改用公网 URL，或使用平台已有的 <Code>mm_file://{'{file_id}'}</Code>。
                </Bullet>
                <Bullet>素材地址只接受三种：公网 URL、<Code>mm_file://</Code>、<Code>data:&lt;mime&gt;;base64,…</Code>。本地磁盘路径无效。</Bullet>
              </Section>

              <Section title="图片">
                <Bullet>格式 {MEDIA_LIMITS.image.formats.join(' / ')}；单张 ≤ {formatBytes(MEDIA_LIMITS.image.maxBytes)}。</Bullet>
                <Bullet>
                  宽高 ∈ [{MEDIA_LIMITS.image.minSide}, {MEDIA_LIMITS.image.maxSide}] px；
                  宽高比 ∈ [{MEDIA_LIMITS.image.minAspect}, {MEDIA_LIMITS.image.maxAspect}]。
                </Bullet>
                <Bullet>
                  数量：首帧 ≤ {MEDIA_LIMITS.image.maxFirstFrame}、尾帧 ≤ {MEDIA_LIMITS.image.maxLastFrame}、
                  参考图 ≤ {MEDIA_LIMITS.image.maxReferenceImage}。
                </Bullet>
              </Section>

              <Section title="视频（仅多模态参考）">
                <Bullet>容器 {MEDIA_LIMITS.video.formats.join(' / ')}，编码 H.264/AVC 或 H.265/HEVC，音频 AAC / MP3。</Bullet>
                <Bullet>
                  单个 ≤ {formatBytes(MEDIA_LIMITS.video.maxBytes)}；≤ {MEDIA_LIMITS.video.maxCount} 段；
                  单段与总计均 ≤ {MEDIA_LIMITS.video.maxDurationSec}s；帧率 ∈ [{MEDIA_LIMITS.video.minFps}, {MEDIA_LIMITS.video.maxFps}]。
                </Bullet>
              </Section>

              <Section title="音频（仅多模态参考）">
                <Bullet>
                  格式 {MEDIA_LIMITS.audio.formats.join(' / ')}；单个 ≤ {formatBytes(MEDIA_LIMITS.audio.maxBytes)}；
                  ≤ {MEDIA_LIMITS.audio.maxCount} 段；总时长 ≤ {MEDIA_LIMITS.audio.maxDurationSec}s。
                </Bullet>
                <Bullet className="text-emerald-300">音频输入免费。</Bullet>
              </Section>
            </div>
          )}

          {tab === 'cost' && (
            <div className="space-y-3">
              <Section title="视频生成 · 输出">
                <Table
                  head={['模型', '分辨率', '单价']}
                  rows={[
                    ['MiniMax-H3', '768P', '0.50 元/秒'],
                    ['MiniMax-H3', '2K', '0.80 元/秒'],
                    ['MiniMax-H3-Max', '480P', '0.33 元/秒'],
                    ['MiniMax-H3-Max', '768P', '0.50 元/秒'],
                  ]}
                />
              </Section>

              <Section title="输入素材">
                <Bullet>音频：免费。</Bullet>
                <Bullet>
                  图片：<b>{IMAGE_FREE_COUNT} 张以内免费</b>，超出部分 0.20 元/张。
                </Bullet>
                <Bullet>参考视频：按输入视频时长与生成分辨率计费，2K 0.80、768P 0.50 元/秒。</Bullet>
              </Section>

              <Section title="视频再生成">
                <Bullet>输出 0.30 元/秒。</Bullet>
                <Bullet>原 768P 任务中的输入素材<b>需要重新计费</b>：图片 0.15 元/张（5 张内免费）、视频 0.30 元/秒。</Bullet>
              </Section>

              <Section title="H3-Context-IR">
                <Bullet>输入 5.80 元/百万 tokens，输出 23.00 元/百万 tokens。</Bullet>
                <Bullet>任务创建前无法得知真实 token 数，本项目按字符数保守预估，成功后用返回的 usage 校正。</Bullet>
              </Section>

              <p className="rounded-md border border-ink-600 bg-ink-850 p-2 text-[11px] text-mist-400">
                以上为刊例价，单位为人民币。界面上的 ✳ 金额是按此表折算的<b>预估值</b>，实际以平台账单为准；
                任务成功后节点会显示依据 usage 折算的实际花费。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* 小组件放在底部，避免打乱上面的可读结构 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[12px] font-medium text-mist-100">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Bullet({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`flex gap-1.5 ${className ?? ''}`}>
      <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-mist-400" />
      <span>{children}</span>
    </p>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="mono rounded bg-ink-800 px-1 py-0.5 text-[11px] text-cyan-glow">{children}</code>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} className="border-b border-ink-600 px-2 py-1 text-left font-medium text-mist-400">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, cellIndex) => (
              <td key={cellIndex} className="border-b border-ink-700/60 px-2 py-1 text-mist-200">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
