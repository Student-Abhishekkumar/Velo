'use strict';

const express  = require('express');
const { spawn, execFile } = require('child_process');
const path     = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const app  = express();
const PORT = process.env.PORT || 3000;

// Use system yt-dlp installed by nixpacks (or locally via pip)
// Falls back to the npm-bundled binary if available
function getYtDlpBin() {
  try {
    return require.resolve('youtube-dl-exec/bin/yt-dlp');
  } catch {
    return 'yt-dlp'; // system PATH
  }
}
const YT_DLP = getYtDlpBin();

app.use(express.static(path.join(__dirname, 'public')));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ─── /api/info ────────────────────────────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter.' });

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  try {
    const { stdout } = await execFileAsync(YT_DLP, [
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--socket-timeout', '15',
      url,
    ], { timeout: 30_000 });

    const info = JSON.parse(stdout);

    const secs = info.duration || 0;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const duration = secs > 0
      ? (h > 0
          ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
          : `${m}:${String(s).padStart(2, '0')}`)
      : '—';

    res.json({
      title:     info.title     || 'Unknown title',
      thumbnail: info.thumbnail || null,
      uploader:  info.uploader  || info.channel || '',
      duration,
    });
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString();
    console.error('[info] error:', msg);
    if (msg.includes('Unsupported URL'))
      return res.status(400).json({ error: 'This URL is not supported.' });
    if (msg.includes('Private') || msg.includes('private'))
      return res.status(400).json({ error: 'This video is private.' });
    if (msg.includes('not available') || msg.includes('unavailable'))
      return res.status(400).json({ error: 'This video is not available.' });
    res.status(500).json({ error: 'Could not fetch video info. Check the URL and try again.' });
  }
});

// ─── /api/download ────────────────────────────────────────────────────────────
app.get('/api/download', (req, res) => {
  const { url, fmt = 'mp4' } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter.' });

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  // Format → yt-dlp selector args
  const formatArgs = {
    mp3:   ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
    wav:   ['-x', '--audio-format', 'wav'],
    webm:  ['-f', 'bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio', '--merge-output-format', 'webm'],
    '4k':  ['-f', 'bestvideo[height<=2160]+bestaudio/best[height<=2160]/best', '--merge-output-format', 'mp4'],
    '1080p': ['-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best', '--merge-output-format', 'mp4'],
    '720p':  ['-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best',   '--merge-output-format', 'mp4'],
    mp4:   ['-f', 'bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4'],
  };

  const extMap  = { mp3: 'mp3', wav: 'wav', webm: 'webm' };
  const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', webm: 'video/webm' };

  const ext    = extMap[fmt]  || 'mp4';
  const mime   = mimeMap[fmt] || 'video/mp4';
  const fmtArgs = formatArgs[fmt] || formatArgs.mp4;

  res.setHeader('Content-Disposition', `attachment; filename="velo-download.${ext}"`);
  res.setHeader('Content-Type', mime);

  const args = [
    ...fmtArgs,
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout', '15',
    '-o', '-',   // stream to stdout
    url,
  ];

  console.log(`[download] fmt=${fmt} | url=${url}`);

  const proc = spawn(YT_DLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  proc.stdout.pipe(res);

  let stderrBuf = '';
  proc.stderr.on('data', chunk => {
    const s = chunk.toString();
    process.stderr.write(s);
    stderrBuf += s;
  });

  proc.on('error', err => {
    console.error('[download] spawn error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Download failed — yt-dlp could not start.' });
    else res.end();
  });

  proc.on('close', code => {
    if (code !== 0) {
      console.error(`[download] yt-dlp exited with code ${code}\nstderr: ${stderrBuf}`);
      if (!res.headersSent) res.status(500).json({ error: 'Download failed.' });
      else res.end();
    }
  });

  // Kill process if client disconnects early
  req.on('close', () => {
    if (!proc.killed) proc.kill('SIGTERM');
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Velo running at http://localhost:${PORT}\n`);
});