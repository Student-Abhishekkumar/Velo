const express  = require('express');
const { exec, spawn } = require('child_process');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// ─── GET /api/info?url=... ───────────────────────────────────────────────────
app.get('/api/info', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const safe = url.replace(/"/g, '');
  exec(
    `yt-dlp --no-playlist --dump-json --no-warnings "${safe}"`,
    { timeout: 25000 },
    (err, stdout, stderr) => {
      if (err) {
        const msg = stderr || err.message || '';
        if (msg.includes('not found') || err.code === 127)
          return res.status(500).json({ error: 'yt-dlp is not installed. Run: pip install yt-dlp' });
        if (msg.includes('Unsupported URL'))
          return res.status(400).json({ error: 'This URL is not supported.' });
        if (msg.includes('Private'))
          return res.status(400).json({ error: 'This video is private.' });
        return res.status(500).json({ error: 'Could not fetch video info.' });
      }

      try {
        const info = JSON.parse(stdout.trim().split('\n')[0]);
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
      } catch {
        res.status(500).json({ error: 'Failed to parse video info.' });
      }
    }
  );
});

// ─── GET /api/download?url=...&fmt=... ────────────────────────────────────────
app.get('/api/download', (req, res) => {
  const { url, fmt = 'mp4' } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url' });

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const formatMap = {
    mp3:   ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
    wav:   ['-x', '--audio-format', 'wav'],
    webm:  ['-f', 'bestvideo[ext=webm]+bestaudio[ext=webm]/bestvideo+bestaudio'],
    '4k':  ['-f', 'bestvideo[height<=2160]+bestaudio/best'],
    '1080p': ['-f', 'bestvideo[height<=1080]+bestaudio/best'],
    '720p':  ['-f', 'bestvideo[height<=720]+bestaudio/best'],
    mp4:   ['-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'],
  };

  const extMap = { mp3: 'mp3', wav: 'wav', webm: 'webm' };
  const ext      = extMap[fmt] || 'mp4';
  const mimeMap  = { mp3: 'audio/mpeg', wav: 'audio/wav', webm: 'video/webm' };
  const mime     = mimeMap[fmt] || 'video/mp4';
  const fmtArgs  = formatMap[fmt] || formatMap.mp4;

  res.setHeader('Content-Disposition', `attachment; filename="video.${ext}"`);
  res.setHeader('Content-Type', mime);

  const audioFormats = ['mp3', 'wav'];
  const mergeArgs = audioFormats.includes(fmt)
    ? []
    : ['--merge-output-format', ext === 'mp4' ? 'mp4' : ext];

  const args = [
    ...fmtArgs,
    '--no-playlist',
    '--no-warnings',
    ...mergeArgs,
    '-o', '-',
    url.replace(/"/g, ''),
  ];

  const ytdlp = spawn('yt-dlp', args);
  ytdlp.stdout.pipe(res);
  ytdlp.stderr.on('data', d => process.stderr.write(d));
  ytdlp.on('error', err => {
    console.error('yt-dlp error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'yt-dlp not found. Run: pip install yt-dlp' });
  });
  req.on('close', () => ytdlp.kill());
});

app.listen(PORT, () => {
  console.log(`\n✅  Velo running at http://localhost:${PORT}\n`);
});
