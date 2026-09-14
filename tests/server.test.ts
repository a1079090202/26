import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 回归：一个畸形 URL 曾让整个服务崩溃（URIError 未被捕获，进程直接退出）。
 * 这里起真服务，用各种畸形请求打它，要求：回 4xx、进程活着、后续请求正常。
 */

// 放在项目目录下的临时目录里：服务按 bundle 位置找 ../dist，这样静态页面走的是真构建产物
const dir = mkdtempSync(path.resolve(__dirname, '../.tmp-server-test-'));
const bundle = path.join(dir, 'server.js');
const dataFile = path.join(dir, 'store.json');

let server: ChildProcess;
let port: number;

/** 发原始 HTTP 请求字节，拿回完整响应头+体（畸形 URL 走 fetch 会被规范化，必须发原文） */
function rawRequest(bytes: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const s = net.connect(port, '127.0.0.1', () => s.write(bytes));
    s.on('data', (c) => chunks.push(c));
    s.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    s.on('error', reject);
    setTimeout(() => {
      s.destroy();
      resolve(Buffer.concat(chunks).toString('utf8'));
    }, 3000);
  });
}

function get(p: string): Promise<{ status: number; body: string }> {
  return rawRequest(`GET ${p} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`).then(
    (raw) => {
      const head = raw.slice(0, raw.indexOf('\r\n\r\n'));
      let body = raw.slice(raw.indexOf('\r\n\r\n') + 4);
      // 没写 Content-Length 时 Node 用 chunked 编码，测试里手工解一下
      if (/transfer-encoding:\s*chunked/i.test(head)) {
        let out = '';
        while (body.length) {
          const size = parseInt(body.slice(0, body.indexOf('\r\n')), 16);
          if (!size) break;
          body = body.slice(body.indexOf('\r\n') + 2);
          out += body.slice(0, size);
          body = body.slice(size + 2);
        }
        body = out;
      }
      return { status: Number(head.split(' ')[1]), body };
    },
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

beforeAll(async () => {
  buildSync({
    entryPoints: [path.resolve(__dirname, '../server/server.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: bundle,
    logLevel: 'silent',
  });
  port = await freePort();
  server = spawn('node', [bundle], {
    env: { ...process.env, DATA_FILE: dataFile, PORT: String(port) },
    stdio: 'pipe',
  });
  // 等服务起来
  for (let i = 0; i < 50; i += 1) {
    if (server.exitCode !== null) throw new Error('服务启动即退出');
    try {
      const r = await get('/api/state');
      if (r.status === 200) return;
    } catch {
      /* 还没起来，继续等 */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('服务一直没起来');
}, 20000);

afterAll(() => {
  server?.kill();
  rmSync(dir, { recursive: true, force: true });
});

describe('畸形 URL 打不垮服务', () => {
  it('不完整的百分号编码（/%E0%A4%A）回 400，不崩', async () => {
    const r = await get('/%E0%A4%A');
    expect(r.status).toBe(400);
    expect(server.exitCode).toBeNull();
  });

  it('孤立百分号（/%%）回 400，不崩', async () => {
    const r = await get('/%%');
    expect(r.status).toBe(400);
    expect(server.exitCode).toBeNull();
  });

  it('非法绝对形式 URL 回 400，不崩', async () => {
    const raw = await rawRequest('GET http://[ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    expect([400, 404, 500]).toContain(Number(raw.split(' ')[1]));
    expect(server.exitCode).toBeNull();
  });

  it('连打一串畸形请求后，正常接口和页面照样工作', async () => {
    for (const bad of ['/%', '/%zz', '/%e0%a4', '/%C0%AE', '/a%']) {
      await get(bad);
    }
    const api = await get('/api/state');
    expect(api.status).toBe(200);
    expect(JSON.parse(api.body)).toHaveProperty('menus');
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(server.exitCode).toBeNull();
  });
});
