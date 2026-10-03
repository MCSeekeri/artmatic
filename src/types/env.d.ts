/**
 * 编译期注入的常量（`vite.config.ts` 的 `define`）。
 *
 * `__APP_VERSION__` 的值来自 `package.json` 的 `version` —— 那是版本号的唯一真源，
 * 不要在任何组件里再写字面量。
 */
declare const __APP_VERSION__: string;
