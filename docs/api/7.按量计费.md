> ## Documentation Index
> Fetch the complete documentation index at: https://platform.minimaxi.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# 按量计费

> MiniMax按量计费定价

按量计费使用开放平台普通 API Key，并按实际用量消耗账户余额。积分是通过订阅 Key 使用的独立预付余额，资源覆盖范围与 Token Plan 相同。积分定价和使用规则请参考 [Token Plan 定价](/docs/guides/pricing-token-plan)。

## 语言模型

[立即充值](https://platform.minimaxi.com/user-center/payment/balance)

<Tabs>
  <Tab title="标准">
    | **模型**                                                                                                                                                                                                   | **输入价格**<br /> 元/百万 tokens | **输出价格**<br /> 元/百万 tokens | **缓存读取**<br /> 元/百万 tokens |
    | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------: | :------------------------: | :------------------------: |
    | **MiniMax-M3**<br />≤ 512k 输入 tokens <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">永久五折</span>   |        ~~4.20~~ 2.10       |       ~~16.80~~ 8.40       |        ~~0.84~~ 0.42       |
    | **MiniMax-M3**<br />> 512k 输入 tokens\* <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">永久五折</span> |        ~~8.40~~ 4.20       |       ~~33.60~~ 16.80      |        ~~1.68~~ 0.84       |
  </Tab>

  <Tab title="优先*">
    | **模型**                                                                                                                                                                                                 | **输入价格**<br /> 元/百万 tokens | **输出价格**<br /> 元/百万 tokens | **缓存读取**<br /> 元/百万 tokens |
    | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------: | :------------------------: | :------------------------: |
    | **MiniMax-M3**<br />≤ 512k 输入 tokens <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">永久五折</span> |        ~~6.30~~ 3.15       |       ~~25.20~~ 12.60      |        ~~1.26~~ 0.63       |
    | **MiniMax-M3**<br />> 512k 输入 tokens <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-300">永久五折</span> |       ~~12.60~~ 6.30       |       ~~50.40~~ 25.20      |        ~~2.52~~ 1.26       |

    \* 优先服务可让请求获得优先准入，从而更快响应并降低失败率。调用时将 `service_tier` 设为 `priority` 即可启用。该层级按标准价格的 1.5 倍计费。
  </Tab>
</Tabs>

| **模型**                     | **输入价格**<br /> 元/百万 tokens | **输出价格**<br /> 元/百万 tokens | **缓存读取**<br /> 元/百万 tokens | **缓存写入**<br /> 元/百万 tokens |
| :------------------------- | :------------------------: | :------------------------: | :------------------------: | :------------------------: |
| **MiniMax-M2.7**           |             2.1            |             8.4            |            0.42            |            2.625           |
| **MiniMax-M2.7-highspeed** |             4.2            |            16.8            |            0.42            |            2.625           |

<Accordion title="历史模型">
  | **模型**                     | **输入价格**<br /> 元/百万 tokens | **输出价格**<br /> 元/百万 tokens | **缓存读取**<br /> 元/百万 tokens | **缓存写入**<br /> 元/百万 tokens |
  | :------------------------- | :------------------------: | :------------------------: | :------------------------: | :------------------------: |
  | **MiniMax-M2.5**           |             2.1            |             8.4            |            0.21            |            2.625           |
  | **MiniMax-M2.5-highspeed** |             4.2            |            16.8            |            0.21            |            2.625           |
  | **MiniMax-M2.1**           |             2.1            |             8.4            |            0.21            |            2.625           |
  | **MiniMax-M2.1-highspeed** |             4.2            |            16.8            |            0.21            |            2.625           |
  | **MiniMax-M2**             |             2.1            |             8.4            |            0.21            |            2.625           |
</Accordion>

<Info>
  请注意：

  1. 计费项是token数；tokens字符比值根据使用场景的不同略有浮动，以实际消耗为准，字符数包括标点等
  2. Token与字符比（估算）：1600 中文字符约消耗 1000 tokens
</Info>

## 语音

[立即充值](https://platform.minimaxi.com/user-center/payment/balance)

**语音识别（ASR）**

| **计费项** | **接口**         | **接口说明**                          | **单价**<br />元/小时 |
| :------ | :------------- | :-------------------------------- | :--------------: |
| 语音识别    | Speech-to-Text | 音频转文本，支持流式返回、说话人分离与字幕（srt/vtt）导出。 |       2.50       |

**语音合成（TTS）**

| **计费项**                  | **模型**           | **接口说明**                                                               | **单价**<br />元/万字符 |
| :----------------------- | :--------------- | :--------------------------------------------------------------------- | :---------------: |
| 同步语音合成<br />T2A          | speech-2.8-hd    | 支持音量、语调、语速调整和混音，支持比特率、采样率相关参数调整，支持音频时长、音频大小等返回参数。适用于短文本快速合成，如闲聊、对话等场景。 |        3.50       |
| 同步语音合成<br />T2A          | speech-2.8-turbo | 同上，速度更快、成本更低。                                                          |        2.00       |
| 异步长文本语音合成<br />T2A Async | speech-2.8-hd    | 支持文本到语音的异步生成，单次最大支持 100 万字符，生成结果支持异步检索。                                |        3.50       |
| 异步长文本语音合成<br />T2A Async | speech-2.8-turbo | 同上，速度更快、成本更低。                                                          |        2.00       |

<Info>
  计费单位为字符数，以 10,000 个字符（输入）为单位。1 个汉字算 2 个字符；英文字母、希腊字母、标点符号、特殊符号、空格、回车等各算 1 个字符。
</Info>

**音色管理**

| **计费项**                     | **接口说明**                                                 | **单价**<br />元/音色 | **计费说明**                                             |
| :-------------------------- | :------------------------------------------------------- | :--------------: | :--------------------------------------------------- |
| **音色设计**<br />Voice Design  | 基于用户输入的声音描述 prompt 生成音色（voice\_id），可用于同步/异步语音合成接口。       |       9.90       | 生成音色时不立即收费，首次使用该音色进行合成时才计入。接口内的试听语音合成按 2.00 元/万字符计费。 |
| **快速复刻**<br />Voice Cloning | 基于大语言模型的音色克隆，无需超长时长的高质量原音频，即可在极短时间内完成音色复刻，并保持与原音色的高保真还原。 |       9.90       | 复刻音色时不立即收费，首次使用该音色进行合成时才计入。试听字符按所选试听模型的单价计费。         |

<Accordion title="历史模型">
  | **计费项**             | **模型**                             | **单价**<br />元/万字符 |
  | :------------------ | :--------------------------------- | :---------------: |
  | 同步语音合成 T2A          | speech-2.6-hd / speech-02-hd       |        3.50       |
  | 同步语音合成 T2A          | speech-2.6-turbo / speech-02-turbo |        2.00       |
  | 异步长文本语音合成 T2A Async | speech-2.6-hd / speech-02-hd       |        3.50       |
  | 异步长文本语音合成 T2A Async | speech-2.6-turbo / speech-02-turbo |        2.00       |
</Accordion>

## 视频

[立即充值](https://platform.minimaxi.com/user-center/payment/balance)

**视频生成-输出价格**

| **模型/接口**                                            | **分辨率** | **计费规则** | **刊例价**  |
| :--------------------------------------------------- | :------ | :------- | :------- |
| <div style={{minWidth:'240px'}}>MiniMax-H3</div>     | 768P    | 按秒计费     | 0.50 元/秒 |
| <div style={{minWidth:'240px'}}>MiniMax-H3</div>     | 2K      | 按秒计费     | 0.80 元/秒 |
| <div style={{minWidth:'240px'}}>MiniMax-H3-Max</div> | 480P    | 按秒计费     | 0.33 元/秒 |
| <div style={{minWidth:'240px'}}>MiniMax-H3-Max</div> | 768P    | 按秒计费     | 0.50 元/秒 |

<Note>
  MiniMax-H3-Max 目前仅支持 T2V、I2V，仅输出视频计费，输入素材（图片）暂不计费。
</Note>

**视频生成-输入素材价格**

| **模型/接口**                                        | **素材类型** | **计费规则**                                            |
| :----------------------------------------------- | :------- | :-------------------------------------------------- |
| <div style={{minWidth:'240px'}}>MiniMax-H3</div> | 音频       | 免费                                                  |
| <div style={{minWidth:'240px'}}>MiniMax-H3</div> | 图片       | **5 张**以内免费，超出部分 **0.20 元/张**                       |
| <div style={{minWidth:'240px'}}>MiniMax-H3</div> | 视频       | 按输入视频时长及生成视频分辨率计费：**2K 0.80 元/秒**，**768P 0.50 元/秒** |

**视频再生成-输出价格**

将已生成的 768P 视频进一步生成为 2K 视频，按视频再生成输出秒数计费。

| **模型/接口**                                                     | **分辨率**   | **计费规则**     | **刊例价**  |
| :------------------------------------------------------------ | :-------- | :----------- | :------- |
| <div style={{minWidth:'240px'}}>MiniMax-H3-Regeneration</div> | 768P → 2K | 按视频再生成输出秒数计费 | 0.30 元/秒 |

**视频再生成-输入素材价格**

原 768P 生成任务中使用的输入素材需要重新计费。

| **模型/接口**                                                     | **素材类型** | **计费规则**                            |
| :------------------------------------------------------------ | :------- | :---------------------------------- |
| <div style={{minWidth:'240px'}}>MiniMax-H3-Regeneration</div> | 音频       | 免费                                  |
| <div style={{minWidth:'240px'}}>MiniMax-H3-Regeneration</div> | 图片       | **5 张**以内免费，超出部分 **0.15 元/张**       |
| <div style={{minWidth:'240px'}}>MiniMax-H3-Regeneration</div> | 视频       | 按原 768P 生成任务中输入视频的秒数计费：**0.30 元/秒** |

**H3-Context-IR 任务价格**

| **模型/接口**                                                   |     **输入价格**     |      **输出价格**     |
| :---------------------------------------------------------- | :--------------: | :---------------: |
| <div style={{minWidth:'240px'}}>MiniMax-H3-Context-IR</div> | 5.80 元/百万 tokens | 23.00 元/百万 tokens |

<Accordion title="历史模型">
  | **模型**                  | **功能**             | **单价**<br /> 元/视频 |
  | :---------------------- | :----------------- | :---------------- |
  | MiniMax-Hailuo-2.3-Fast | 图生视频，768P 6s       | 1.35              |
  | MiniMax-Hailuo-2.3-Fast | 图生视频，768P 10s      | 2.25              |
  | MiniMax-Hailuo-2.3-Fast | 图生视频，1080P 6s      | 2.31              |
  | MiniMax-Hailuo-2.3      | 文生视频，图生视频，768P 6s  | 2.00              |
  | MiniMax-Hailuo-2.3      | 文生视频，图生视频，768P 10s | 4.00              |
  | MiniMax-Hailuo-2.3      | 文生视频，图生视频，1080P 6s | 3.50              |
  | MiniMax-Hailuo-02       | 文生视频，图生视频，768P 6s  | 2.00              |
  | MiniMax-Hailuo-02       | 文生视频，图生视频，768P 10s | 4.00              |
  | MiniMax-Hailuo-02       | 文生视频，图生视频，1080P 6s | 3.50              |
  | MiniMax-Hailuo-02       | 图生视频，512P 6s       | 0.60              |
  | MiniMax-Hailuo-02       | 图生视频，512P 10s      | 1.00              |
</Accordion>

## 音乐

<Note title="Music API 服务调整通知">
  自 2026 年 8 月 20 日起，付费接口（音乐生成、歌词生成）不再面向新用户提供服务，历史付费用户可继续使用现有 API 服务；免费音乐生成接口（Music-3.0-free、Music-2.6-free、music-cover-free）停止服务。

  如需体验或使用音乐生成能力，可前往 [MiniMax Audio](https://www.minimaxi.com/audio)，或使用已发布在 [Hugging Face](https://huggingface.co/MiniMaxAI/MiniMax-Music3) 和 [魔搭 ModelScope](https://modelscope.cn/models/MiniMax/MiniMax-Music3) 的 MiniMax Music 3 开源模型。
</Note>

| **模型**         | **接口说明**              | **单价**<br /> 元/首 |
| :------------- | :-------------------- | :--------------: |
| Music-3.0（已下线） | RPM = 120，若需提升可联系销售定制 |        1.0       |
| Music-2.6（已下线） | RPM = 120，若需提升可联系销售定制 |        1.0       |
| 歌词生成（已下线）      | 歌词生成/编辑               |       0.05       |

<Accordion title="历史模型">
  | **模型**          | **接口说明**              | **单价**<br /> 元/首 |
  | :-------------- | :-------------------- | :--------------: |
  | Music-2.5+（已下线） | 最新音乐生成模型，纯音乐解锁，突破风格边界 |        1.0       |
  | Music-2.5（已下线）  | 全维度突破，指挥细节，定义真实       |        1.0       |
  | Music-2.0（已下线）  | 多变音色，丰富乐器表现           |       0.25       |
</Accordion>

## 图像

[立即充值](https://platform.minimaxi.com/user-center/payment/balance)

| **模型**                      | **接口说明**            | **单价**<br /> 元/张 |
| :-------------------------- | :------------------ | :--------------: |
| image-01<br />image-01-live | 支持用户通过文本描述或参考图片生成图片 |       0.025      |

## MCP

[立即充值](https://platform.minimaxi.com/user-center/payment/balance)

| **模型**  | **接口说明**                             | **输入价格**<br />元/次 |
| :------ | :----------------------------------- | :---------------: |
| API-vlm | 通过 **Token Plan MCP** 插件或工具自带的视觉接口调用 |       0.025       |

通过 Token Plan 调用 API-vlm 时，会按其按量计费价格扣减套餐内 Token Plan 额度；套餐内额度耗尽且已购积分可用时，超出部分可由已购积分自动补充支付。

<Callout color="#FFC107">
  🔔 **定价调整预告**：自2026年7月22日起，API-vlm 按量价格调整为 ¥0.025 元/次。Token Plan 套餐内单次 API-vlm 调用扣减的 token 额度将同步减少，同等套餐可支持更多次调用。接口与能力保持不变，无需任何代码调整。
</Callout>

## 服务端工具 <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 before:content-['Beta'] dark:bg-blue-900/30 dark:text-blue-300" />

[立即充值](https://platform.minimaxi.com/user-center/payment/balance)

| **服务端工具**       | **接口说明**                                                 | **单价**<br /> 元/次 |
| :-------------- | :------------------------------------------------------- | :--------------: |
| **web\_search** | 联网搜索，模型在服务端自动执行搜索并基于结果作答，详见[服务端工具](/docs/guides/server-tools) |       0.03       |
