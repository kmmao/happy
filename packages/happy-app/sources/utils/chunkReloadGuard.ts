/**
 * chunkReloadGuard — 处理「旧 entry chunk 引用了已被新部署覆盖的 hash 资源」场景。
 *
 * 触发条件：
 *   webapp 是 expo export 生成的静态产物，懒加载的 chunk 文件名带 content hash
 *   (例如 _expo/static/js/web/xterm-<hash>.js)。重新部署后 hash 全部刷新，旧文件被删。
 *   如果用户浏览器还在跑旧 entry chunk（页面没刷新），动态 import() 旧 hash 的 chunk
 *   会拿到 410 / 404 / 网络错误，浏览器 ES module loader 抛 "Loading module ... failed"。
 *
 * 行为：
 *   - 全局安装 (installChunkReloadGuard): 监听 window error / unhandledrejection，
 *     识别 chunk load error 后强制 location.reload() —— 适用于未被局部 try/catch 吞掉的错误
 *   - 局部判断 (isChunkLoadError + attemptChunkReload): 给已经把错误 catch 掉的代码用
 *     (比如 WebTerminal.web.tsx 的 init().catch)，识别后主动 reload
 *
 * 反循环保护：
 *   sessionStorage 存最近一次 reload 的时间戳。10 秒内再发生 chunk error 就不再 reload，
 *   避免「服务端真死了」的情况下浏览器无限刷新。
 *
 * native 平台：全部走早退，所有函数都是 no-op。
 */

import { Platform } from 'react-native';

const RELOAD_TIMESTAMP_KEY = '__happy_chunk_reload_at__';
const RELOAD_DEBOUNCE_MS = 10_000;

// Loading module / chunk / CSS chunk 各家打包器的措辞都覆盖一下
const CHUNK_ERROR_REGEX = /Loading (?:CSS )?(?:chunk|module) .+ failed/i;

function getWindow(): (Window & typeof globalThis) | null {
    if (Platform.OS !== 'web') return null;
    if (typeof window === 'undefined') return null;
    return window;
}

export function isChunkLoadError(value: unknown): boolean {
    if (!value) return false;
    if (value instanceof Error) {
        if (value.name === 'ChunkLoadError') return true;
        if (CHUNK_ERROR_REGEX.test(value.message)) return true;
        // metro / webpack 偶尔把 message 套在 cause/stack 里
        const stack = (value as Error).stack;
        if (stack && CHUNK_ERROR_REGEX.test(stack)) return true;
        return false;
    }
    return CHUNK_ERROR_REGEX.test(String(value));
}

export function attemptChunkReload(reason: string): void {
    const w = getWindow();
    if (!w) return;

    let last = 0;
    try {
        last = Number(w.sessionStorage.getItem(RELOAD_TIMESTAMP_KEY)) || 0;
    } catch {
        // sessionStorage 不可用（隐私模式 / 第三方 iframe）— 仍然尝试 reload，
        // 接受可能的循环风险，浏览器自身的循环保护会兜底（约 20 次后停止）
    }

    const now = Date.now();
    if (last && now - last < RELOAD_DEBOUNCE_MS) {
        // 上次刚 reload 完又遇到 chunk error，说明刷新没能修复（服务端真挂了 / 缓存层有问题）
        // 不再循环刷新，让上层 UI 暴露真实错误
        // eslint-disable-next-line no-console
        console.warn('[chunkReloadGuard] chunk error within debounce, skipping reload:', reason);
        return;
    }

    try {
        w.sessionStorage.setItem(RELOAD_TIMESTAMP_KEY, String(now));
    } catch {
        // ignore
    }
    // eslint-disable-next-line no-console
    console.warn('[chunkReloadGuard] stale chunk detected, reloading:', reason);
    w.location.reload();
}

let installed = false;

export function installChunkReloadGuard(): void {
    const w = getWindow();
    if (!w) return;
    if (installed) return;
    installed = true;

    w.addEventListener('error', (event: ErrorEvent) => {
        if (isChunkLoadError(event.error) || isChunkLoadError(event.message)) {
            attemptChunkReload(`window.error: ${event.message}`);
        }
    });

    w.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        if (isChunkLoadError(event.reason)) {
            attemptChunkReload(`unhandledrejection: ${String(event.reason)}`);
        }
    });
}
