/**
 * Node 烟雾测试：EPUB 打包、MIME 组装、切章、SMTP 状态机（含隐式 TLS）。
 * 运行：node test/run.mjs（由 esbuild 打包后执行）
 */

import assert from "node:assert";
import JSZip from "jszip";
import net from "node:net";
import tls from "node:tls";
import {buildEpub} from "../src/epub/builder";
import {splitMarkdownIntoChapters, renderMarkdown, imageContentType} from "../src/epub/xhtml";
import {buildMail, encodeMimeWord} from "../src/kindle/mime";
import {sendMailViaSmtp} from "../src/kindle/smtp";

let passed = 0;
const ok = (name: string) => {
    passed++;
    console.log(`  ✓ ${name}`);
};

// ── 切章 ────────────────────────────────────────────────────────────────
function testSplit() {
    const md = [
        "前言内容",
        "# 第一章",
        "内容 A",
        "```python",
        "# 这不是标题",
        "print('x')",
        "```",
        "## 1.1 小节",
        "内容 B",
        "# 第二章",
        "内容 C",
    ].join("\n");

    const one = splitMarkdownIntoChapters(md, 0);
    assert.equal(one.length, 1);
    ok("splitLevel=0 不切分");

    const h1 = splitMarkdownIntoChapters(md, 1);
    assert.equal(h1.length, 3); // 前言 + 两章
    assert.equal(h1[0].title, "");
    assert.equal(h1[1].title, "第一章");
    assert.equal(h1[2].title, "第二章");
    assert.ok(h1[1].md.includes("内容 A"));
    assert.ok(h1[1].md.includes("# 这不是标题"), "代码块内的 # 不应被误判");
    ok("splitLevel=1 按一级标题切分，围栏内不误判");

    const h2 = splitMarkdownIntoChapters(md, 2);
    assert.equal(h2.length, 4);
    assert.equal(h2[2].title, "1.1 小节");
    ok("splitLevel=2 按二级标题切分");

    const html = renderMarkdown("# x\n\n**bold** <u>u</u>");
    assert.ok(html.includes("<strong>bold</strong>"));
    ok("markdown-it 渲染");
}

// ── EPUB 打包 ───────────────────────────────────────────────────────────
async function testEpub() {
    const imgData = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const bytes = await buildEpub({
        title: "我的书 / My Book",
        author: "Dean",
        language: "zh-CN",
        chapters: [
            {title: "", bodyHtml: "<p>前言</p>"},
            {title: "第一章", bodyHtml: '<p>hello <img src="images/img-0.png" alt="图"/></p>'},
            {title: "第二章", bodyHtml: "<p>world</p>"},
        ],
        images: [{target: "images/img-0.png", data: imgData, ext: "png"}],
    });

    // mimetype 必须是首条目且 STORED（压缩方法字段 = 0）
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    assert.equal(dv.getUint16(8, true), 0, "mimetype must be STORED");
    const firstLen = dv.getUint16(26, true);
    const firstName = new TextDecoder().decode(bytes.subarray(30, 30 + firstLen));
    assert.equal(firstName, "mimetype");
    ok("mimetype 首条目 + STORE");

    const zip = await JSZip.loadAsync(bytes);
    assert.equal(await zip.file("mimetype")!.async("string"), "application/epub+zip");
    assert.ok(zip.file("META-INF/container.xml"));
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    assert.ok(opf.includes("<dc:title>我的书 / My Book</dc:title>"));
    assert.ok(opf.includes('properties="nav"'));
    assert.ok(opf.includes('href="images/img-0.png" media-type="image/png"'));
    const nav = await zip.file("OEBPS/nav.xhtml")!.async("string");
    assert.ok(nav.includes("第一章") && nav.includes("chapter-2.xhtml"));
    const ncx = await zip.file("OEBPS/toc.ncx")!.async("string");
    assert.ok(ncx.includes("<text>第二章</text>"));
    const ch1 = await zip.file("OEBPS/text/chapter-1.xhtml")!.async("string");
    assert.ok(ch1.includes("s2k-title"), "第一章应为标题页");
    const ch2 = await zip.file("OEBPS/text/chapter-2.xhtml")!.async("string");
    assert.ok(ch2.includes("<p>前言</p>"));
    const ch3 = await zip.file("OEBPS/text/chapter-3.xhtml")!.async("string");
    assert.ok(ch3.includes('<h1 class="s2k-chapter">第一章</h1>'));
    assert.ok(ch3.includes('xmlns="http://www.w3.org/1999/xhtml"'));
    const img = await zip.file("OEBPS/images/img-0.png")!.async("uint8array");
    assert.deepEqual(Array.from(img), Array.from(imgData));
    ok("EPUB 结构（container/opf/nav/ncx/章节/图片）");

    assert.equal(imageContentType("jpg"), "image/jpeg");
    assert.equal(imageContentType("weird"), "image/png");
    ok("图片类型映射");
}

