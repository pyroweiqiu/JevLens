# JevLens

[一屏交互展示](https://pyroweiqiu.github.io/JevLens/) · [GitHub 源码](https://github.com/pyroweiqiu/JevLens)

浏览器里的 SEE → FIND → ACT。使用 Chrome 原生侧栏展示重要原文、按意图定位段落，并在用户批准后执行一个可见页面动作。

## 直接安装（无需编译）

1. [下载 JevLens v0.2.0 Chrome ZIP](https://pyroweiqiu.github.io/JevLens/downloads/JevLens-0.2.0-chrome.zip)，在电脑上解压。
2. 打开 `chrome://extensions`，开启右上角“开发者模式”，点击“加载已解压的扩展程序”。
3. 选择解压后包含 `manifest.json` 的文件夹，保留该文件夹；刷新网页，点击工具栏里的 JevLens。

目前尚未上架 Chrome Web Store。手动安装版本不会通过商店自动更新，更新时重新下载并加载新版。默认 Demo 无需 Key；启用真实 AI 时，在 API settings 配置自己的服务和 Key。

[隐私说明](https://pyroweiqiu.github.io/JevLens/privacy.html) · [Chrome Web Store 上架指南](CHROME_WEB_STORE.md)

## 开发者启动

要求 Node.js 22.13+（推荐 24 LTS） 和 Chrome/Chromium 116+（推荐最新版）。

```bash
npm install
npm run build
```

打开 `chrome://extensions`，启用开发者模式，点击“加载已解压的扩展程序”，选择项目下的 **`output/chrome-mv3`**。刷新已打开的网页，再点击工具栏里的 Jev Lens。

默认 **Demo** 模式只使用本地启发式评分，界面会明确标注；不调用 AI，也不上传页面内容。它可以完整演示提取、精确高亮、Navigator、PDF 和批准点击流程，不能代表 Jev 的语义判断质量。

```bash
npm run demo
# 浏览器打开 http://127.0.0.1:4173
```

开发热更新：`npm run dev`。可分发包：`npm run zip`。维护者运行 `npm run package:download`（需要 Python 3）可构建、检查并更新网站下载包；升级版本时同步修改网站与 README 中的下载链接。

## 设置 API：Jev 官方 / OpenRouter / 自定义

点击侧栏**底部输入框上方的 API settings**。选择连接方式，填写 API Key 和模型，再点击 **Save settings**。

| 方式         | Endpoint URL                                | 默认模型             |
| ------------ | ------------------------------------------- | -------------------- |
| Jev Official | `https://api.typesafe.ai/v1/systemone`      | `jev-latest`         |
| OpenRouter   | `https://openrouter.ai/api/alpha/decisions` | `typesafe/jev-1.13`  |
| Custom       | 自定义完整请求地址，含路径                  | `jev-latest`（可改） |

OpenRouter 使用原生 **Decisions API**。Custom 接口需要兼容 Jev 的 `state` / `questions` 请求及 `answers` 响应，包括 Score 和 Choice；不是通用 Chat Completions 接口。远程地址使用 HTTPS，本地代理支持 localhost HTTP。

每种方式独立保存地址、模型和 Key；切换平台不会复用其他平台的 Key。编辑不会自动生效，取消会丢弃本次修改。**Test connection** 会发送两个固定的小样本来验证 Score 和 Choice，不包含当前网页内容，可能产生少量 API 用量。只有勾选页面发送许可并保存后，才会把可读页面内容发到选中的 API；敏感页面及本地 PDF 仍需单独允许。

用户填写的 Key 仅保存到当前浏览器的扩展本地存储（不云同步，不写入构建包），内容脚本无法访问该存储。此存储不是系统密码保险库。接口、模型切换会取消旧任务，缓存按平台、地址和模型隔离。

### 可选：继续使用本地代理

如果希望 TypeSafe 密钥保留在服务器，可使用已有代理：

```bash
cp .env.example .env.local
# 编辑 .env.local，填写 TYPESAFE_API_KEY
npm run proxy
```

在 API settings 中选择 **Custom**，地址填写 `http://localhost:8787/v1/evaluate`，模型使用 `jev-latest`。如果服务器设置了 `LENS_PROXY_TOKEN`，在 API Key 字段填写代理令牌；否则可以留空。旧版本的 Jev 代理设置会自动迁移到 Custom。

代理支持请求大小限制、每分钟限流、上游超时、取消和来源校验；不记录页面文本，默认只监听 `127.0.0.1`。公开部署必须使用 HTTPS，并设置精确 `LENS_ALLOWED_ORIGINS` 和 `LENS_PROXY_TOKEN`；生产部署还需要独立用户认证和分布式配额。

没有提供实际密钥时，自动化测试使用模拟 HTTP 响应验证三种连接方式，**不代表真实账号的连通性或余额已验证**。

## 使用

- **SEE**：默认按句子分析；Sentence / Paragraph 切换粒度，Density 调整显示数量而不重新推理。悬停加强高亮，点击跳到精确原文，页面滚动同步卡片。
- **FIND**：点击 Find 后显示使用说明和当前页面标题示例；点击示例填入后，再点“查找”。底部也可直接输入意图，例如 `training GPUs` 或 `installation instructions`。自动跳到第一条匹配；箭头按钮切换；Escape 清除意图，恢复一般高亮。
- **ACT · 动作编排**：在“计划草稿”输入中英文复合任务，用“然后 / then / 换行 / 分号”分步，最多 12 步；候选库可搜索章节、按钮和链接，点击名称预览，＋添加到草稿。支持章节 / PDF 页码、点击、原文查找、页面滚动、等待（最多 10 秒）和手动步骤。每一步先推荐，再由用户确认；结束后手动推荐下一步。待执行步骤可上移、移除、跳过，Stop 可中止等待与请求。复杂语义选择使用已配置的 Jev；Demo 只做规则匹配。
- **PDF**：侧栏 Open PDF、页面右键 Open in Jev PDF Viewer，或者进入查看器后选择本地文件。PDF.js 与 worker 均本地打包。Chrome 151+ 支持注册的 PDF MIME stream；旧版使用显式打开路径。无需本地文件系统全局访问权限。
- **统计**：Settings → Developer stats 查看单位数、批次数、缓存命中、实际输入/输出 token 与累计时间。Demo token 为零。

快捷键默认 macOS `⌘⇧L` 打开/关闭、`⌘⇧F` 聚焦意图、`⌘⇧J` 启用 Cursor；Windows/Linux 使用 `Alt+Shift`。可在 `chrome://extensions/shortcuts` 重映射。Chrome 141+ 使用原生 close API，旧版也可用侧栏右上角关闭。侧栏左右位置遵循浏览器设置。

## 可以直接尝试的例子

先运行 `npm run demo`，在 Chrome 打开 `http://127.0.0.1:4173`，点击工具栏里的 Jev Lens。下面是本地测试文章的操作与预期；Demo 可以先验证交互，中文跨语言语义匹配需要可用的真实模型。

| 功能          | 操作或输入                                                                     | 预期观察                                                                                     |
| ------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| See 重点阅读  | 切换 Sentence / Paragraph，调整 Density，点击一张卡片                          | 网页高亮粒度和数量变化，点击后定位到对应原文                                                 |
| Find 训练信息 | 输入 `training GPUs`，点击“查找”                                               | 查找训练相关原文；文章写明 **eight GPUs**、**three days**                                    |
| Find 安装步骤 | 输入 `installation instructions`                                               | 定位 Installation 附近；原文包含 `npm install jev-lens` 和 `npm run dev`（这是测试文章内容） |
| Find 跨语言   | 使用 OpenRouter，输入 `训练需要多少块 GPU，耗时多久？`                         | 应找到包含 eight GPUs / three days 的英文原文；这项真实语义效果尚待有效 Key 验证             |
| Act 安全点击  | 在网页任意位置选择 Act，输入 `Open installation guide`                         | 推荐按钮出现光环；点击 **Approve & click** 后按钮文字变成 **Guide opened**                   |
| Act 风险拦截  | 在同一测试页的 Act 输入 `Delete account`                                       | 若推荐该按钮，插件应禁止自动批准点击，提示需要手动操作；也可能不推荐任何动作                 |
| PDF           | 将测试页通过浏览器打印保存为 PDF，用侧栏 Open PDF 打开，再搜索 `training GPUs` | 文字型 PDF 可以提取、高亮、定位；本地文件按提示单独允许                                      |

PDF 的 Act 支持页码和章节导航：先用 **Open PDF** 进入 Jev PDF Viewer，等待加载，然后输入 `go to page 10`、`go to Appendix`、`跳到附录`、`go to Appendix B`，或 `go to` 加目录中的完整标题。点击“推荐”，确认目标名称和页码，再点 **Approve & go**。这些明确导航不需要 API；优先读取目录书签，没有匹配书签时尝试文字层短标题。找不到目标时会提示更换准确标题或改用 Find；扫描 PDF 仍需要文字层才能匹配。

已用 arXiv `2609.13356` 的 48 页 PDF 验证：`go to Appendix`、`跳到附录` 和 `go to Pre-Training Details` 都指向第 30 页的附录起点。要重复此真实文档测试，将 PDF 下载到本地后运行：

```bash
JEV_PDF_QA_PATH=/absolute/path/to/2609.13356.pdf npm run test:e2e
```

也可以打开 [MDN CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API)，在真实模型可用后输入 `How do I register a highlight?`，检查是否定位到注册高亮的说明。Find 返回的是网页原文片段，不会生成聊天式回答。

## 普通网页的目录导航

文章、技术文档、Wiki、渲染后的 Markdown 和其他 HTML 页面，只要已加载内容中有标题或同页目录锚点，Act 就能构建“本页目录”。没有显式目录但使用 h1–h6 或 ARIA heading 的页面也支持。普通表格/区块只要有目录链接指向它的锚点，也可以定位。

- 点击 **Act → 本页目录中的标题 → 推荐 → Approve & go**；也可以直接输入 `go to Installation`、`跳到安装`、`go to References`、`跳到附录`。
- 优先按标题匹配，忽略常见章节编号，并支持安装、引言、参考文献、附录、结论、入门等常见中英文名称对应。任意语言的其他标题请使用原文中的名称。
- 同名章节会标明序号，点击目录中的对应项可准确选择，也可以用 **Skip** 切换。确认前不会滚动；确认后只定位章节，不触发目录链接的点击事件。
- 标题导航无需 API。目录链接限当前页面，不自动跨页面、展开折叠内容或加载无限滚动列表。最多收录 300 个标题/目录标签；隐藏内容、表单、编辑区、跨域 iframe 和 canvas 内容不纳入此导航。
- 页面改变后会重建目录；目标失效会要求重新推荐。打开另一页的链接仍使用原来的 Act 点击操作，例如 `Open documentation`。

## 验证

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium   # 首次使用 Playwright 时
npm run test:e2e
npm run qa:matrix                 # 从原计划生成 120 条用例
npm run qa:matrix -- --run --ids=4,9,17,24,25,95,113
```

显式运行真实 OpenRouter 验证（可能产生 API 用量，最多尝试 40 次推理请求）：

```bash
npm run qa:live
# 默认从 conf/jev_openrouter_keys.txt 读取一个 OpenRouter Key
# 也可指定文件：npm run qa:live -- /absolute/path/to/key-file.txt
```

脚本先检查 Key 认证，再依次验证连接、See、Find、缓存恢复、Act、PDF 和 MDN 页面。使用独立临时浏览器配置，结束后删除；不打印 Key、不记录请求头，报告与截图放在 `qa-results/live-openrouter/`。认证失败会停止，不会把未执行项目标记为通过。此脚本不会给日常浏览器中的插件自动填入 Key。

2026-09-27 实测：所提供 Key 在 OpenRouter 的认证与 Decisions 接口返回 **HTTP 401**；真实模型质量、延迟、用量尚未验证。类型检查、30 个单元测试和 4 个 Chromium 测试通过，其中远程推理响应使用模拟数据。

单元测试覆盖隐私过滤、跨节点范围、稳定标识、段落模式、中英文分句、风险动作、模型协议、密度与代理安全边界。端到端测试实际加载构建后的 MV3 扩展，验证网页高亮、Navigator UI、用户批准点击、路由内容更新及 PDF.js 文字层。

端到端截图输出在 `test-results/`。外部网页回归报告和截图输出在 `qa-results/`；`tests/fixtures/regression-matrix.json` 保留全部 120 条原计划用例。外部回归使用本地评分，不消耗 Jev 额度；有登录、付费墙或通配符的条目标记为人工验证。网络错误和站点不可访问不伪装为通过。

## 实现结构

| 路径                        | 职责                                                       |
| --------------------------- | ---------------------------------------------------------- |
| `entrypoints/background.ts` | 原生侧栏、快捷键、右键入口、网页/PDF 消息路由              |
| `entrypoints/sidepanel/`    | React 界面、任务取消、tab 状态、隐私许可                   |
| `entrypoints/pdf-viewer/`   | PDF.js 查看器、文字层、MIME/fallback 入口                  |
| `src/extraction/`           | DOM 块、heading 路径、中英文分句、精确 Range、PDF 段落重建 |
| `src/highlight/`            | CSS Custom Highlight；无 API 时采用矩形覆盖层              |
| `src/jev/`                  | 真实/模拟 Provider、Prompt、批处理、增量结果、密度选择     |
| `src/cache/`                | 内容哈希、IndexedDB 分数缓存（不存原文，7 天有效期）       |
| `src/cursor/`               | 可见动作、风险拦截、过期目标和遮挡复核                     |
| `src/messaging/`            | Zod 命令边界、页面运行时、SPA/DOM 变化观察                 |
| `server/`                   | 服务端密钥代理                                             |

## 当前边界

这是计划中的 Hackathon MVP，未实现计划列出的个人偏好学习、多标签检索、OCR、自动自治或 Web Store 发布。

- 跨域 iframe、关闭的 Shadow DOM、canvas 编辑器、浏览器内部页面不支持精确提取。不会绕过登录或付费墙。
- HTML 单次最多 2,400 个单位；优先评分当前视口附近，再处理剩余批次。复杂超长页仍可能需要进一步做后台切片和分层检索。
- PDF 根据文字层和坐标恢复段落；复杂双栏、表格、公式的阅读顺序可能不理想。扫描 PDF 提示无文字层。某些远程 PDF 需要下载后手动选择。
- Act 支持最多 12 步的可审阅编排，每一步独立确认；不会自动填写、提交或循环执行。跨屏查找仅覆盖已加载 DOM 的前 200 个非隐藏控件，不会展开菜单或自动加载无限滚动内容。风险判断是保守规则，不能证明任意网页按钮的实际副作用；执行前应查看高亮目标。
- API 请求取消、DOM 变化去抖与分数缓存已实现；真实模型延迟、排名质量及费用需要提供密钥后测量。
- HTTP(S) 全站权限用于内容脚本和用户选择的 PDF/代理访问；当前适合加载本地构建，尚未做商店分发审核。

接口核对来源：[TypeSafe API](https://docs.typesafe.ai/api)、[OpenRouter Jev Decisions](https://openrouter.ai/blog/insights/what-is-jev/)、[Score](https://docs.typesafe.ai/primitives/score)、[Choice](https://docs.typesafe.ai/primitives/choice)、[Chrome Side Panel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)、[Chrome MIME Handler](https://developer.chrome.com/docs/extensions/reference/api/mimeHandler)。

## 项目展示页与公开发布

`docs/` 网站包含 Overview / Examples / Docs 三个导航页。首页保留一屏 See / Find / Act 交互演示与安装指南；[Examples](https://pyroweiqiu.github.io/JevLens/examples.html) 收录原计划的 120 个场景（含重复 URL 的不同任务），支持分类、搜索、验证状态筛选、复制指令和分享单个案例；[Docs](https://pyroweiqiu.github.io/JevLens/guide.html) 提供安装、功能操作、PDF、API 与排错说明。桌面列表与详情分别滚动，手机点选案例后显示步骤。

案例是建议体验流程，不等于全部实测通过。7 个历史案例只标注 2026-09-27 的本地提取/高亮检查，不声称自然语言问题与真实 AI 效果已验证。手动场景与通配符地址单独解释支持边界。网站不调用 AI，不加载案例中的外部页面，也不收集 Key。

案例源清单为 `tests/fixtures/regression-matrix.json`，中文任务与指令在 `scripts/build-examples.mjs`；修改后运行 `npm run site:examples` 生成公开数据。不要把私有 QA 报告或真实账号内容复制到网站。

本地运行 `npm run site:preview`，打开 `http://127.0.0.1:4174`；另一个终端运行 `npm run site:check` 检查布局与交互。

GitHub Pages 发布来源为 **main 分支 /docs 目录**。公开仓库文件清单、排除规则与发布步骤见 [PUBLICATION.md](PUBLICATION.md)。提交前运行 `npm run audit:public`，不要使用强制添加绕过密钥目录的忽略规则。

## v0.2.0 动作编排例子

- `先跳到 Installation，然后查找 requirements，最后回到顶部`：章节导航 → 原文查找 → 滚动。
- `先跳到第2页，然后查找 conclusion，最后回到顶部`：在 Jev PDF Viewer 使用，文件需至少两页。
- `点击 "Reveal details"; 点击 "Next section"; 查找 GPUs; 回到顶部`：在含这些控件的页面展开内容后，下一步会重新读取已加载候选。
- `如果页面包含 "Training" 就查找 GPUs`：仅支持可读正文包含文本的简单条件；不存在时暂停，不伪装成完成。

支付、删除、发送、表单填写等仍是手动步骤。复杂的分支、循环和不明确条件会暂停，需改成明确步骤或手动处理。每次确认只执行当前一步；切换标签页或离开 Act 会重建流程。同标签页更新保留计划，但需要重新推荐目标。本文例子是操作语法，具体章节和控件必须真实存在。

已验证本地四步动态页面流程、条件不满足暂停、风险动作禁用和等待中止。真实 Jev 语义质量仍需要有效 Key 验证；不会把模拟模型测试算作真实 AI 验证。设计依据：[TypeSafe Choice](https://docs.typesafe.ai/primitives/choice) 与 [Function calling](https://docs.typesafe.ai/cookbooks/function_calling)。
