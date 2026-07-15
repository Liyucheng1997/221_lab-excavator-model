import { defineConfig } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * 开发期截图端点。
 *
 * 只在 dev 下挂载:页面 POST 一个 dataURL 过来,存成 PNG。
 * 用途是让人(或工具)能在无头/无窗口的环境里,把某个机位的画面抓下来核对模型 ——
 * 油缸有没有装反、连杆有没有穿模,这些光看数字是看不出来的。
 */
function screenshotEndpoint() {
  return {
    name: 'dev-screenshot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { name = 'shot.png', data } = JSON.parse(body);
            const b64 = data.slice(data.indexOf(',') + 1);
            const out = resolve(process.cwd(), '.shots', name);
            mkdirSync(dirname(out), { recursive: true });
            writeFileSync(out, Buffer.from(b64, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: out }));
          } catch (e) {
            res.statusCode = 500;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [screenshotEndpoint()],
  server: { port: 5173 },
});
