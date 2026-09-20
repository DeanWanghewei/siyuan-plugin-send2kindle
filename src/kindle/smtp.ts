/**
 * 极简 SMTP 客户端。
 *
 * 依赖 Node 的 net/tls 模块。在思源桌面端（Electron，nodeIntegration 开启）
 * 渲染进程里通过 window.require 获取；注意插件打包产物内的裸 `require` 是
 * 思源前端自己的模块加载器，不是 Node 的 require。
 *
 * 支持：隐式 TLS(465)、STARTTLS(587)、AUTH PLAIN / LOGIN、超时控制。
 */

export type SmtpEncryption = "ssl" | "starttls" | "none";

export interface SmtpConfig {
    host: string;
    port: number;
    encryption: SmtpEncryption;
    user: string;
    password: string;
    timeoutMs?: number;
}

export class SmtpError extends Error {
    code: number | string;
    constructor(code: number | string, message: string) {
        super(`SMTP ${code}: ${message}`);
        this.code = code;
    }
}

/** 当前环境没有可用的 Node 模块（移动端/纯浏览器模式） */
export class NoNodeEnvironmentError extends Error {
    constructor() {
        super("Node.js modules (net/tls) are not available in this environment");
    }
}

export interface NodeModules {
    tls: any;
    net: any;
}

/** 从 Electron 渲染进程获取 Node 模块；测试时可直接注入。 */
export function resolveNodeModules(): NodeModules {
    const req = window?.require;
    if (typeof req !== "function") {
        throw new NoNodeEnvironmentError();
    }
    try {
        return {tls: req("tls"), net: req("net")};
    } catch {
        throw new NoNodeEnvironmentError();
    }
}

interface Reply {
    code: number;
    lines: string[];
}

/**
 * 单条 SMTP 连接的回复读取器。
 * SMTP 回复为多行时，最后一行形如 "250 done"（code 后跟空格），其余行 "250-xxx"。
 */
class SmtpConnection {
    socket: any;
    private buf = "";
    private waiter: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null;
    private timer: any = null;
    private timeoutMs: number;

    constructor(socket: any, timeoutMs: number) {
        this.socket = socket;
        this.timeoutMs = timeoutMs;
        socket.on("data", this.onData);
        socket.on("error", this.onError);
        socket.on("close", this.onClose);
    }

    private onData = (chunk: any) => {
        this.buf += chunk.toString("latin1");
        this.tryResolve();
    };

    private onError = (err: Error) => {
        this.fail(new SmtpError("network", err.message));
    };

    private onClose = () => {
        if (this.waiter) {
            this.fail(new SmtpError("closed", "connection closed by server"));
        }
    };

    private fail(err: Error) {
        const w = this.waiter;
        this.waiter = null;
        this.clearTimer();
        w?.reject(err);
    }

    private tryResolve() {
        if (!this.waiter) {
            return;
        }
        // split 后最后一项是""（已收到完整 CRLF）或半行数据；
        // lines[length-2] 即最后一个完整行，形如 "250 ..." 时整条回复结束
        const lines = this.buf.split("\r\n");
        if (lines.length < 2) {
            return;
        }
        const last = lines[lines.length - 2];
        const m = last.match(/^(\d{3}) (.*)$/);
        if (m) {
            const reply: Reply = {code: parseInt(m[1], 10), lines: lines.slice(0, -1)};
            this.buf = "";
            const w = this.waiter;
            this.waiter = null;
            this.clearTimer();
            w.resolve(reply);
        }
    }

    private clearTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    readReply(): Promise<Reply> {
        if (this.waiter) {
            return Promise.reject(new SmtpError("state", "previous reply not consumed"));
        }
        this.buf = "";
        return new Promise<Reply>((resolve, reject) => {
            this.waiter = {resolve, reject};
            this.timer = setTimeout(() => {
                this.waiter = null;
                reject(new SmtpError("timeout", `no reply within ${this.timeoutMs}ms`));
            }, this.timeoutMs);
            this.tryResolve(); // 数据可能已经先到
        });
    }

    write(line: string) {
        this.socket.write(line + "\r\n");
    }

    raw(text: string) {
        this.socket.write(text);
    }

    /** 移除旧 socket 的监听并返回（用于 STARTTLS 升级） */
    detachSocket(): any {
        const s = this.socket;
        s.removeListener?.("data", this.onData);
        s.removeListener?.("error", this.onError);
        s.removeListener?.("close", this.onClose);
        this.socket = null;
        this.buf = "";
        return s;
    }

    destroy() {
        try {
            this.socket?.destroy();
        } catch {
            /* ignore */
        }
        this.socket = null;
    }
}

export interface SendMailOptions {
    modules?: NodeModules;
    onLog?: (line: string) => void;
}

