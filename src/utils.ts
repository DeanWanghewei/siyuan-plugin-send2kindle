/**
 * Shared helpers: encoding, escaping, filename sanitizing.
 */

export function bytesToBase64(bytes: Uint8Array): string {
    if (typeof btoa === "function") {
        let binary = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        return btoa(binary);
    }
    return Buffer.from(bytes).toString("base64");
}

export function utf8Bytes(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

export function base64Utf8(s: string): string {
    return bytesToBase64(utf8Bytes(s));
}

export function escapeXml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

export function randomHex(len: number): string {
    const bytes = new Uint8Array(Math.ceil(len / 2));
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}

export function randomUuid(): string {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    const h = randomHex(32);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** 清理为安全文件名（保留中文等 unicode，去掉路径分隔与控制字符） */
export function sanitizeFilename(name: string, fallback = "book"): string {
    const cleaned = name
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || fallback;
}

/** 转为纯 ASCII 文件名（用于邮件附件名），非 ASCII 字符替换为下划线 */
export function toAsciiFilename(name: string, fallback = "book"): string {
    const cleaned = name
        .normalize("NFKD")
        .replace(/[^\x20-\x7e]/g, "_")
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/_+/g, "_")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || fallback;
}
