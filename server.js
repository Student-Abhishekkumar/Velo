'use strict';

const express  = require('express');
const { spawn, execFile } = require('child_process');
const path     = require('path');
const fs       = require('fs');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const app  = express();
const PORT = process.env.PORT || 3000;

// Use system yt-dlp installed by nixpacks (or locally via pip)
function getYtDlpBin() {
  try {
    return require.resolve('youtube-dl-exec/bin/yt-dlp');
  } catch {
    return 'yt-dlp'; // system PATH
  }
}
const YT_DLP = getYtDlpBin();

// Common anti-bot and configuration flags
function getCommonArgs() {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--socket-timeout', '30',
    '--force-ipv4', // Often fixes "Sign in to confirm you're not a bot" on cloud hosts
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    '--extractor-args', 'youtube:player-client=android,web;player-skip=webpage,configs,js',
  ];

  // If cookies.txt exists in the root, use it
  const cookiesPath = path.join(__dirname, 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    console.log('[yt-dlp] Using cookies.txt for authentication');
    args.push('--cookies', cookiesPath);
  }

  return args;
}

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
    const args = [
      ...getCommonArgs(),
      '--dump-single-json',
      url,
    ];

    const { stdout } = await execFileAsync(YT_DLP, args, { timeout: 45_000 });
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
    
    if (msg.includes('Sign in to confirm')) {
      return res.status(403).json({ 
        error: 'YouTube is blocking the request. Please provide a cookies.txt file to authenticate.' 
      });
    }
    if (msg.includes('Unsupported URL')) return res.status(400).json({ error: 'This URL is not supported.' });
    if (msg.includes('Private')) return res.status(400).json({ error: 'This video is private.' });
    
    res.status(500).json({ error: 'Could not fetch video info.' });
  }
});

// ─── /api/download ────────────────────────────────────────────────────────────
app.get('/api/download', (req, res) => {
  const { url, fmt = 'mp4' } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url parameter.' });

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL.' });
  }

  const formatArgs = {
    mp3:   ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
    wav:   ['-x', '--audio-format', 'wav'],
    webm:  ['-f', 'bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio', '--merge-output-format', 'webm'],
    '4k':  ['-f', 'bestvideo[height<=2160]+bestaudio/best', '--merge-output-format', 'mp4'],
    '1080p': ['-f', 'bestvideo[height<=1080]+bestaudio/best', '--merge-output-format', 'mp4'],
    '720p':  ['-f', 'bestvideo[height<=720]+bestaudio/best', '--merge-output-format', 'mp4'],
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
    ...getCommonArgs(),
    ...fmtArgs,
    '-o', '-',
    url,
  ];

  console.log(`[download] fmt=${fmt} | url=${url}`);

  const proc = spawn(YT_DLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.pipe(res);

  let stderrBuf = '';
  proc.stderr.on('data', chunk => {
    stderrBuf += chunk.toString();
  });

  proc.on('error', err => {
    console.error('[download] spawn error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Download failed.' });
  });

  proc.on('close', code => {
    if (code !== 0) console.error(`[download] yt-dlp exited with code ${code}\nstderr: ${stderrBuf}`);
  });

  req.on('close', () => {
    if (!proc.killed) proc.kill('SIGTERM');
  });
});

app.listen(PORT, () => {
  console.log(`\n✅  Velo running at http://localhost:${PORT}\n`);
});