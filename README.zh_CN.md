# 发送到 Kindle (SiYuan Send to Kindle)

将思源笔记文档一键转换为 EPUB，并通过 Amazon **Send-to-Kindle** 邮件通道发送到你的 Kindle 设备。英文说明见 [README.md](README.md)。

## 功能特性

- 📄 **单篇文档一键发送**：文档树右键菜单 / 顶栏按钮 / 快捷键 `⌥⇧K`
- 📚 **EPUB 3 输出**：自动切章（可选 H1/H2/H3）、内嵌 `assets/` 图片、生成目录（nav + NCX 双兼容）、标题页与作者元数据
- ✉️ **SMTP 直发**：支持 SSL(465) / STARTTLS(587)，AUTH PLAIN / LOGIN 自动协商（QQ / 163 / Gmail / Outlook 均可）
- 💾 **本地导出**：不经过邮件，直接保存 `.epub` 文件（也可用于调试）
- 🧪 **测试邮件**：设置面板一键验证 SMTP 配置与 Amazon 白名单是否就绪

> 仅支持桌面端（Windows / macOS / Linux）。移动端可使用「保存为本地 EPUB」。

## 使用前的一次性配置（重要）

1. **查 Kindle 接收地址**：登录 Amazon → 「管理我的内容和设备」→「首选项」→「个人文档设置」，找到形如 `xxx_xxx@kindle.com` 的地址。
2. **加白发件邮箱**：同一页面「已批准的个人文档发件邮箱列表」中，**添加你的发件邮箱**（如 `yourname@qq.com`）。不加白名单会被 Amazon 直接拒收。
3. **获取 SMTP 授权码**：
   - QQ 邮箱：设置 → 账户 → 开启 SMTP 服务 → 生成授权码（服务器 `smtp.qq.com`，SSL 端口 `465`）
   - 163 邮箱：设置 → POP3/SMTP → 开启并获取授权码（服务器 `smtp.163.com`，SSL `465`）
   - Gmail：需开启两步验证后生成 App Password（服务器 `smtp.gmail.com`，SSL `465`）

然后在思源「设置 → 集合/插件 → 发送到 Kindle」中填入以上信息，点击**「发送测试邮件」**验证。

## 使用方式

- **文档树**：右键任意文档 → 菜单底部的「插件」子菜单（旧版思源为顶层菜单项）→ 「发送到 Kindle…」
- **顶栏**：点击右上角纸飞机图标，发送当前打开的文档
- **快捷键**：`⌥⇧K`（可在设置中修改）

弹窗标题为「发送当前页面到 Kindle」，书名自动预填当前文档标题，可修改；点「发送」走邮件通道，点「保存为本地 EPUB」直接下载文件。

## 安全说明

- SMTP 授权码保存在工作区 `data/storage/` 目录（明文 JSON）。请使用邮箱服务商生成的**专用授权码**，不要使用登录密码，并定期更换。
- 邮件内容（EPUB 附件）经由你自己的邮箱服务商与 Amazon 投递，本插件不经过任何第三方服务器。

## 工作原理

```
文档 ──/api/export/exportMdContent──▶ Markdown ──markdown-it──▶ XHTML（白名单清洗）
   │                                                          │
   └──/api/file/getFile──▶ assets 图片 ──────────────────────┤
                                                              ▼
                                    EPUB 3 打包（JSZip：opf + nav + ncx + 章节 + 图片）
                                                              ▼
                                    MIME 组装（base64 附件）──▶ SMTP ──▶ xxx@kindle.com
```

Kindle 接收后由 Amazon 服务端自动转换为 KFX 格式并同步到设备。已知限制：数学公式以 LaTeX 源码呈现、mermaid/图表与远端图片会被占位/跳过、大部分 CSS 样式会被 Amazon 转换器丢弃（以语义标签排版）。

## 开发

```bash
npm install
npm run dev          # 开发模式（配合 make-link 软链到工作区）
npm run build        # 生产构建 + 打包 package.zip
npm test             # 烟雾测试（EPUB 打包 / MIME / SMTP 状态机）
```

详细设计见 [DESIGN.md](DESIGN.md)。

## License

MIT
