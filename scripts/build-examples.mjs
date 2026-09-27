// Public recipes derived from the original 120-case matrix; no private QA reports are bundled.
import { readFile, writeFile } from 'node:fs/promises';
const rows = JSON.parse(await readFile('tests/fixtures/regression-matrix.json', 'utf8'));
const recipes = `
arXiv · 新论文摘要|contribution|论文的主要贡献是什么？
arXiv · 新论文全文|experiments|实验如何支持论文结论？
Attention Is All You Need · 摘要|attention|这篇论文提出了什么方法？
Attention Is All You Need · PDF|attention|模型架构和实验结果在哪里？
Agent 论文 · PDF|results|智能体的实验结果和限制是什么？
研究论文 · PDF|method|方法的关键定义是什么？
NeurIPS · 会议论文|abstract|在哪里找到摘要和论文入口？
ScienceDirect · 期刊文章|abstract|可见摘要有哪些核心结论？
TypeSafe · 认识 Jev|Jev|Jev 是什么，适合什么任务？
OpenReview · 论文与评审|review|可见评审提出了哪些问题？
Qwen UI Agent · 项目页|benchmark|如何评估这个 UI 智能体？
Mostik · 技术文章|model|文章最重要的技术主张是什么？
FlashREINFORCE · 项目页|results|方法带来了哪些实验改进？
Recurrent Looped Transformer|architecture|模型架构有什么特点？
Notion · 技术公开页|training|训练和推理方法是什么？
Laya · GitHub 仓库|installation|如何安装并运行这个项目？
MDN · JavaScript 指南|grammar|JavaScript 基础语法从哪里学起？
Python · 官方教程|modules|教程中如何介绍模块？
PyTorch · FSDP 文档|warning|使用 FSDP 有哪些注意事项？
Kubernetes · Deployment|rolling update|Deployment 如何滚动更新？
Google Cloud · IAM|roles|角色和访问权限如何组织？
Apple · NavigationStack|navigation|NavigationStack 如何管理导航？
Next.js · App 文档|routing|如何理解 App Router 的路由？
Rust · 所有权|ownership|什么是所有权，为什么需要它？
Browser Use · GitHub|installation|这个项目如何安装和使用？
Browser Use · Issues|bug|当前列表有哪些问题报告？
Browser Use · Pull requests|fix|当前列表有哪些修复提案？
Browser Use · README|usage|README 中有哪些使用示例？
Stack Overflow · React 状态|setState|如何更新 React 状态中的对象？
Hacker News · 新闻列表|comments|哪些条目包含相关讨论入口？
Reddit · Machine Learning|research|当前可见帖子在讨论哪些研究？
Hugging Face · Qwen 模型卡|limitations|模型的使用方式和限制是什么？
OpenAI · 文章索引|research|当前有哪些研究文章入口？
Anthropic · 研究索引|research|当前有哪些研究主题？
Vercel · 博客|performance|有哪些关于性能的文章？
PyTorch · 博客|training|有哪些关于训练的技术内容？
Cloudflare · 工程博客|performance|文章有哪些关键技术发现？
Netflix · 技术博客|architecture|系统设计有哪些经验？
Spotify · 工程博客|engineering|有哪些工程实践值得阅读？
Slack · 工程博客|architecture|文章如何解释系统架构？
Reuters · 科技新闻|technology|可见新闻有哪些事实和来源？
The Guardian · AI 专题|artificial intelligence|当前 AI 新闻报道了什么？
The Verge · AI 新闻|AI|报道的关键信息在哪里？
TechCrunch · AI 新闻|AI|新闻的主要事件是什么？
WIRED · AI 专题|intelligence|哪些文章与这个主题有关？
Ars Technica · AI|model|报道提到了哪些技术细节？
AP · AI 新闻|artificial intelligence|可见报道的核心事实是什么？
Al Jazeera · AI 专题|artificial intelligence|报道提供了哪些事实和引述？
EUR-Lex · AI Act 原文|Article 3|定义条款在原文哪里？
GOV.UK · AI Playbook|principles|指南列出了哪些原则？
Singapore · 国家 AI 战略|strategy|页面介绍了哪些战略目标？
IMDA · AI 资源|governance|有哪些治理框架和资源？
SEC · Apple 披露列表|10-K|在哪里找到年度报告入口？
IRS · 税务说明索引|1040|在哪里找到对应表格的说明？
WHO · 出版物索引|health|有哪些相关出版物与摘要？
NHTSA · 自动驾驶安全|safety|页面提出了哪些安全原则？
MIT OCW · 线性代数|syllabus|课程大纲和学习材料在哪里？
Khan Academy · 微积分|derivatives|导数相关课程在哪里？
Coursera · 机器学习|syllabus|课程大纲和先修要求是什么？
edX · CS50|learn|这门课程覆盖哪些内容？
Stanford · CS229|schedule|课程时间表和讲义在哪里？
Berkeley · 深度强化学习|lectures|课程讲义和作业入口在哪里？
3Blue1Brown · 线性代数|vectors|向量相关主题在哪里？
Wikipedia · Transformer|architecture|Transformer 的结构如何介绍？
Apple · iPhone 选购页|storage|页面列出了哪些存储选项？
Amazon · 机械键盘列表|keyboard|可见商品有哪些价格和属性？
IKEA · 办公椅列表|chair|办公椅有哪些可见规格？
Best Buy · 笔记本列表|laptop|可见商品的规格和价格在哪里？
eBay · 机械键盘列表|shipping|商品页面有哪些运费信息？
Etsy · 桌垫列表|desk mat|可见商品有哪些属性？
Steam · Counter-Strike 2|system requirements|游戏的系统要求在哪里？
Sephora · 防晒产品|SPF|可见产品标注了哪些属性？
Yahoo Finance · AAPL|market cap|页面中市值指标在哪里？
Google Finance · AAPL|market cap|页面列出了哪些公司指标？
Coinbase · Bitcoin|market cap|市场数据的标签和说明在哪里？
Stripe · 定价|fees|费用条款和适用条件在哪里？
AWS · EC2 定价|on-demand|不同计费方式的说明在哪里？
OpenAI · API 定价|input|输入和输出计费条款在哪里？
Apple · 投资者关系|earnings|财报与公告入口在哪里？
Macrotrends · Apple 收入|revenue|有哪些可读的收入数据和说明？
Booking · 新加坡酒店|cancellation|哪些可见内容说明取消条件？
Tripadvisor · 新加坡酒店|rating|酒店评分和位置在哪里？
Airbnb · 新加坡住宿|night|当前可见住宿如何展示费用？
Expedia · 新加坡酒店|fees|页面是否说明额外费用？
Skyscanner · 航班搜索|stops|可见航班如何展示经停次数？
Singapore Airlines · 航空主页|travel|当前有哪些旅行通知？
Google Maps · 新加坡餐厅|reviews|可见地点列表有哪些评价信息？
Rome2Rio · 城际路线|bus|有哪些交通方式和时间说明？
Wikipedia · 深度学习|neural networks|深度学习的关键概念是什么？
Britannica · 人工智能|intelligence|文章如何定义人工智能？
RFC 9110 · HTTP 语义|status codes|状态码规范在什么位置？
WHATWG · HTML 标准|elements|相关 HTML 元素如何定义？
ECMAScript · 语言规范|abstract operations|抽象操作如何定义？
Cornell · 美国宪法|Article I|第一条的原文在哪里？
MDN · CSS 高亮 API|HighlightRegistry|如何注册一个自定义高亮？
OWASP · Top Ten|injection|注入风险的说明在哪里？
Medium · AI 文章列表|intelligence|可见文章有哪些主题？
Substack · 订阅首页|newsletter|当前可见订阅内容是什么？
Notion · 博客|Notion|文章介绍了哪些功能？
YouTube · 神经网络视频|neural network|展开的简介或字幕如何解释神经网络？
DEV · AI 文章|AI|当前可见文章有哪些开发实践？
Hashnode · AI 文章|AI|当前有哪些相关开发文章？
Product Hunt · AI 产品|AI|产品的可见介绍和用途是什么？
X · OpenAI 动态|OpenAI|当前已加载的公开动态是什么？
经典论文 PDF · 架构定位|architecture|在长 PDF 中定位模型架构的原文。
研究论文 PDF · 实验定位|experiments|在长 PDF 中定位实验设置的原文。
WHO · AI 报告 PDF|health|报告列出了哪些关键原则？
NHTSA · 自动驾驶报告 PDF|recommendations|报告有哪些建议和结论？
IMDA · AI 治理框架 PDF|principles|框架列出了哪些治理原则？
CS229 · 课程讲义 PDF|regression|回归的定义与推导在哪里？
IRS · 1040 说明 PDF|deadline|原文在哪里说明相关日期？
Qwen UI Agent · 技术报告|benchmark|报告如何描述评测方法？
React · Learn 文档|components|React 如何解释组件？
Gmail · 隐私边界|inbox|仅检查敏感页面的许可提示。
Google Docs · 编辑器边界|document|检查编辑区域的支持限制。
Figma · Canvas 边界|layers|检查可访问 DOM 与画布的边界。
YouTube · 视频页模板|transcript|只查找你已展开并可见的字幕文本。
Reddit · 动态帖子模板|discussion|只检索当前已加载的帖子内容。
Financial Times · 付费文章|summary|只检索已获授权且可见的文章部分。
本地 PDF · 文件与许可|introduction|在你选择的文字型 PDF 中定位引言。
`
  .trim()
  .split('\n')
  .map((line) => line.split('|'));
