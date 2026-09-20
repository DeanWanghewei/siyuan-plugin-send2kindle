# Send2Kindle — 思源笔记一键发送到 Kindle · 设计方案

> 状态：设计阶段（2026-09-15）。实现前请先审阅本文档的「方案选型」与「分期计划」。

---

## 一、Kindle 接收方式调研结论

### 1.1 五种官方接收通道

| 通道 | 机制 | 插件自动化可行性 |
|---|---|---|
| **邮件（Send to Kindle Email）** | 发送附件到设备的 `xxx@kindle.com` 地址 | ✅ **唯一可全自动的通道**，无登录态、无第三方服务 |
| Web 上传 | amazon.com/sendtokindle 页面拖拽上传 | ❌ 需 Amazon 登录态 + 有 CSRF 校验，无法从插件自动化 |
| Kindle 手机 App | iOS/Android 系统分享面板 | ❌ 需要在手机上操作 |
| 桌面 App（Mac/Win） | 独立应用拖拽上传 | ❌ 要求用户另装 Amazon 桌面客户端 |
| Chrome 扩展 | 抓取网页文章 | ❌ 仅适用于浏览器页面，不适用于思源 |

邮件通道的关键约束（亚马逊官方帮助页）：

- 发件人邮箱必须加入 Amazon「Approved Personal Document Email List」（最多 15 个），否则直接拒收 —— **用户首次使用必须完成这一步，插件要给出引导**；
- 单封邮件最多 **25 个附件**，总大小 **≤ 50 MB**（ZIP 附件会被自动解压转换）；
- 文档直接进入 Kindle 云端图书馆，在线设备自动同步，投递失败会重试最长 60 天；
- **Amazon 没有公开的 Send-to-Kindle API**。第三方逆向 API 不稳定且有账号安全风险，不采用。

### 1.2 支持的文件格式（官方当前列表）

`EPUB`、`PDF`、`DOC`、`DOCX`、`TXT`、`RTF`、`HTM`、`HTML`、`JPEG/JPG`、`GIF`、`PNG`、`BMP`

> 注意：**MOBI/AZW 自 2022 年起已从 Send-to-Kindle 支持列表移除**，网上旧教程推荐 MOBI 的做法已失效。

### 1.3 格式选型：EPUB ✅

| 格式 | 结论 | 理由 |
|---|---|---|
| **EPUB** | ✅ 采用 | 可重排（reflow），6 英寸墨水屏阅读体验最佳；完整保留标题/列表/表格/代码/图片；原生多章节结构（spine + nav 目录），与思源的文档树/标题层级天然映射 |
| PDF | ❌ | 固定版式，Kindle 上无法重排，需不停缩放拖动 |
| HTML | 备选 | 可用但单文件，无目录/章节概念，仅适合应急 |
| TXT | ❌ | 丢失全部格式 |
| DOCX | ❌ | 转换不透明、排版不可控 |

EPUB 送到 Amazon 后由服务端自动转换为 KFX/AZW3，转换环节成熟稳定（calibre 同路线）。

### 1.4 发送通道实现方式

**结论：插件内置极简 SMTP 客户端直连用户邮箱发信**（收件人 = Kindle 地址）。

- 思源桌面端是 Electron，渲染进程开放 Node 能力（`window.require("tls"/"net")`），可实现 SMTP（465 隐式 TLS / 587 STARTTLS，AUTH PLAIN / LOGIN）。这是 calibre「邮件发送到 Kindle」与 Obsidian 同类插件的成熟做法。
- 运行时做**特性检测**：`window.require` 不存在（移动端 App / 纯浏览器模式）→ 明确提示仅桌面端可用，并提供降级出口「导出 .epub 到本地/下载」。
- 否决的备选：
  - 第三方邮件 API（SendGrid/Mailgun）：要求用户注册第三方服务 + API Key，门槛与隐私顾虑高；
  - 思源内核 `/api/network/forwardProxy`：仅支持 HTTP，发不了 SMTP；
  - 新版内核端插件（petal/goja）的 `client.fetch`：同样仅 HTTP。

## 二、思源侧设计

### 2.1 脚手架

以 **frostime/plugin-sample-vite** 为模板（vite 构建、CJS 单文件产物、YAML i18n、dev 目录软链热更、zip 打包一条龙）。

> 注意：官方 `siyuan-note/plugin-sample` 仓库现在已是**内核端插件**（goja 引擎、`globalThis.siyuan` API）的样例，不是我们要做的 UI 插件形态，仅作内核 API 参考；UI 插件以 vite 样例的 `Plugin` 类写法为准。

依赖计划：`marked` 或 `markdown-it`（Markdown→HTML，二选一，倾向 markdown-it）、`jszip`（EPUB 打包）。SMTP 客户端**自己实现**（约 300 行，避免打包 nodemailer 的体积与 webpack 兼容问题）。

### 2.2 数据获取（内核 API）

