/* ─── CURSOR EFFECT ─── */
const ring  = document.getElementById('cursor-ring');
const dot   = document.getElementById('cursor-dot');
const trail = document.getElementById('cursor-trail');
let mx = -200, my = -200, tx = -200, ty = -200;

document.addEventListener('mousemove', e => {
  mx = e.clientX; my = e.clientY;
  dot.style.left = mx + 'px';
  dot.style.top  = my + 'px';
  // ring follows with CSS transition for smooth lag
  ring.style.left = mx + 'px';
  ring.style.top  = my + 'px';
});

// Trail lags further behind
function animTrail() {
  tx += (mx - tx) * 0.18;
  ty += (my - ty) * 0.18;
  trail.style.left = tx + 'px';
  trail.style.top  = ty + 'px';
  requestAnimationFrame(animTrail);
}
animTrail();

document.querySelectorAll('a,button,.pill,.chip,.feat,.stat').forEach(el => {
  el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
  el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
});
document.addEventListener('mousedown', () => document.body.classList.add('cursor-click'));
document.addEventListener('mouseup',   () => document.body.classList.remove('cursor-click'));

// Hide default cursor on desktop
document.body.style.cursor = 'none';
document.querySelectorAll('input').forEach(i => i.style.cursor = 'text');

/* ─── FORMAT PICKER ─── */
let fmt = 'mp4';
function pickFmt(el, f) {
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('on'));
  el.classList.add('on');
  fmt = f;
}

/* ─── ERROR HELPERS ─── */
function showErr(msg) {
  const e = document.getElementById('errBox');
  e.textContent = '⚠ ' + msg;
  e.style.display = 'block';
  document.getElementById('result').style.display = 'none';
}
function hideErr() { document.getElementById('errBox').style.display = 'none'; }

/* ─── VIDEO FETCH ─── */
// Step 1: noembed.com — free oEmbed proxy, CORS-safe, no key needed.
//         Returns title + thumbnail for YouTube, Vimeo, TikTok, Twitter, etc.
// Step 2: For the actual file, we build a cobalt.tools deep-link and open it.
//         Cobalt blocks direct XHR (CORS), but works perfectly when opened as a URL.
let currentVideoUrl = null;

async function doFetch() {
  const val = document.getElementById('urlInput').value.trim();
  hideErr();
  if (!val) { showErr('Please enter a URL.'); return; }

  let parsed;
  try { parsed = new URL(val); } catch {
    showErr("That doesn't look like a valid URL."); return;
  }

  const btn = document.getElementById('fetchBtn');
  btn.textContent = 'Fetching…';
  btn.disabled = true;
  document.getElementById('result').style.display = 'none';
  currentVideoUrl = val;

  // Show skeleton while fetching from our API
  document.getElementById('rThumb').textContent = '⏳';
  document.getElementById('rTitle').textContent = 'Fetching video info…';
  document.getElementById('rFmt').textContent   = fmt.toUpperCase();
  document.getElementById('rDur').textContent   = '—';
  document.getElementById('rSize').textContent  = '—';
  document.getElementById('result').style.display = 'block';

  // — Call our /api/info serverless function —
  try {
    const res = await fetch(`/api/info?url=${encodeURIComponent(val)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not fetch video info');

    const thumbEl = document.getElementById('rThumb');
    if (data.thumbnail) {
      const img = new Image();
      img.src = data.thumbnail;
      img.alt = '';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px';
      img.onerror = () => { thumbEl.textContent = '▶'; };
      thumbEl.innerHTML = '';
      thumbEl.appendChild(img);
    } else {
      thumbEl.textContent = '▶';
    }
    document.getElementById('rTitle').textContent = data.title  || 'Unknown title';
    document.getElementById('rFmt').textContent   = fmt.toUpperCase();
    document.getElementById('rDur').textContent   = data.duration || '—';
    document.getElementById('rSize').textContent  = data.uploader || '—';
    document.getElementById('result').style.display = 'block';
  } catch(err) {
    showErr(err.message);
    document.getElementById('result').style.display = 'none';
  }

  btn.textContent = 'Fetch ↗';
  btn.disabled = false;
}

/* ─── DOWNLOAD — calls /api/download which streams the file directly ─── */
function startDl() {
  if (!currentVideoUrl) return;

  const btn  = document.getElementById('dlBtn');
  const wrap = document.getElementById('prog-wrap');
  const fill = document.getElementById('progFill');
  const pct  = document.getElementById('progPct');
  const text = document.getElementById('progText');

  wrap.style.display = 'block';
  btn.disabled = true;
  btn.textContent = '⬇ Downloading…';
  text.textContent = 'Starting download…';

  // Trigger browser download via our API — no redirect to third-party site
  const dlUrl = `/api/download?url=${encodeURIComponent(currentVideoUrl)}&fmt=${encodeURIComponent(fmt)}`;
  const a = document.createElement('a');
  a.href = dlUrl;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  let p = 0;
  const iv = setInterval(() => {
    p += Math.random() * 10 + 3;
    if (p >= 100) {
      p = 100; clearInterval(iv);
      text.textContent = '✓ Download started!';
      pct.textContent  = '100%';
      fill.style.background = 'linear-gradient(90deg,#34d399,#059669)';
      fill.style.animation  = 'none';
      btn.textContent = '✓ Done';
      setTimeout(() => {
        wrap.style.display = 'none';
        btn.disabled = false;
        btn.textContent = '↓ Save';
        fill.style.width = '0%';
        fill.style.background = 'linear-gradient(90deg,var(--accent),var(--accent2),var(--accent3))';
        fill.style.animation = 'shimmer 2s linear infinite';
      }, 3000);
    }
    fill.style.width = p.toFixed(1) + '%';
    pct.textContent  = p.toFixed(0) + '%';
  }, 80);
}

document.getElementById('urlInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doFetch();
});
