/**
 * EPUB 3 打包（JSZip）。
 *
 * 结构：
 *   mimetype                 （STORE、必须为 zip 首条目）
 *   META-INF/container.xml
 *   OEBPS/content.opf        （metadata + manifest + spine）
 *   OEBPS/nav.xhtml          （EPUB3 目录）
 *   OEBPS/toc.ncx            （旧设备兼容目录）
 *   OEBPS/style.css
 *   OEBPS/text/chapter-N.xhtml
 *   OEBPS/images/img-N.ext
 */

import JSZip from "jszip";
import {escapeXml, randomUuid} from "../utils";
import {imageContentType} from "./xhtml";

export interface EpubChapter {
    title: string;
    /** body inner XHTML（已清洗） */
    bodyHtml: string;
}

export interface EpubImage {
    /** 包内路径，如 images/img-0.png */
    target: string;
    data: Uint8Array;
    /** 扩展名，如 png */
    ext: string;
}

export interface BuildEpubOptions {
    title: string;
    author?: string;
    language?: string;
    chapters: EpubChapter[];
    images: EpubImage[];
}

export async function buildEpub(opts: BuildEpubOptions): Promise<Uint8Array> {
    const uuid = randomUuid();
    const lang = opts.language || "zh-CN";
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

    const zip = new JSZip();
    // mimetype 必须是第一个条目且不压缩
    zip.file("mimetype", "application/epub+zip", {compression: "STORE"});
    zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`);

    zip.file("OEBPS/style.css", STYLE_CSS);

    // 文档（text/chapter-N.xhtml），首个章节为标题页
    const manifestItems: string[] = [
        `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
        `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
        `<item id="css" href="style.css" media-type="text/css"/>`,
    ];
    const spineRefs: string[] = [];
    const tocEntries: { href: string; title: string }[] = [];

    const allChapters: EpubChapter[] = [];
    if (opts.title) {
        allChapters.push({
            title: "",
            bodyHtml: `<h1 class="s2k-title">${escapeXml(opts.title)}</h1>` +
                (opts.author ? `<p class="s2k-author">${escapeXml(opts.author)}</p>` : ""),
        });
    }
    for (const ch of opts.chapters) {
        allChapters.push(ch);
    }

    allChapters.forEach((ch, i) => {
        const href = `text/chapter-${i + 1}.xhtml`;
        const id = `chap-${i + 1}`;
        // 标题页（i=0 且设置了书名）自带 h1；其余有标题的章节补回正文标题（切章时标题行被移除）
        const isTitlePage = i === 0 && !!opts.title;
        const body = ch.title && !isTitlePage
            ? `<h1 class="s2k-chapter">${escapeXml(ch.title)}</h1>\n${ch.bodyHtml}`
            : ch.bodyHtml;
        zip.file(`OEBPS/${href}`, wrapXhtml(ch.title || opts.title, body));
        manifestItems.push(`<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
        spineRefs.push(id);
        tocEntries.push({href, title: ch.title || opts.title || `Chapter ${i + 1}`});
    });

    // images
    opts.images.forEach((img, i) => {
        manifestItems.push(`<item id="img-${i + 1}" href="${escapeXml(img.target)}" media-type="${imageContentType(img.ext)}"/>`);
    });

    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(lang)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(opts.title)}</dc:title>
    <dc:language>${escapeXml(lang)}</dc:language>
${opts.author ? `    <dc:creator>${escapeXml(opts.author)}</dc:creator>\n` : ""}    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
${manifestItems.map(s => "    " + s).join("\n")}
  </manifest>
  <spine toc="ncx">
${spineRefs.map(id => `    <itemref idref="${id}"/>`).join("\n")}
  </spine>
</package>
`;
    zip.file("OEBPS/content.opf", opf);
    zip.file("OEBPS/nav.xhtml", buildNav(opts.title, tocEntries, lang));
    zip.file("OEBPS/toc.ncx", buildNcx(opts.title, tocEntries, uuid));

    opts.images.forEach(img => {
        zip.file(`OEBPS/${img.target}`, img.data, {binary: true});
    });

    return zip.generateAsync({
        type: "uint8array",
        compression: "DEFLATE",
        compressionOptions: {level: 6},
    });
}

function wrapXhtml(title: string, bodyHtml: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="../style.css"/>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

function buildNav(bookTitle: string, entries: { href: string; title: string }[], lang: string): string {
    const lis = entries.map(e => `      <li><a href="${escapeXml(e.href)}">${escapeXml(e.title)}</a></li>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}">
<head>
  <title>${escapeXml(bookTitle)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeXml(bookTitle)}</h1>
    <ol>
${lis}
    </ol>
  </nav>
</body>
</html>
`;
}

function buildNcx(bookTitle: string, entries: { href: string; title: string }[], uuid: string): string {
    const points = entries.map((e, i) => `    <navPoint id="navpoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(e.title)}</text></navLabel>
      <content src="${escapeXml(e.href)}"/>
    </navPoint>`).join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${escapeXml(uuid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(bookTitle)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

const STYLE_CSS = `body {
  margin: 5%;
  line-height: 1.6;
}
h1 { font-size: 1.5em; margin: 1em 0 0.6em; }
h2 { font-size: 1.3em; margin: 1em 0 0.5em; }
h3, h4, h5, h6 { margin: 0.9em 0 0.4em; }
p { margin: 0.4em 0; text-align: justify; }
blockquote {
  margin: 0.6em 0; padding: 0.1em 0.8em;
  border-left: 3px solid #999; color: #555;
}
pre, code { font-family: monospace; font-size: 0.9em; }
pre {
  white-space: pre-wrap; word-wrap: break-word;
  padding: 0.5em; background: #f4f4f4;
}
table { border-collapse: collapse; width: 100%; margin: 0.6em 0; }
th, td { border: 1px solid #999; padding: 0.3em 0.5em; }
img { max-width: 100%; }
.s2k-title { margin-top: 3em; text-align: center; }
.s2k-author { text-align: center; color: #666; }
`;
