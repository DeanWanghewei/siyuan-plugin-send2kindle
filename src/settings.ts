/**
 * 插件设置项（基于 SettingUtils）。
 */

import {SettingUtils} from "./libs/setting-utils";
import type {Plugin} from "siyuan";
import type {SmtpEncryption} from "./kindle/smtp";

export interface PluginSettings {
    kindleAddr: string;
    smtpHost: string;
    smtpPort: number;
    smtpEncryption: SmtpEncryption;
    smtpUser: string;
    smtpPassword: string;
    senderName: string;
    bookAuthor: string;
    /** 0=不分章 1=H1 2=H2 3=H3 */
    splitLevel: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
    kindleAddr: "",
    smtpHost: "smtp.qq.com",
    smtpPort: 465,
    smtpEncryption: "ssl",
    smtpUser: "",
    smtpPassword: "",
    senderName: "",
    bookAuthor: "",
    splitLevel: 0,
};

export function initSettings(plugin: Plugin, i18n: any): SettingUtils {
    const settingUtils = new SettingUtils({plugin, name: "send2kindle-config"});

    const text = (key: string, title: string, description: string) => ({
        key, value: "", type: "textinput" as const, title, description,
    });

    settingUtils.addItem({
        ...text("kindleAddr", i18n.optKindleAddr, i18n.optKindleAddrDesc),
        value: DEFAULT_SETTINGS.kindleAddr,
    });
    settingUtils.addItem({...text("smtpHost", i18n.optSmtpHost, i18n.optSmtpHostDesc), value: DEFAULT_SETTINGS.smtpHost});
    settingUtils.addItem({
        key: "smtpPort",
        value: DEFAULT_SETTINGS.smtpPort,
        type: "number",
        title: i18n.optSmtpPort,
        description: i18n.optSmtpPortDesc,
    });
    settingUtils.addItem({
        key: "smtpEncryption",
        value: DEFAULT_SETTINGS.smtpEncryption,
        type: "select",
        title: i18n.optSmtpEncryption,
        description: i18n.optSmtpEncryptionDesc,
        options: {
            ssl: i18n.optEncSsl,
            starttls: i18n.optEncStarttls,
            none: i18n.optEncNone,
        },
    });
    settingUtils.addItem({...text("smtpUser", i18n.optSmtpUser, i18n.optSmtpUserDesc)});
    settingUtils.addItem({...text("smtpPassword", i18n.optSmtpPassword, i18n.optSmtpPasswordDesc)});
    settingUtils.addItem({...text("senderName", i18n.optSenderName, i18n.optSenderNameDesc)});
    settingUtils.addItem({...text("bookAuthor", i18n.optBookAuthor, i18n.optBookAuthorDesc)});
    settingUtils.addItem({
        key: "splitLevel",
        value: String(DEFAULT_SETTINGS.splitLevel),
        type: "select",
        title: i18n.optSplitLevel,
        description: i18n.optSplitLevelDesc,
        options: {
            0: i18n.splitNone,
            1: "H1",
            2: "H2",
            3: "H3",
        },
    });
    settingUtils.addItem({
        key: "securityHint",
        value: "",
        type: "hint",
        title: i18n.securityHint,
        description: "",
    });

    return settingUtils;
}

/** 读取设置面板当前生效的值 */
export function readSettings(settingUtils: SettingUtils): PluginSettings {
    // 设置面板还开着时，输入框的值要点「确定」才会写回内存；
    // 从「发送测试邮件」按钮或发送对话框触发时先同步一次，否则会读到旧值
    const live = (key: string): any => {
        const el = settingUtils.getElement(key);
        if (el) {
            settingUtils.take(key, true);
        }
        return settingUtils.get(key);
    };
    // 宽容处理中文输入法的全角 ＠ 。 ． 和误输入的空格
    const kindleAddr = String(live("kindleAddr") ?? "")
        .trim()
        .replace(/＠/g, "@")
        .replace(/[。．]/g, ".")
        .replace(/\s+/g, "");
    return {
        kindleAddr,
        smtpHost: (live("smtpHost") ?? "").trim(),
        smtpPort: Number(live("smtpPort")) || 465,
        smtpEncryption: (live("smtpEncryption") ?? "ssl") as SmtpEncryption,
        smtpUser: (live("smtpUser") ?? "").trim(),
        smtpPassword: live("smtpPassword") ?? "",
        senderName: (live("senderName") ?? "").trim(),
        bookAuthor: (live("bookAuthor") ?? "").trim(),
        splitLevel: Number(live("splitLevel")) || 0,
    };
}
