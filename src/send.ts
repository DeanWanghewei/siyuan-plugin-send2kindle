/**
 * 发送管线：文档 → EPUB →（本地保存 | SMTP 邮件 → Kindle）。
 */

import {showMessage} from "siyuan";
import {exportMdContent} from "./api";
import {buildEpub} from "./epub/builder";
import {fetchWorkspaceImages} from "./epub/assets";
import {
    chapterFallbackTitle,
    renderMarkdown,
    sanitizeBody,
    splitMarkdownIntoChapters,
} from "./epub/xhtml";
import {buildMail} from "./kindle/mime";
import {
    NoNodeEnvironmentError,
    SmtpError,
    sendMailViaSmtp,
} from "./kindle/smtp";
import {readSettings} from "./settings";
import {sanitizeFilename, toAsciiFilename} from "./utils";
import type {Plugin} from "siyuan";

export interface SendTaskOptions {
    docId: string;
    /** 书名，缺省取文档名 */
    bookTitle?: string;
    /** 覆盖设置里的切章级别 */
    splitLevel?: number;
}

export class SettingsMissingError extends Error {
}

export function validateSettings(s: ReturnType<typeof readSettings>, i18n: any): string | null {
    if (!s.kindleAddr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.kindleAddr)) {
        return i18n.invalidKindleAddr;
    }
    if (!s.smtpHost || !s.smtpPort) {
        return i18n.settingsMissing;
    }
    return null;
}

/** 导出文档并组装 EPUB，返回 (bytes, 书名) */
export async function prepareEpub(
    plugin: Plugin,
    opts: SendTaskOptions,
): Promise<{ bytes: Uint8Array; title: string }> {
    const i18n = plugin.i18n;
    const settings = readSettings((plugin as any).settingUtils);

    showMessage(i18n.exporting, 2000, "info");
    const doc = await exportMdContent(opts.docId);
    const docName = doc.hPath.split("/").filter(Boolean).pop() || "Untitled";
    const title = (opts.bookTitle ?? "").trim() || docName;
    const splitLevel = opts.splitLevel ?? settings.splitLevel;

    showMessage(i18n.buildingEpub, 2000, "info");
    const chapters = splitMarkdownIntoChapters(doc.content, splitLevel).map((c, i) => {
        const rendered = renderMarkdown(c.md);
        const clean = sanitizeBody(rendered);
        return {chapter: c, clean, index: i};
    });

    // 收集全部图片引用（去重由 sanitize 里的 seen map 保证）
    const allImageRefs = chapters.flatMap(c => c.clean.images);
    const {images} = await fetchWorkspaceImages(allImageRefs);

    const bytes = await buildEpub({
        title,
        author: settings.bookAuthor || undefined,
        language: "zh-CN",
        chapters: chapters.map((c, i) => ({
            title: c.chapter.title || (chapters.length > 1 ? chapterFallbackTitle(i) : ""),
            bodyHtml: c.clean.html,
        })),
        images,
    });
    return {bytes, title};
}

/** 触发浏览器下载保存 .epub（桌面端/浏览器端均可用） */
export function saveEpubLocally(bytes: Uint8Array, title: string) {
    const blob = new Blob([bytes as BlobPart], {type: "application/epub+zip"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(title, "book")}.epub`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 完整发送：EPUB 组装 + SMTP 投递 */
export async function sendDocumentToKindle(plugin: Plugin, opts: SendTaskOptions): Promise<void> {
    const i18n = plugin.i18n;
    const settings = readSettings((plugin as any).settingUtils);

    const invalid = validateSettings(settings, i18n);
    if (invalid) {
        throw new SettingsMissingError(invalid);
    }

    const {bytes, title} = await prepareEpub(plugin, opts);

    if (bytes.length > 45 * 1024 * 1024) {
        throw new Error(i18n.epubTooLarge);
    }

    showMessage(i18n.sending, 10000, "info");
    const message = buildMail({
        from: settings.smtpUser,
        fromName: settings.senderName || undefined,
        to: settings.kindleAddr,
        subject: title,
        bodyText: `Sent from SiYuan Note: ${title}`,
        attachments: [{
            filename: `${toAsciiFilename(title, "book")}.epub`,
            contentType: "application/epub+zip",
            data: bytes,
        }],
    });

    await sendMailViaSmtp({
        host: settings.smtpHost,
        port: settings.smtpPort,
        encryption: settings.smtpEncryption,
        user: settings.smtpUser,
        password: settings.smtpPassword,
    }, settings.smtpUser, settings.kindleAddr, message, {
        onLog: line => console.debug("[send2kindle smtp]", line),
    });

    showMessage(i18n.sendSuccess, 6000, "info");
}

/** 把发送/组装过程中的异常翻译为用户可读信息 */
export function explainError(err: unknown, i18n: any): string {
    if (err instanceof SettingsMissingError) {
        return err.message;
    }
    if (err instanceof NoNodeEnvironmentError) {
        return i18n.noNodeEnv;
    }
    if (err instanceof SmtpError) {
        const code = String(err.code);
        if (code === "535" || code === "534" || code === "530") {
            return i18n.smtpAuthFailed;
        }
        const raw = err.message.toUpperCase();
        if (code === "550" || code === "551" || code === "553" || code === "554") {
            // 收件地址不存在（如 550 5.1.1 <xxx@kindle.cn>: recipient address rejected: User unknown）
            if (raw.includes("5.1.1") || raw.includes("USER UNKNOWN") || raw.includes("ADDRESS DOES NOT EXIST") || raw.includes("NO SUCH USER")) {
                return i18n.smtpAddrNotExist;
            }
            return i18n.smtpRejected;
        }
        if (code === "connect" || code === "timeout" || code === "network" || code === "closed") {
            return i18n.smtpConnectFailed;
        }
        return err.message;
    }
    return (err as Error)?.message ?? String(err);
}

export async function sendTestEmail(plugin: Plugin): Promise<void> {
    const i18n = plugin.i18n;
    const settings = readSettings((plugin as any).settingUtils);
    const invalid = validateSettings(settings, i18n);
    if (invalid) {
        throw new SettingsMissingError(invalid);
    }
    const message = buildMail({
        from: settings.smtpUser,
        fromName: settings.senderName || undefined,
        to: settings.kindleAddr,
        subject: "SiYuan Send2Kindle Test / 测试邮件",
        bodyText: "If you can see this document on your Kindle, the configuration is OK.\n" +
            "收到这封邮件说明 SMTP 配置正确。请确认发件邮箱已加入 Amazon「已批准的发件人」列表。",
        attachments: [],
    });
    await sendMailViaSmtp({
        host: settings.smtpHost,
        port: settings.smtpPort,
        encryption: settings.smtpEncryption,
        user: settings.smtpUser,
        password: settings.smtpPassword,
    }, settings.smtpUser, settings.kindleAddr, message, {
        onLog: line => console.debug("[send2kindle smtp]", line),
    });
}
