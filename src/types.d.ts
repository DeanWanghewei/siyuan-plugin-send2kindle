/*
 * Global type declarations for send2kindle plugin.
 */

declare module "*.scss";

declare global {
    interface Window {
        siyuan?: any;
        /**
         * Electron renderer with nodeIntegration exposes Node's require here.
         * NOTE: the bare `require` inside a plugin bundle is SiYuan's own frontend
         * module loader (provides the "siyuan" module), NOT Node's require.
         */
        require?: (id: string) => any;
    }
}

export {};
