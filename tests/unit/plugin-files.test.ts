import { describe, expect, it } from 'vitest';
import { memoryRoot } from '../../src/project/fs';
import {
  isDisabledPluginFileName,
  isPluginFileName,
  pluginIdFromFileName,
  pluginsDir,
  readPluginFiles,
  removePluginFile,
  renamePluginFile,
  writePluginFile,
} from '../../src/project/plugins';
import { PLUGINS_DIR, pluginFileName, pluginRelPath, safePluginId } from '../../src/project/layout';

/**
 * `plugins/` 的字节进出。
 *
 * 这一层不碰注册表、不认识清单，所以能整段单测（`memoryRoot` 还模拟了真实
 * writable 的 swap 语义）。它最容易出的两类错都很安静：
 *   · 文件名规则写错 → 插件在磁盘上、但永远不被加载；
 *   · 读取时一个坏文件抛出去 → 整个工程打不开。
 */

const PLUGIN_SRC = 'export const plugin = { format: "artmatic-plugin" };';

describe('路径规则', () => {
  it('插件落在 plugins/<id>.js', () => {
    expect(pluginFileName('my-plugin')).toBe('my-plugin.js');
    expect(pluginRelPath('my-plugin')).toBe('plugins/my-plugin.js');
  });

  it('清洗：只留 [A-Za-z0-9._-]，空则回落', () => {
    expect(safePluginId('my-plugin')).toBe('my-plugin');
    expect(safePluginId('a/b')).toBe('ab');
    expect(safePluginId('')).toBe('plugin');
    expect(safePluginId('../../etc/passwd')).toBe('....etcpasswd');
  });
});

describe('文件名判定', () => {
  it('只认 .js', () => {
    expect(isPluginFileName('a.js')).toBe(true);
    expect(isPluginFileName('a.JS')).toBe(true);
    expect(isPluginFileName('a.js.map')).toBe(false);
    expect(isPluginFileName('a.ts')).toBe(false);
    expect(isPluginFileName('a.js.bak')).toBe(false);
  });

  it('停用文件不算可挂载的插件', () => {
    expect(isPluginFileName('a.js.disabled')).toBe(false);
    expect(isDisabledPluginFileName('a.js.disabled')).toBe(true);
    expect(isDisabledPluginFileName('a.js')).toBe(false);
  });

  it('从文件名反推 id（含停用后缀）', () => {
    expect(pluginIdFromFileName('my-plugin.js')).toBe('my-plugin');
    expect(pluginIdFromFileName('my-plugin.js.disabled')).toBe('my-plugin');
    expect(pluginIdFromFileName('my-plugin')).toBe('my-plugin');
    expect(pluginIdFromFileName('sub/dir/my-plugin.js')).toBe('my-plugin');
    expect(pluginIdFromFileName('.js')).toBe('plugin');
  });
});

