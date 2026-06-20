// World Engine SillyTavern server plugin.
// Provides plaintext config folder storage for the UI extension.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, 'config');
const MAX_BODY_BYTES = 25 * 1024 * 1024;

const info = {
  id: 'world-engine',
  name: 'World Engine',
  description: 'Plaintext config-folder storage for World Engine.',
};

function toPosixPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function resolveConfigPath(relativePath) {
  const normalized = path.posix.normalize(toPosixPath(relativePath));
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../') || path.isAbsolute(normalized)) {
    throw new Error('Invalid config path');
  }
  const target = path.resolve(CONFIG_DIR, normalized);
  const root = path.resolve(CONFIG_DIR);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Config path escapes config directory');
  }
  return { target, normalized };
}

async function ensureConfigDir() {
  await fsp.mkdir(CONFIG_DIR, { recursive: true });
  await fsp.mkdir(path.join(CONFIG_DIR, 'chats'), { recursive: true });
  await fsp.mkdir(path.join(CONFIG_DIR, 'worldbook'), { recursive: true });
  await fsp.mkdir(path.join(CONFIG_DIR, 'ui'), { recursive: true });
  await fsp.mkdir(path.join(CONFIG_DIR, 'kv'), { recursive: true });
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

async function listFiles() {
  const result = [];
  async function walk(dir, prefix) {
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (error) { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, rel);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(abs);
        result.push({
          path: rel.replace(/\\/g, '/'),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
  }
  await walk(CONFIG_DIR, '');
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

async function init(router) {
  await ensureConfigDir();

  router.get('/status', async (_req, res) => {
    await ensureConfigDir();
    res.json({ ok: true, configDir: CONFIG_DIR });
  });

  router.get('/list', async (_req, res) => {
    await ensureConfigDir();
    res.json({ files: await listFiles() });
  });

  router.get('/file', async (req, res) => {
    try {
      const { target, normalized } = resolveConfigPath(req.query.path);
      const content = await fsp.readFile(target, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      res.json({ path: normalized, exists: content !== null, content });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.put('/file', async (req, res) => {
    try {
      const body = await readBody(req);
      const { target, normalized } = resolveConfigPath(body.path);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, String(body.content ?? ''), 'utf8');
      res.json({ ok: true, path: normalized });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.delete('/file', async (req, res) => {
    try {
      const body = await readBody(req);
      const { target, normalized } = resolveConfigPath(body.path);
      await fsp.rm(target, { force: true });
      res.json({ ok: true, path: normalized });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  router.post('/append', async (req, res) => {
    try {
      const body = await readBody(req);
      const { target, normalized } = resolveConfigPath(body.path);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.appendFile(target, String(body.content ?? ''), 'utf8');
      res.json({ ok: true, path: normalized });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  console.log(`[World Engine] Server plugin loaded. Config dir: ${CONFIG_DIR}`);
}

async function exit() {
  return Promise.resolve();
}

module.exports = {
  init,
  exit,
  info,
};
