/**
 * SiYuan kernel API wrappers.
 */

import { fetchSyncPost } from "siyuan";

export interface ApiResponse<T = any> {
    ok: boolean;
    code: number;
    msg: string;
    data: T | null;
}

export async function request<T = any>(url: string, data?: any): Promise<ApiResponse<T>> {
    const raw = await fetchSyncPost(url, data);
    const ok = raw?.code === 0;
    return {
        ok,
        code: raw?.code ?? -1,
        msg: raw?.msg ?? "",
        data: ok ? (raw.data as T) : null,
    };
}

export interface ExportedDoc {
    /** 层级路径，如 /日记/2026-09-15 */
    hPath: string;
    /** Markdown 内容 */
    content: string;
}

/** 导出文档为 Markdown（输出可能受用户导出设置影响，见 siyuan issue #14032） */
export async function exportMdContent(docId: string): Promise<ExportedDoc> {
    const r = await request<any>("/api/export/exportMdContent", {id: docId});
    if (!r.ok || !r.data?.content) {
        throw new Error(`exportMdContent failed: ${r.msg || `code=${r.code}`}`);
    }
    return {hPath: String(r.data.hPath ?? ""), content: String(r.data.content)};
}

export interface WorkspaceImage {
    /** 工作区内路径，如 assets/foo-20230501-bar.png */
    srcPath: string;
    /** EPUB 包内目标文件名，如 images/img-0.png */
    target: string;
}

/** 通过 /api/file/getFile 读取工作区内文件二进制（需要带 token 的原始 fetch） */
export async function getFileBinary(path: string): Promise<Uint8Array> {
    const token = window.siyuan?.config?.api?.token ?? "";
    const resp = await fetch("/api/file/getFile", {
        method: "POST",
        headers: {
            "Authorization": `Token ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({path}),
    });
    if (!resp.ok) {
        throw new Error(`getFile(${path}) failed: HTTP ${resp.status}`);
    }
    return new Uint8Array(await resp.arrayBuffer());
}