describe('读取', () => {
  it('目录不存在：空集，不抛（从没导入过插件的工程就是常态）', async () => {
    const root = memoryRoot();
    expect(await readPluginFiles(root)).toEqual({ files: [], disabled: [], failed: [] });
    expect(await pluginsDir(root, false)).toBeNull();
  });

  it('只读 .js，其它扩展名一律忽略', async () => {
    const root = memoryRoot();
    root.seed('plugins/a.js', PLUGIN_SRC);
    root.seed('plugins/b.js.disabled', PLUGIN_SRC);
    root.seed('plugins/c.ts', PLUGIN_SRC);
    root.seed('plugins/d.js.map', '{}');
    root.seed('plugins/notes.txt', 'x');

    const res = await readPluginFiles(root);
    expect(res.files.map((f) => f.name)).toEqual(['a.js']);
    expect(res.disabled).toEqual(['b.js.disabled']);
    expect(res.failed).toEqual([]);
    expect(new TextDecoder().decode(res.files[0]!.bytes)).toBe(PLUGIN_SRC);
  });

  it('顺序稳定（同一工程两次打开得到同一个加载顺序）', async () => {
    const root = memoryRoot();
    for (const n of ['z.js', 'a.js', 'm.js']) root.seed(`plugins/${n}`, PLUGIN_SRC);
    const a = (await readPluginFiles(root)).files.map((f) => f.name);
    const b = (await readPluginFiles(root)).files.map((f) => f.name);
    expect(a).toEqual(['a.js', 'm.js', 'z.js']);
    expect(b).toEqual(a);
  });

  it('同名目录不算插件文件：不加载，也不算失败', async () => {
    const root = memoryRoot();
    root.seed('plugins/ok.js', PLUGIN_SRC);
    // 目录的 `kind` 是 'directory'，第一道过滤就把它挡在外面 ——
    // 它不能被当成「读失败」，那会让面板上凭空多一条无解的报错。
    const pdir = await root.openDir('plugins', { create: true });
    await pdir.openDir('bad.js', { create: true });

    const res = await readPluginFiles(root);
    expect(res.files.map((f) => f.name)).toEqual(['ok.js']);
    expect(res.failed).toEqual([]);
  });

  it('读取整体失败（权限 / 坏盘）：每个文件各记一条，**不抛**', async () => {
    const root = memoryRoot();
    root.seed('plugins/a.js', PLUGIN_SRC);
    root.seed('plugins/b.js', PLUGIN_SRC);
    root.setFault((op) => (op === 'read' ? new Error('permission denied') : null));

    const res = await readPluginFiles(root);
    expect(res.files).toEqual([]);
    expect(res.failed.map((f) => f.name).sort()).toEqual(['a.js', 'b.js']);
    expect(res.failed[0]!.detail).toBe('permission denied');
  });

  it('目录列举失败也只记一条', async () => {
    const root = memoryRoot();
    root.seed('plugins/a.js', PLUGIN_SRC);
    root.setFault((op) => (op === 'list' ? new Error('listing failed') : null));
    const res = await readPluginFiles(root);
    expect(res.files).toEqual([]);
    expect(res.failed).toEqual([{ name: PLUGINS_DIR, detail: 'listing failed' }]);
  });
});

describe('写入 / 删除 / 改名', () => {
  it('写进去能原样读回来（走原子写 + 读回校验）', async () => {
    const root = memoryRoot();
    await writePluginFile(root, 'my-plugin', new TextEncoder().encode(PLUGIN_SRC));
    expect(new TextDecoder().decode(root.inspect('plugins/my-plugin.js')!)).toBe(PLUGIN_SRC);
  });

  it('写入时会建出 plugins/ 目录', async () => {
    const root = memoryRoot();
    await writePluginFile(root, 'p', new TextEncoder().encode('x'));
    const items = await root.list();
    expect(items.some((i) => i.name === PLUGINS_DIR && i.kind === 'directory')).toBe(true);
  });

  it('删除是幂等的：文件不在也算成功', async () => {
    const root = memoryRoot();
    await expect(removePluginFile(root, 'never')).resolves.toBeUndefined();
    await writePluginFile(root, 'p', new TextEncoder().encode('x'));
    await removePluginFile(root, 'p');
    expect(root.inspect('plugins/p.js')).toBeNull();
    await expect(removePluginFile(root, 'p')).resolves.toBeUndefined();
  });

  it('改名是「读 → 写 → 删」：目标有内容、源已消失', async () => {
    const root = memoryRoot();
    await writePluginFile(root, 'p', new TextEncoder().encode(PLUGIN_SRC));
    await renamePluginFile(root, 'p.js', 'p.js.disabled');
    expect(root.inspect('plugins/p.js')).toBeNull();
    expect(new TextDecoder().decode(root.inspect('plugins/p.js.disabled')!)).toBe(PLUGIN_SRC);
  });

  it('连 plugins/ 目录都没有时改名是空操作（不是错误）', async () => {
    const root = memoryRoot();
    await expect(renamePluginFile(root, 'ghost.js', 'ghost.js.disabled')).resolves.toBeUndefined();
  });

  it('目录在、但源文件不在：抛错（调用方负责兜底成「尽力而为」）', async () => {
    const root = memoryRoot();
    await writePluginFile(root, 'other', new TextEncoder().encode('x'));
    await expect(renamePluginFile(root, 'ghost.js', 'ghost.js.disabled')).rejects.toBeTruthy();
  });
});
