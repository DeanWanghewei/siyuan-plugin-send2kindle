/**
 * Markdown → XHTML 转换、安全清洗、按标题切章。
 */

import MarkdownIt from "markdown-it";
import {sanitizeFilename} from "../utils";

const md = new MarkdownIt({
    html: true,       // 允许内嵌 HTML（经 sanitizeBody 白名单清洗）
    xhtmlOut: true,   // 输出 <br /> 等 XHTML 兼容标签
    linkify: false,
    typographer: false,
});

export interface ChapterSource {
    title: string;
    md: string;
}

export interface BodyImage {
    /** 工作区路径（已 decode），如 assets/foo-20230501-bar.png */
    srcPath: string;
    /** EPUB 包内路径，如 images/img-0.png */
    target: string;
}

export interface SanitizedBody {
    /** 清洗后的 body inner HTML */
    html: string;
    /** 文档内引用的工作区图片列表 */
    images: BodyImage[];
}

/**
 * 按标题级别切分 Markdown 为章节数组。
 * splitLevel <= 0 表示不切分；切分点为层级 <= splitLevel 的 ATX 标题。
 * 代码块围栏内的 # 行不会误判为标题。
 */
export function splitMarkdownIntoChapters(markdown: string, splitLevel: number): ChapterSource[] {
    if (splitLevel <= 0) {
        return [{title: "", md: markdown}];
    }
    const lines = markdown.split(/\r?\n/);
    const chapters: ChapterSource[] = [];
    let cur: ChapterSource = {title: "", md: ""};
    let curLines: string[] = [];
    let fence: { ch: string; len: number } | null = null;

    const flush = () => {
        if (curLines.length > 0 || cur.title) {
            cur.md = curLines.join("\n");
            chapters.push(cur);
        }
    };

    for (const line of lines) {
        const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
        if (fenceMatch) {
            const ch = fenceMatch[1][0];
            const len = fenceMatch[1].length;
            const hasInfo = !!fenceMatch[2].trim();
            if (!fence) {
                // 开围栏：允许 ```python 这类 info string
                fence = {ch, len};
            } else if (ch === fence.ch && len >= fence.len && !hasInfo) {
                // 闭围栏：同一字符、长度不小于开围栏、不能带 info string
                fence = null;
            }
            curLines.push(line);
            continue;
        }
        if (!fence) {
            const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
            if (heading && heading[1].length <= splitLevel) {
                flush();
                cur = {title: stripInlineMarkdown(heading[2]), md: ""};
                curLines = [];
                continue;
            }
        }
        curLines.push(line);
    }
    flush();

    if (chapters.length === 0) {
        return [{title: "", md: markdown}];
    }
    return chapters;
}

/** 去除标题中的行内 Markdown 标记，用于章节名/目录 */
export function stripInlineMarkdown(s: string): string {
    return s
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[*_`~]+/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/** Markdown → HTML 片段 */
export function renderMarkdown(markdown: string): string {
    return md.render(markdown);
}

const REMOVE_TAGS = new Set([
    "script", "style", "iframe", "object", "embed", "form", "input",
    "button", "select", "textarea", "audio", "video", "source", "canvas",
    "link", "meta", "base",
]);

const KEEP_ATTRS = new Set(["href", "src", "alt", "title", "colspan", "rowspan"]);

/**
 * 用 DOMParser 对渲染产物做白名单清洗：
 * - 删除 script/iframe/媒体等元素；
 * - 删除事件属性与 class/style/data 等属性（Kindle 转换会丢弃，索性清干净）；
 * - assets/ 图片改写为 EPUB 包内路径并收集；远端图片删除（转换服务无法回源）；
 * - siyuan:// 协议链接去掉 href（仅保留文字）。
 */
export function sanitizeBody(html: string): SanitizedBody {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const images: BodyImage[] = [];
    const seen = new Map<string, string>();

    const walk = (node: Element) => {
        for (const child of Array.from(node.children)) {
            const tag = child.tagName.toLowerCase();
            if (REMOVE_TAGS.has(tag)) {
                child.remove();
                continue;
            }
            if (tag === "img") {
                const src = (child.getAttribute("src") ?? "").trim();
                let decoded = src;
                try {
                    decoded = decodeURIComponent(src);
                } catch {
                    /* 保留原值 */
                }
                if (/^assets\//i.test(decoded)) {
                    let target = seen.get(decoded);
                    if (!target) {
                        target = `images/img-${seen.size}${imageExt(decoded)}`;
                        seen.set(decoded, target);
                        images.push({srcPath: decoded, target});
                    }
                    child.setAttribute("src", target);
                    child.removeAttribute("srcset");
                    for (const attr of Array.from(child.attributes)) {
                        if (!KEEP_ATTRS.has(attr.name.toLowerCase())) {
                            child.removeAttribute(attr.name);
                        }
                    }
                } else {
                    // 远端或 data: 图片：Kindle 转换服务无法获取，替换为 alt 文本
                    const alt = child.getAttribute("alt") ?? "";
                    child.replaceWith(alt ? doc.createTextNode(`[${alt}]`) : doc.createTextNode(""));
                }
                continue;
            }
            for (const attr of Array.from(child.attributes)) {
                const name = attr.name.toLowerCase();
                if (!KEEP_ATTRS.has(name) || name === "title") {
                    child.removeAttribute(attr.name);
                }
            }
            if (tag === "a") {
                const href = child.getAttribute("href") ?? "";
                if (!/^https?:/i.test(href)) {
                    child.removeAttribute("href");
                }
            }
            walk(child);
        }
    };

    walk(doc.body);

    // 保留 title 属性：上面的循环把 title 也删了，这里单独放行 img 的 title 无必要，简化处理
    return {html: doc.body.innerHTML, images};
}

function imageExt(path: string): string {
    const base = path.split("/").pop() ?? "";
    const m = base.match(/\.([a-z0-9]+)$/i);
    const ext = (m?.[1] ?? "png").toLowerCase();
    const known = ["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp"];
    return known.includes(ext) ? ext : "png";
}

export function imageContentType(ext: string): string {
    switch (ext.toLowerCase()) {
        case "jpg":
        case "jpeg":
            return "image/jpeg";
        case "gif":
            return "image/gif";
        case "bmp":
            return "image/bmp";
        case "svg":
            return "image/svg+xml";
        case "webp":
            return "image/webp";
        default:
            return "image/png";
    }
}

/** 章节标题的兜底名（用于目录显示） */
export function chapterFallbackTitle(index: number): string {
    return sanitizeFilename(`Chapter ${index + 1}`, `Chapter ${index + 1}`);
}
