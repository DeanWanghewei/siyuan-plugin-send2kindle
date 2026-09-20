/**
 * 发送确认对话框：书名、切章级别，发送或保存本地。
 */

import {Dialog, showMessage} from "siyuan";
import type {Plugin} from "siyuan";
import {
    explainError,
    prepareEpub,
    saveEpubLocally,
    sendDocumentToKindle,
} from "../send";
import type {SendTaskOptions} from "../send";

export function openSendDialog(plugin: Plugin, opts: SendTaskOptions) {
    const i18n = plugin.i18n;
    const dialog = new Dialog({
        title: i18n.dialogTitle,
        content: `<div class="s2k-dialog">
  <div class="s2k-row">
    <label class="s2k-label">${i18n.bookTitle}</label>
    <input class="b3-text-field fn__flex-1" id="s2kBookTitle" value="">
  </div>
  <div class="s2k-row">
    <label class="s2k-label">${i18n.splitLevel}</label>
    <select class="b3-select" id="s2kSplit">
      <option value="0">${i18n.splitNone}</option>
      <option value="1">H1</option>
      <option value="2">H2</option>
      <option value="3">H3</option>
    </select>
  </div>
  <div class="s2k-row s2k-actions">
    <span class="fn__flex-1"></span>
    <button class="b3-button b3-button--outline" id="s2kSaveLocal">${i18n.saveLocalBtn}</button>
    <button class="b3-button b3-button--outline" id="s2kCancel">${i18n.cancelBtn}</button>
    <button class="b3-button b3-button--text" id="s2kSend">${i18n.sendBtn}</button>
  </div>
</div>`,
        width: "440px",
        height: "230px",
    });

    const el = dialog.element;
    const titleInput = el.querySelector<HTMLInputElement>("#s2kBookTitle")!;
    const splitSelect = el.querySelector<HTMLSelectElement>("#s2kSplit")!;
    titleInput.value = opts.bookTitle ?? "";
    const defaultSplit = String((plugin as any).settingUtils?.get("splitLevel") ?? "0");
    splitSelect.value = opts.splitLevel !== undefined ? String(opts.splitLevel) : defaultSplit;

    const close = () => dialog.destroy();

    el.querySelector("#s2kCancel")!.addEventListener("click", close);
    el.querySelector("#s2kSaveLocal")!.addEventListener("click", async () => {
        try {
            const {bytes, title} = await prepareEpub(plugin, {
                ...opts,
                bookTitle: titleInput.value,
                splitLevel: Number(splitSelect.value),
            });
            saveEpubLocally(bytes, title);
            plugin.i18n && showMessage(plugin.i18n.savedLocal, 3500, "info");
            close();
        } catch (err) {
            showMessage(explainError(err, plugin.i18n), 7000, "error");
        }
    });
    el.querySelector("#s2kSend")!.addEventListener("click", async () => {
        try {
            await sendDocumentToKindle(plugin, {
                ...opts,
                bookTitle: titleInput.value,
                splitLevel: Number(splitSelect.value),
            });
            close();
        } catch (err) {
            showMessage(explainError(err, plugin.i18n), 7000, "error");
        }
    });
}