// ── MIME ────────────────────────────────────────────────────────────────
function testMime() {
    const subject = "中文书名 Chapter One";
    const epubBytes = new Uint8Array(1000).map((_, i) => i % 251);
    const msg = buildMail({
        from: "sender@qq.com",
        fromName: "思源笔记",
        to: "my_kindle@kindle.com",
        subject,
        bodyText: "正文内容",
        attachments: [{filename: "中文名 Book.epub", contentType: "application/epub+zip", data: epubBytes}],
    });

    assert.ok(msg.includes("\r\n"), "必须使用 CRLF");
    assert.equal(msg.split("\r").length, msg.split("\r\n").length, "不允许裸 CR");
    assert.ok(!/(?<!\r)\n/.test(msg.replace(/\r\n/g, "")), "不允许裸 LF");
    assert.ok(msg.startsWith("From: =?UTF-8?B?"));
    assert.ok(msg.includes("<sender@qq.com>"));
    assert.ok(msg.includes("Subject: =?UTF-8?B?"));
    assert.ok(encodeMimeWord(subject).split(" ").every(w => w.length <= 75));
    assert.ok(msg.includes('filename="_ Book.epub"'), "附件名应转为 ASCII");
    assert.ok(msg.includes("Content-Type: application/epub+zip"));

    // 附件 base64 可还原
    const b64 = msg.split('filename="_ Book.epub"')[1]
        .split("\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, "");
    assert.equal(b64.length % 4, 0);
    ok("MIME 头与附件封装");

    // 无纯 ASCII 主题时也要可解码
    const ew = encodeMimeWord("测试");
    assert.match(ew, /^= \? UTF-8 \? B \? /.source ? /^=\?UTF-8\?B\?/ : /x/);
    ok("encoded-word 格式");
}

// ── 假 SMTP 服务器 ──────────────────────────────────────────────────────
interface FakeServer {
    port: number;
    received: string[];
    close: () => Promise<void>;
}

function startFakeSmtp(tlsOptions: { key: Buffer; cert: Buffer } | null = null): Promise<FakeServer> {
    const received: string[] = [];
    const handler = (socket: any) => {
        let authed = false;
        let inData = false;
        let dataBuf = "";
        socket.write("220 fake ESMTP ready\r\n");
        socket.on("data", (chunk: Buffer) => {
            const text = chunk.toString("utf8");
            if (inData) {
                dataBuf += text;
                const end = dataBuf.indexOf("\r\n.\r\n");
                if (end >= 0) {
                    received.push(dataBuf.slice(0, end + 2));
                    dataBuf = dataBuf.slice(end + 5);
                    inData = false;
                    socket.write("250 queued\r\n");
                }
                return;
            }
            for (const rawLine of text.split("\r\n")) {
                if (!rawLine) continue;
                const line = rawLine.toUpperCase();
                if (line.startsWith("EHLO") || line.startsWith("HELO")) {
                    socket.write("250-fake greets you\r\n250-AUTH PLAIN LOGIN\r\n250 SMTPUTF8\r\n");
                } else if (line.startsWith("AUTH PLAIN")) {
                    const b64 = rawLine.slice("AUTH PLAIN ".length).trim();
                    const decoded = Buffer.from(b64, "base64").toString("utf8");
                    if (decoded === "\u0000user@qq.com\u0000pass1234") {
                        authed = true;
                        socket.write("235 ok\r\n");
                    } else {
                        socket.write("535 bad credentials\r\n");
                    }
                } else if (line.startsWith("AUTH LOGIN")) {
                    socket.write("334 VXNlcm5hbWU6\r\n");
                } else if (authed && line.startsWith("MAIL FROM:")) {
                    socket.write("250 ok\r\n");
                } else if (authed && line.startsWith("RCPT TO:")) {
                    socket.write("250 ok\r\n");
                } else if (line === "DATA") {
                    inData = true;
                    dataBuf = "";
                    socket.write("354 go\r\n");
                } else if (line.startsWith("QUIT")) {
                    socket.write("221 bye\r\n");
                    socket.end();
                } else {
                    socket.write("550 rejected\r\n");
                }
            }
        });
    };

    const server = tlsOptions
        ? tls.createServer(tlsOptions, handler)
        : net.createServer(handler);
    return new Promise((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const port = (server.address() as any).port;
            resolve({
                port,
                received,
                close: () => new Promise((res) => server.close(() => res())),
            });
        });
    });
}

