const express = require('express');
const ytDlp = require('youtube-dl-exec');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// ─── GET /api/info?url=... ───────────────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const info = await ytDlp(url, {
      dumpSingleJson: true,
      noPlaylist: true,
      noWarnings: true,
    });

    const secs = info.duration || 0;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    const duration = secs > 0
      ? (h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`)
      : '—';

    res.json({
      title:     info.title     || 'Unknown title',
      thumbnail: info.thumbnail || null,
      uploader:  info.uploader  || info.channel || '',
      duration,
    });
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Unsupported URL')) return res.status(400).json({ error: 'This URL is not supported.' });
    if (msg.includes('Private'))         return res.status(400).json({ error: 'This video is private.' });
    res.status(500).json({ error: 'Could not fetch video info.' });
  }
});

// ─── GET /api/download?url=...&fmt=... ───────────────────────────────────────
app.get('/api/download', (req, res) => {
  const { url, fmt = 'mp4' } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });
  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const formatMap = {
    mp3:    ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
    wav:    ['-x', '--audio-format', 'wav'],
    webm:   ['-f', 'bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio'],
    '4k':   ['-f', 'bestvideo[height<=2160]+bestaudio/best'],
    '1080p':['-f', 'bestvideo[height<=1080]+bestaudio/best'],
    '720p': ['-f', 'bestvideo[height<=720]+bestaudio/best'],
    mp4:    ['-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'],
  };

  const extMap  = { mp3: 'mp3', wav: 'wav', webm: 'webm' };
  const mimeMap = { mp3: 'audio/mpeg', wav: 'audio/wav', webm: 'video/webm' };
  const ext  = extMap[fmt]  || 'mp4';
  const mime = mimeMap[fmt] || 'video/mp4';
  const fmtArgs = formatMap[fmt] || formatMap.mp4;
  const audioFormats = ['mp3', 'wav'];
  const mergeArgs = audioFormats.includes(fmt) ? [] : ['--merge-output-format', ext === 'mp4' ? 'mp4' : ext];

  res.setHeader('Content-Disposition', `attachment; filename="video.${ext}"`);
  res.setHeader('Content-Type', mime);

  const { path: ytDlpPath } = require('youtube-dl-exec');
  const { spawn } = require('child_process');

  const args = [
    ...fmtArgs,
    '--no-playlist',
    '--no-warnings',
    ...mergeArgs,
    '-o', '-',
    url,
  ];

  const proc = spawn(ytDlpPath, args);
  proc.stdout.pipe(res);
  proc.stderr.on('data', d => process.stderr.write(d));
  proc.on('error', err => {
    console.error('yt-dlp error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Download failed.' });
  });
  req.on('close', () => proc.kill());
});

app.listen(PORT, () => {
  console.log(`\n✅  Velo running at http://localhost:${PORT}\n`);
});