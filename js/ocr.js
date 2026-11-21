// Reads the text in a screenshot on the phone itself (free, nothing is uploaded).
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the screenshot reader. Check your connection.'));
    document.head.appendChild(s);
  });
}

// Flashscore is often in dark mode: make the image large, grey and dark-on-light, which OCR reads best.
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < 1200 ? 2 : 1;
  const c = document.createElement('canvas');
  c.width = bmp.width * scale;
  c.height = bmp.height * scale;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = g;
    sum += g;
  }
  if (sum / (d.length / 4) < 128) for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 255 - d[i];
  ctx.putImageData(img, 0, 0);
  return c;
}

export async function readScreenshot(file, onProgress = () => {}) {
  await loadScript(TESSERACT);
  const canvas = await prepare(file);
  const { data } = await window.Tesseract.recognize(canvas, 'eng', {
    logger: (m) => { if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100)); },
  });
  return data.text.split('\n').map((l) => l.trim()).filter(Boolean);
}