/**
 * 发送一封已组装好的 MIME 邮件。
 * @param message 完整邮件内容（CRLF 行结束，见 mime.ts）
 */
export async function sendMailViaSmtp(
    config: SmtpConfig,
    from: string,
    to: string,
    message: string,
    opts: SendMailOptions = {},
): Promise<void> {
    const mods = opts.modules ?? resolveNodeModules();
    const timeoutMs = config.timeoutMs ?? 20000;
    const log = opts.onLog ?? (() => {});

    let conn = await connect(mods, config, timeoutMs);

    const cmd = async (line: string, expect: number): Promise<Reply> => {
        // 打日志时隐去认证信息
        log(`> ${line.startsWith("AUTH") ? line.split(" ").slice(0, 2).join(" ") + " ****" : line}`);
        conn.write(line);
        const reply = await conn.readReply();
        log(`< ${reply.code} ${reply.lines[0] ?? ""}`);
        if (reply.code !== expect) {
            conn.destroy();
            throw new SmtpError(reply.code, reply.lines.join(" / "));
        }
        return reply;
    };

    try {
        const greeting = await conn.readReply();
        if (greeting.code !== 220) {
            throw new SmtpError(greeting.code, greeting.lines.join(" / "));
        }

        const ehlo = async (): Promise<string[]> => {
            const r = await cmd("EHLO [127.0.0.1]", 250);
            return r.lines.slice(1).map(l => l.replace(/^\d{3}[ -]/, "").toUpperCase());
        };
        let caps = await ehlo();

        if (config.encryption === "starttls") {
            if (!caps.some(c => c.startsWith("STARTTLS"))) {
                throw new SmtpError(0, "server does not support STARTTLS");
            }
            await cmd("STARTTLS", 220);
            const tlsMod = mods.tls;
            const plain = conn.detachSocket();
            const isIp = mods.net.isIP?.(config.host) !== 0;
            const secure = new tlsMod.TLSSocket(plain, {servername: isIp ? undefined : config.host});
            conn = new SmtpConnection(secure, timeoutMs);
            log("* TLS established");
            caps = await ehlo();
        }

        if (config.user) {
            const authCaps = caps.find(c => c.startsWith("AUTH")) ?? "";
            if (authCaps.includes("PLAIN")) {
                const initial = b64(`\u0000${config.user}\u0000${config.password}`);
                await cmd(`AUTH PLAIN ${initial}`, 235);
            } else {
                await cmd("AUTH LOGIN", 334);
                await cmd(b64(config.user), 334);
                await cmd(b64(config.password), 235);
            }
            log("* authenticated");
        }

        await cmd(`MAIL FROM:<${from}>`, 250);
        await cmd(`RCPT TO:<${to}>`, 250);
        await cmd("DATA", 354);

        // DATA 正文：点填充（行首为 . 则再补一个 .），以 \r\n.\r\n 结束
        const stuffed = message
            .split("\r\n")
            .map(l => (l.startsWith(".") ? "." + l : l))
            .join("\r\n");
        conn.raw(stuffed + "\r\n.\r\n");
        const sent = await conn.readReply();
        log(`< ${sent.code} ${sent.lines[0] ?? ""}`);
        if (sent.code !== 250) {
            conn.destroy();
            throw new SmtpError(sent.code, sent.lines.join(" / "));
        }

        conn.write("QUIT");
        try {
            await conn.readReply();
        } catch {
            /* 服务器可能直接关闭连接 */
        }
        conn.destroy();
        log("* done");
    } catch (e) {
        conn.destroy();
        throw e;
    }
}

async function connect(mods: NodeModules, config: SmtpConfig, timeoutMs: number): Promise<SmtpConnection> {
    const isTls = config.encryption === "ssl";
    const mod = isTls ? mods.tls : mods.net;
    // TLS 的 SNI 不允许填 IP 地址（本地测试或用户直接填 IP 的场景）
    const isIp = mods.net.isIP?.(config.host) !== 0;
    const servername = isIp ? undefined : config.host;
    const socket: any = await new Promise((resolve, reject) => {
        const s = isTls
            ? mod.connect({host: config.host, port: config.port, servername})
            : mod.connect({host: config.host, port: config.port});
        const t = setTimeout(() => {
            s.destroy();
            reject(new SmtpError("timeout", `connect ${config.host}:${config.port} timed out`));
        }, timeoutMs);
        s.once(isTls ? "secureConnect" : "connect", () => {
            clearTimeout(t);
            resolve(s);
        });
        s.once("error", (err: Error) => {
            clearTimeout(t);
            s.destroy();
            reject(new SmtpError("connect", err.message));
        });
    });
    return new SmtpConnection(socket, timeoutMs);
}

function b64(s: string): string {
    if (typeof btoa === "function") {
        return btoa(unescape(encodeURIComponent(s)));
    }
    return Buffer.from(s, "utf8").toString("base64");
}
