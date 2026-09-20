/**
 * 邮件 MIME 组装：multipart/mixed，正文 base64 + EPUB 附件 base64。
 * 全文使用 CRLF 行结束符（SMTP 规范）。
 */

import {base64Utf8, bytesToBase64, randomHex, toAsciiFilename} from "../utils";

export interface MailAttachment {
    /** ASCII 安全的附件文件名 */
    filename: string;
    contentType: string;
    data: Uint8Array;
}

export interface BuildMailOptions {
    from: string;
    fromName?: string;
    to: string;
    subject: string;
    bodyText: string;
    attachments: MailAttachment[];
}

/** RFC 2047 encoded-word，超长时拆成多个 encoded-word */
export function encodeMimeWord(s: string): string {
    const words: string[] = [];
    let chunk = "";
    let chunkBytes = 0;
    for (const ch of s) {
        const chBytes = new TextEncoder().encode(ch).length;
        if (chunkBytes + chBytes > 30) {
            words.push(chunk);
            chunk = "";
            chunkBytes = 0;
        }
        chunk += ch;
        chunkBytes += chBytes;
    }
    if (chunk) {
        words.push(chunk);
    }
    return words.map(w => `=?UTF-8?B?${base64Utf8(w)}?=`).join(" ");
}

export function buildMail(opts: BuildMailOptions): string {
    const boundary = `----=_s2k_${randomHex(24)}`;
    const headers: string[] = [];

    const fromName = opts.fromName?.trim();
    headers.push(fromName
        ? `From: ${encodeMimeWord(fromName)} <${opts.from}>`
        : `From: ${opts.from}`);
    headers.push(`To: ${opts.to}`);
    headers.push(`Subject: ${encodeMimeWord(opts.subject)}`);
    headers.push(`Date: ${formatDate(new Date())}`);
    headers.push(`Message-ID: <${Date.now()}.${randomHex(12)}@${opts.from.split("@")[1] ?? "localhost"}>`);
    headers.push("MIME-Version: 1.0");
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);

    const parts: string[] = [];

    parts.push(`--${boundary}\r\n` +
        "Content-Type: text/plain; charset=UTF-8\r\n" +
        "Content-Transfer-Encoding: base64\r\n" +
        "\r\n" +
        wrapBase64(base64Utf8(opts.bodyText || " ")) +
        "\r\n");

    for (const att of opts.attachments) {
        const name = toAsciiFilename(att.filename, "attachment");
        parts.push(`--${boundary}\r\n` +
            `Content-Type: ${att.contentType}; name="${name}"\r\n` +
            "Content-Transfer-Encoding: base64\r\n" +
            `Content-Disposition: attachment; filename="${name}"\r\n` +
            "\r\n" +
            wrapBase64(bytesToBase64(att.data)) +
            "\r\n");
    }

    return headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + `--${boundary}--\r\n`;
}

function wrapBase64(b64: string): string {
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += 76) {
        lines.push(b64.slice(i, i + 76));
    }
    return lines.join("\r\n");
}

/** RFC 5322 日期，如 Mon, 15 Sep 2026 12:00:00 +0800 */
function formatDate(d: Date): string {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const pad = (n: number) => String(n).padStart(2, "0");
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ` +
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
}
