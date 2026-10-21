import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repairPdfText } from './pdf-text-map.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pdfPath = 'apps/web/public/resume.pdf';
const metadataPath = 'apps/web/src/resume/pdf-metadata.json';
export const pdfInputs = [
  'readme.md', 'apps/web/src/resume/ResumePage.tsx', 'apps/web/src/resume/resume-source.ts',
  'apps/web/src/resume/resume.css', 'apps/web/src/styles.css', 'scripts/resume-pdf.mjs', 'scripts/pdf-text-map.mjs',
  'apps/web/vite.config.ts', 'package-lock.json',
];
const hash = content => createHash('sha256').update(content).digest('hex');

export async function readPdfInputs(directory = root) {
  const inputs = await Promise.all(pdfInputs.map(async file => [file, await readFile(path.join(directory, file))]));
  return { inputs, sourceHash: hash(JSON.stringify(inputs.map(([file, data]) => [file, hash(data)]))) };
}

export async function checkResumePdf(directory = root) {
  const [{ sourceHash }, metadata, pdf] = await Promise.all([
    readPdfInputs(directory), readFile(path.join(directory, metadataPath), 'utf8').then(JSON.parse),
    readFile(path.join(directory, pdfPath)),
  ]);
  if (metadata.schema !== 1 || metadata.sourceHash !== sourceHash || metadata.pdfHash !== hash(pdf)
    || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-')) || !pdf.subarray(-40).includes(Buffer.from('%%EOF'))) {
    throw new Error('Resume PDF is stale or changed. Run npm run resume:sync, then include resume.pdf and pdf-metadata.json with your source changes.');
  }
  return metadata;
}

export async function generateResumePdf() {
  // Watch mode and a manual export may overlap. Never steal an active lock.
  const lock = path.join(root, '.artifacts/resume-pdf.lock');
  await mkdir(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + 30_000;
  while (true) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('Another PDF export holds .artifacts/resume-pdf.lock; verify that process has stopped before removing a stale lock.', { cause: error });
      await delay(250);
    }
  }
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('Resume PDF export interrupted.'));
  process.on('SIGINT', abort);
  process.on('SIGTERM', abort);
  try { return await renderResumePdf(controller.signal); }
  finally {
    await rm(lock, { recursive: true, force: true });
    process.off('SIGINT', abort);
    process.off('SIGTERM', abort);
  }
}

async function renderResumePdf(signal) {
  signal.throwIfAborted();
  const snapshot = await readPdfInputs();
  // These are local authoring tools. They never enter the web bundle or the ECS API release.
  const [{ createServer }, { chromium }, { createElement }, { renderToStaticMarkup }] = await Promise.all([
    import('vite'), import('playwright'), import('react'), import('react-dom/server'),
  ]);
  const vite = await createServer({
    root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'),
    appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'error',
  });
  let browser;
  try {
    const { ResumePage } = await vite.ssrLoadModule('/src/resume/ResumePage.tsx');
    const css = snapshot.inputs.filter(([file]) => file.endsWith('.css')).map(([, data]) => data.toString()).join('\n');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>齐少轩的简历</title><style>${css}</style></head><body>${renderToStaticMarkup(createElement(ResumePage))}</body></html>`;
    // A fresh, headless authoring instance; no personal browser profile or network content is used.
    browser = await chromium.launch(process.platform === 'darwin' ? { channel: 'chrome' } : {});
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 }, offline: true, serviceWorkers: 'block' });
    await page.route('**/*', route => route.abort());
    await page.setContent(html, { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => globalThis.document.fonts.ready);
    const rendered = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
    const pdf = await repairPdfText(rendered, snapshot.inputs.find(([file]) => file === 'readme.md')[1].toString());
    if ((await readPdfInputs()).sourceHash !== snapshot.sourceHash) throw new Error('Resume inputs changed during export; retry after saving.');
    const metadata = { schema: 1, sourceHash: snapshot.sourceHash, pdfHash: hash(pdf) };
    signal.throwIfAborted();
    await mkdir(path.dirname(path.join(root, pdfPath)), { recursive: true });
    await writeFile(path.join(root, `${pdfPath}.${process.pid}.tmp`), pdf);
    await rename(path.join(root, `${pdfPath}.${process.pid}.tmp`), path.join(root, pdfPath));
    await writeFile(path.join(root, `${metadataPath}.${process.pid}.tmp`), `${JSON.stringify(metadata, null, 2)}\n`);
    await rename(path.join(root, `${metadataPath}.${process.pid}.tmp`), path.join(root, metadataPath));
    console.info('Resume PDF updated: apps/web/public/resume.pdf (download name: 齐少轩的简历.pdf)');
    return metadata;
  } finally {
    await browser?.close();
    await vite.close();
  }
}

async function watchResumePdf() {
  let timer, running = false, pending = false, closed = false;
  const update = async () => {
    if (closed) return;
    if (running) { pending = true; return; }
    running = true;
    try {
      // A fresh process also reloads edits to the generator itself.
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], { cwd: root, stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', code => code === 0 ? resolve() : reject(new Error(`PDF generator exited ${code}`)));
      });
    }
    catch (error) { console.error('Resume PDF export failed:', error.message); }
    finally {
      running = false;
      if (pending) { pending = false; void update(); }
    }
  };
  const watched = new Set(pdfInputs.map(file => path.join(root, file)));
  const watchers = [...new Set(pdfInputs.map(file => path.dirname(path.join(root, file))))].map(directory => watch(directory, (_event, name) => {
    if (!name || !watched.has(path.join(directory, String(name)))) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void update(); }, 350);
  }));
  const close = () => { closed = true; clearTimeout(timer); watchers.forEach(watcher => watcher.close()); };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try { await checkResumePdf(); console.info('Resume PDF is current; watching README and layout changes.'); }
  catch { await update(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length && !['--check', '--watch'].includes(args[0])) throw new Error('Usage: node scripts/resume-pdf.mjs [--check|--watch]');
  if (args[0] === '--watch') await watchResumePdf();
  else if (args[0] === '--check') {
    try { await checkResumePdf(); console.info('Resume PDF matches the current README and layout.'); }
    catch (error) { throw new Error(`Resume PDF check failed: ${error.message}. Run npm run resume:sync.`, { cause: error }); }
  } else await generateResumePdf();
}
