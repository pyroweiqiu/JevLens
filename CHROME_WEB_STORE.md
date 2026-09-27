# JevLens 上架 Chrome Web Store

当前状态：已有可直接加载的生产 ZIP 和公开下载链接，**尚未向商店提交，也尚未通过审核**。网站安装按钮目前打开手动安装指南。以下步骤由拥有 Google 开发者账号的维护者完成。

## 1. 注册开发者账号

登录 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole)，同意开发者条款并支付一次性注册费（金额以后台显示为准）。设置发布者名称、联系邮箱并完成后台要求的账号验证及两步验证。

官方资料：[注册](https://developer.chrome.com/docs/webstore/register)、[设置账号](https://developer.chrome.com/docs/webstore/set-up-account)。

## 2. 上传扩展 ZIP

点击 **Add new item / 新增项目**，上传 `docs/downloads/JevLens-0.1.0-chrome.zip`。

- 这是可运行的扩展包，不是 GitHub 的源码 ZIP。
- `manifest.json` 在 ZIP 根目录；PNG 图标已包含在 `icons/` 中。
- 包内不含个人 API Key。不要把 `conf/`、整个项目目录或浏览器用户数据压入 ZIP。
- 后续版本先提升 `package.json` 的 `version`，运行 `npm run package:download`，同步网站下载链接，再上传新包；版本号必须递增。

官方资料：[准备扩展](https://developer.chrome.com/docs/webstore/prepare)、[上传和提交](https://developer.chrome.com/docs/webstore/publish)。

## 3. 填写商店展示内容

可使用以下文案作为起点，提交时应与实际功能一致：

**名称：** JevLens

**简短介绍：** Chrome 浏览器中的阅读助手：高亮网页与 PDF 重点、查找相关原文、确认后按章节导航。

**详细介绍：**

> JevLens 是一个 Chrome 浏览器助手插件，帮助你在网页和文字型 PDF 中快速找到值得阅读的内容。
>
> See：高亮重要原文，保留上下文。
> Find：输入问题或关键词，定位相关原文片段。
> Act：按页码或章节导航，或在确认后执行推荐的页面点击。
>
> 默认 Demo 使用本地规则，无需账号或 API Key。更强的语义分析需要你自行配置 Jev、OpenRouter 或兼容接口及 API Key，服务商可能收取费用。插件不会提供免费无限 AI 额度。
>
> 不支持扫描 PDF 的 OCR，也不自动填写或提交表单。

**网站：** https://pyroweiqiu.github.io/JevLens/

**支持：** https://github.com/pyroweiqiu/JevLens/issues

**隐私政策：** https://pyroweiqiu.github.io/JevLens/privacy.html

**图片：**

- 128 × 128 PNG 图标：已有 `public/icons/128.png`。
- 440 × 280 宣传图：仍需制作并上传。
- 至少一张实际插件截图，1280 × 800 或 640 × 400；建议分别展示 See、Find、Act。使用真实扩展界面截图，不能把网站里的模拟交互当作实际插件截图；避免拍到 Key、私人页面或账号信息。

官方资料：[图片要求](https://developer.chrome.com/docs/webstore/images)。

## 4. 填写 Privacy practices

单一用途可填：**帮助用户阅读当前网页和 PDF，通过重点高亮、原文检索与用户确认后的导航定位相关内容。**

当前权限的用途说明如下，提交前再次按实际使用审查；移除不必要权限后需要重新打包。

| 权限 | 当前用途 |
| --- | --- |
| sidePanel | 在 Chrome 原生侧栏显示阅读助手与交互结果 |
| storage | 本地保存接口配置、用户 Key 和设置，不云同步 |
| activeTab / tabs | 识别当前页面、路由页面与侧栏消息、读取当前标签页信息和打开 PDF 查看器；提交前检查是否两者都需要 |
| contextMenus | 提供“Open in Jev PDF Viewer”右键入口 |
| HTTP(S) 网站权限 | 在用户阅读的网页提取和高亮文本，访问选择的 PDF 及配置的 AI 接口；当前是全站权限，需说明为何需要这一范围 |

**不要声明“不处理任何用户数据”。** 默认 Demo 不上传，但开启真实 AI 后会发送页面文本、标题、处理后的 URL、查找意图，以及操作推荐所需的候选元素等信息到用户选择的服务。Key 也用于请求认证。按后台数据类别如实披露网站内容、相关浏览信息及认证信息等处理方式，并确保与隐私说明一致。

当前代码的 JavaScript、PDF.js 和 worker 随包发布；AI 服务返回评分/选择数据，不提供远程可执行代码。依据实际打包结果填写 remote code 字段。维护者应阅读并确认数据使用承诺与服务商条款，不能仅复制勾选。

官方资料：[隐私字段与权限说明](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)。

## 5. 给审核人员测试说明

建议填写：

1. 安装后打开普通文本网页，点击工具栏 JevLens，使用默认 Demo 模式。
2. See 点击卡片观察原文定位；Find 输入网页已有关键词，点击查找。
3. Act 输入 `go to` 加网页已有章节标题，推荐后确认跳转。
4. 通过侧栏 Open PDF 或右键入口打开文字型 PDF，测试 `go to page 2`；章节匹配需要目录或可匹配标题。
5. 真实 AI 在 API settings 中启用，需可用的 Jev / OpenRouter 账户、Key、余额与页面发送许可。若审核需要测试账号，在后台专用测试说明字段提供受限、可撤销的测试凭据，不放进 ZIP、公开文档或截图。

**提交前仍需验证：** 用有效 Key 实测真实 AI 功能。此前提供的 Key 返回 HTTP 401，因此现有自动化测试不能证明真实模型的连通性或语义效果。另需复核全站权限是否可缩小，并准备上述真实截图和宣传图。

## 6. 提交审核并上线

在 Distribution 选择面向公众的分发范围，检查所有必填项，点击 **Submit for review**。可按后台选项选择审核通过后自动发布或等待手动发布；不要向用户承诺固定审核时间。

审核通过并发布后，复制实际商店详情页地址，把网站的安装入口改成该链接。用户就可以直接通过商店“添加至 Chrome”，并通过商店获得后续版本更新。当前没有商店 ID，不应使用占位商店链接。

官方资料：[提交审核](https://developer.chrome.com/docs/webstore/publish)、[更新扩展](https://developer.chrome.com/docs/webstore/update)。
