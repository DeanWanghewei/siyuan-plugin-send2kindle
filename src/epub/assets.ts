/**
 * 工作区图片收集：把清洗阶段收集到的 assets/ 路径读为二进制，映射为 EPUB 内嵌图片。
 */

import {getFileBinary} from "../api";
import {imageContentType} from "./xhtml";
import type {BodyImage} from "./xhtml";

export interface EpubImageData {
    target: string;
    data: Uint8Array;
    ext: string;
}

export async function fetchWorkspaceImages(
    refs: BodyImage[],
    onProgress?: (done: number, total: number) => void,
): Promise<{ images: EpubImageData[]; failures: string[] }> {
    const images: EpubImageData[] = [];
    const failures: string[] = [];
    for (let i = 0; i < refs.length; i++) {
        const ref = refs[i];
        try {
            const data = await getFileBinary(ref.srcPath);
            const ext = ref.target.split(".").pop() ?? "png";
            images.push({target: ref.target, data, ext});
        } catch (e) {
            console.warn("[send2kindle] fetch image failed:", ref.srcPath, e);
            failures.push(ref.srcPath);
        }
        onProgress?.(i + 1, refs.length);
    }
    return {images, failures};
}

export {imageContentType};
