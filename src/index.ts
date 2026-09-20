/**
 * Send to Kindle — 将思源笔记文档一键转换为 EPUB 并发送到 Kindle。
 */

import {
    Plugin,
    showMessage,
    adaptHotkey,
    getActiveEditor,
    getAllEditor,
} from "siyuan";
import "./index.scss";

import {initSettings} from "./settings";
import {openSendDialog} from "./ui/send-dialog";
import {explainError, sendTestEmail} from "./send";
import {request} from "./api";

const ICONS = `<symbol id="iconSend2Kindle" viewBox="0 0 32 32">
<path d="M4 6.5C4 5.12 5.12 4 6.5 4h19C26.88 4 28 5.12 28 6.5V20h-3V7H7v18h6v3H6.5C5.12 28 4 26.88 4 25.5v-19zM17 20v8h3v-8l3.5 3.5L26 21l-7-7-7 7 2.5 2.5L18 20h-1z" fill="currentColor" fill-rule="evenodd"/>
</symbol>`;

export default class Send2KindlePlugin extends Plugin {

    async onload() {
        this.addIcons(ICONS);

        (this as any).settingUtils = initSettings(this, this.i18n);
        (this as any).settingUtils.addItem({
            key: "testEmailBtn",
            value: "",
            type: "button",
            title: this.i18n.optTestEmail,
            description: this.i18n.optTestEmailDesc,
            button: {
                label: this.i18n.optTestEmail,
                callback: () => {
                    sendTestEmail(this)
                        .then(() => showMessage(this.i18n.testEmailSuccess, 5000, "info"))
                        .catch(err => showMessage(explainError(err, this.i18n), 7000, "error"));
                },
            },
        });
        (this as any).settingUtils.load().catch((err: Error) => {
            console.error("[send2kindle] load settings failed:", err);
        });

        this.addCommand({
            langKey: "sendCurrentDoc",
            hotkey: adaptHotkey("⌥⇧K"),
            callback: () => {
                this.sendCurrentDoc();
            },
        });
    }

    onLayoutReady() {
        try {
            this.addTopBar({
                icon: "iconSend2Kindle",
                title: this.i18n.addToTopBar,
                position: "right",
                callback: () => {
                    this.sendCurrentDoc();
                },
            });
        } catch (err) {
            console.warn("[send2kindle] addTopBar failed:", err);
        }

        this.eventBus.on("open-menu-doctree", this.onDocTreeMenu);
    }

    onunload() {
        this.eventBus.off("open-menu-doctree", this.onDocTreeMenu);
    }

    private onDocTreeMenu = (event: any) => {
        const detail = event?.detail ?? {};
        // 兼容新旧事件结构：
        // 旧版 detail = {targets: HTMLElement[], menu: Menu}
        // 新版 detail = {elements: HTMLElement[], items: [{id, path, notebookId}], type, menu: subMenu}
        const target = detail.targets?.[0] ?? detail.elements?.[0];
        const docId = target?.dataset?.nodeId
            ?? target?.parentElement?.dataset?.nodeId
            ?? detail.items?.[0]?.id;
        // 只处理文档项：笔记本菜单（type=notebook）的 items[0].id 是笔记本 id，
        // 且笔记本根节点没有 data-node-id，两者都靠这些条件排除；
        // 注意思源里文档项的 data-type 是 "navigation-file"，不能拿来过滤
        if (!docId || detail.type === "notebook") {
            return;
        }
        // 新版思源里 detail.menu 是菜单底部的「插件」子菜单，旧版是主菜单本体
        detail.menu?.addItem?.({
            id: "send2kindle_send",
            iconHTML: '<svg class="b3-menu__icon"><use xlink:href="#iconSend2Kindle"></use></svg>',
            label: this.i18n.sendToKindle,
            click: () => {
                this.sendByDocId(docId);
            },
        });
    };

    private sendCurrentDoc() {
        // 必须取当前激活的编辑器；getAllEditor() 返回所有打开的标签页，[0] 是最早打开的那个
        const active: any = getActiveEditor();
        const docId = active?.protyle?.block?.rootID
            ?? active?.block?.rootID
            ?? getAllEditor()[0]?.protyle?.block?.rootID;
        if (!docId) {
            showMessage(this.i18n.noDocOpen, 3500, "error");
            return;
        }
        this.sendByDocId(docId);
    }

    private async sendByDocId(docId: string) {
        // 自动取文档标题作为书名默认值（取不到时弹窗留空，构建阶段仍会兜底）
        let bookTitle = "";
        try {
            const r = await request<string>("/api/filetree/getHPathByID", {id: docId});
            if (r.ok && typeof r.data === "string") {
                bookTitle = r.data.split("/").filter(Boolean).pop() ?? "";
            }
        } catch (err) {
            console.warn("[send2kindle] getHPathByID failed:", err);
        }
        openSendDialog(this, {docId, bookTitle});
    }
}