async function testSmtpPlain() {
    const fake = await startFakeSmtp();

    const message = [
        "From: user@qq.com",
        "To: my_kindle@kindle.com",
        "Subject: =?UTF-8?B?dGVzdA==?=",
        "",
        "line one",
        ".leading dot line",
        "last line",
    ].join("\r\n");

    await sendMailViaSmtp(
        {host: "127.0.0.1", port: fake.port, encryption: "none", user: "user@qq.com", password: "pass1234", timeoutMs: 3000},
        "user@qq.com",
        "my_kindle@kindle.com",
        message,
        {modules: {net, tls}},
    );

    assert.equal(fake.received.length, 1);
    const got = fake.received[0];
    assert.ok(got.includes("\r\n..leading dot line\r\n"), "点填充");
    assert.ok(got.trimEnd().endsWith("last line"), "DATA 结束点之前的最后内容");
    await fake.close();
    ok("SMTP 明文会话：EHLO/AUTH PLAIN/MAIL/RCPT/DATA + 点填充");
}

async function testSmtpImplicitTls() {
    const {execSync} = await import("node:child_process");
    execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout /tmp/s2k-key.pem -out /tmp/s2k-cert.pem -days 2 -nodes -subj "/CN=localhost" 2>/dev/null`,
    );
    const fs = await import("node:fs");
    const fake = await startFakeSmtp({
        key: fs.readFileSync("/tmp/s2k-key.pem"),
        cert: fs.readFileSync("/tmp/s2k-cert.pem"),
    });

    // 客户端默认校验证书，测试里放行自签名
    const patchedTls = Object.create(tls);
    const origConnect = tls.connect.bind(tls);
    (patchedTls as any).connect = (opts: any) => origConnect({...opts, rejectUnauthorized: false});

    await sendMailViaSmtp(
        {host: "127.0.0.1", port: fake.port, encryption: "ssl", user: "user@qq.com", password: "pass1234", timeoutMs: 3000},
        "user@qq.com",
        "my_kindle@kindle.com",
        "Subject: tls-test\r\n\r\nhi",
        {modules: {net, tls: patchedTls}},
    );
    assert.equal(fake.received.length, 1);
    await fake.close();
    ok("SMTP 隐式 TLS（465 场景）会话");
}

async function testSmtpAuthFailure() {
    const fake = await startFakeSmtp();
    await assert.rejects(
        () => sendMailViaSmtp(
            {host: "127.0.0.1", port: fake.port, encryption: "none", user: "user@qq.com", password: "WRONG", timeoutMs: 3000},
            "user@qq.com", "k@kindle.com", "Subject: x\r\n\r\nx",
            {modules: {net, tls}},
        ),
        (err: any) => String(err.code) === "535",
    );
    await fake.close();
    ok("认证失败抛出 SmtpError(535)");
}

async function main() {
    testSplit();
    await testEpub();
    testMime();
    await testSmtpPlain();
    await testSmtpImplicitTls();
    await testSmtpAuthFailure();
    console.log(`\nAll ${passed} smoke tests passed ✅`);
}

main().catch(err => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
});