if (recipes.length !== rows.length) throw new Error('Recipe count must match source matrix');
const groups = [
  [16, 'research', '论文与研究'],
  [32, 'development', '开发与代码'],
  [40, 'blogs', '技术博客'],
  [48, 'news', '新闻与报道'],
  [56, 'public', '公共资料'],
  [64, 'learning', '课程与学习'],
  [72, 'shopping', '商品与规格'],
  [80, 'pricing', '价格与数据'],
  [88, 'travel', '旅行与地图'],
  [96, 'reference', '百科与标准'],
  [104, 'community', '社区与媒体'],
  [112, 'pdf', 'PDF 专题'],
  [113, 'development', '开发与代码'],
  [120, 'boundaries', '支持边界'],
];
// Historical local extraction/highlight checks only. No claim of live AI validation.
const extractionChecked = new Set([4, 9, 17, 24, 25, 95, 113]);
const examples = rows.map((row, index) => {
  const [title, keyword, question] = recipes[index];
  const [, category, categoryLabel] = groups.find(([end]) => row.id <= end);
  const pdf = /pdf/i.test(row.archetype) || row.url.startsWith('file:');
  const template = row.url.includes('*');
  return {
    ...row,
    title,
    keyword,
    question,
    category,
    categoryLabel,
    pdf,
    template,
    status: extractionChecked.has(row.id) ? 'extraction' : row.manual ? 'manual' : 'unverified',
    checkedOn: extractionChecked.has(row.id) ? '2026-09-27' : null,
  };
});
const output =
  '// Generated by npm run site:examples. Edit scripts/build-examples.mjs.\nexport const examples = ' +
  JSON.stringify(examples, null, 2) +
  ';\n';
await writeFile('docs/examples-data.js', output);
console.log(`Generated ${examples.length} public example recipes.`);
