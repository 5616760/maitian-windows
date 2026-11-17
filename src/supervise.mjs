#!/usr/bin/env node
// 守护进程的守护：hub daemon 异常退出就自动拉起，并记下每次退出码。
// 开机自启指向本文件，而不是 hub.mjs daemon —— 这样单次崩溃不会让大屏一直 404。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..');
const LOG = path.join(ROOT, 'data', 'supervise.log');
const HUB = path.join(DIR, 'hub.mjs');
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });

const say = (m) => { const line = `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${m}\n`; try { fs.appendFileSync(LOG, line); } catch {} process.stdout.write(line); };

let child = null, stopping = false, restarts = 0;

function start() {
  if (stopping) return;
  const at = new Date();
  child = spawn(process.execPath, [HUB, 'daemon'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: { ...process.env, HUB_SUPERVISED: '1' },
  });
  say(`拉起 daemon pid=${child.pid}`);
  child.stdout.on('data', (d) => process.stdout.write(d));
  child.stderr.on('data', (d) => process.stderr.write(d));
  child.on('exit', (code, sig) => {
    child = null;
    if (stopping) { say(`daemon 已停止 code=${code}`); process.exit(0); }
    const alive = (Date.now() - at.getTime()) / 1000;
    // 跑够 5 分钟才算「稳定」，否则连续崩溃要退避，避免疯狂重启
    if (alive < 300) restarts++; else restarts = 0;
    const wait = Math.min(60, 5 * Math.pow(2, Math.min(restarts, 4))) * 1000;
    say(`daemon 退出 code=${code} sig=${sig || '-'} 存活 ${alive.toFixed(0)}s，${(wait / 1000).toFixed(0)}s 后重启（连续异常 ${restarts} 次）`);
    setTimeout(start, wait);
  });
}

for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(s, () => { stopping = true; say(`收到 ${s}，停止`); if (child) child.kill(); else process.exit(0); });
}

say('监督器启动');
start();