| API | 用途 |
|---|---|
| `POST /api/export/exportMdContent` `{id}` | 导出文档为 Markdown（返回 `hPath` 层级路径 + `content`） |
| `POST /api/file/getFile` `{path}` | 读取 `assets/` 图片二进制，嵌入 EPUB |
| `POST /api/filetree/listDocsByPath` | 列出子文档树（V2 多文档合并用） |
| `POST /api/filetree/getHPathByID` | 取文档层级路径（书名/章节名） |

已知问题：`exportMdContent` 的输出会受用户「导出设置」影响（官方 issue #14032），管线要做防御性解析。

### 2.3 插件入口（交互）

1. **文档树右键菜单**（eventBus `open-menu-doctree`）→「发送到 Kindle」——主入口；
2. **顶栏图标**（`addTopBar`）→ 菜单：发送当前文档 / 打开设置；
3. 命令面板快捷键（`addCommand`）；
4. 点击后弹出**发送确认对话框**：书名、章节切分级别、是否包含子文档（V2）→ 发送 → 进度 toast → 成功/失败反馈。

### 2.4 转换管线（V1：单篇文档 → 一本 EPUB）

```
文档 ID
  │ /api/export/exportMdContent
  ▼
Markdown + hPath
  │ 抽取 assets 引用 ──► /api/file/getFile ──► 图片二进制
  ▼
markdown-it ──► XHTML（标签/样式白名单清洗，思源私有属性剥离）
  │ 按标题级别切章（默认 H1，可配置）
  ▼
EPUB 3 打包（JSZip）
  mimetype（STORED、必须是 zip 首条目）
  META-INF/container.xml
  OEBPS/content.opf（dc:title=书名, dc:language=zh-CN, uuid）
  OEBPS/nav.xhtml + toc.ncx（新旧设备双兼容目录）
  OEBPS/chapter-*.xhtml + OEBPS/images/*
  ▼
MIME 组装（multipart/mixed；正文极简；EPUB base64 附件；Subject=书名）
  ▼
SMTP 发送到 xxx@kindle.com
  ▼
结果反馈（含错误分类：535 授权码错误 / 550 发件人未加白名单 / 连接超时…）
```

元素降级策略：块引用/嵌入块 → 展开内联文本并尾注标记；数学公式 → 保留 LaTeX 源码文本（Kindle 渲染差）；mermaid/图表 → 占位提示；超长文档 > 45MB → 拒发并提示。

### 2.5 设置项（复用 vite 样例的 SettingUtils）

- **Kindle 收件地址**（必填，形如 `xxx_xxx@kindle.com`）
- **SMTP**：服务器、端口、加密方式（SSL/STARTTLS）、账号、**授权码**、发件人显示名
- 高级：书名模板（默认 `文档名`）、章节切分级别、默认包含子文档、作者元数据
- 「发送测试邮件」按钮 + 「保存本地 .epub」调试按钮
- 安全说明：授权码保存在工作区 `data/storage/`（明文），界面上提示用户使用邮箱服务商的**专用授权码**而非登录密码

### 2.6 代码结构（建议）

```
src/
  index.ts            # 插件入口：菜单/命令/顶栏注册
  api.ts              # 内核 API 封装（仿 vite 样例）
  settings.ts         # SettingUtils 配置项
  epub/
    builder.ts        # EPUB3 打包（JSZip）
    xhtml.ts          # Markdown → XHTML + 清洗
    assets.ts         # 图片收集与嵌入
  kindle/
    smtp.ts           # 极简 SMTP 客户端（TLS/STARTTLS/AUTH）
    mime.ts           # 邮件 MIME 组装
  ui/
    send-dialog.ts    # 发送确认对话框
i18n/  (zh_CN / en_US)
```

## 三、分期计划

| 阶段 | 范围 |
|---|---|
| **V1（MVP）** | 单篇文档 → 单本 EPUB → SMTP 邮件发送；文档树右键 + 顶栏入口；设置面板；进度/错误反馈；「保存本地 .epub」降级按钮 |
| **V1.5** | 发送选项对话框（书名/切章级别）；发送历史记录；常用文档快速重发 |
| **V2** | **多文档/整个文件夹 → 一本书**：`listDocsByPath` 递归展开文档树 → nav 层级目录（文档=章节，子文档=小节）；批量发送队列 |
| **V3（可选）** | 移动端支持（需自建 HTTP→SMTP 桥接服务，或引导用桌面端）；EPUB 封面自动生成；按标签/书名筛选批量发送 |

## 四、风险与开放问题

1. **Node 能力依赖**：若未来思源桌面版关闭 `nodeIntegration`，SMTP 直发失效 —— 已设计运行时检测 + 「导出 .epub」降级出口；届时可再评估内核端桥接。
2. **exportMdContent 受用户导出设置影响**（issue #14032）：对产物做防御性校验（标题、图片引用完整性）。
3. **Amazon 对 EPUB 内嵌 CSS 支持有限**：转换服务会丢弃大部分样式，管线以语义标签为主、样式为辅。
4. **图片格式**：思源内的 SVG Amazon 支持不佳，转 PNG 需渲染管线（V1 可先提示跳过 SVG）。
5. 授权码明文存储风险 → 文案引导 + 后续可调研系统钥匙串。
