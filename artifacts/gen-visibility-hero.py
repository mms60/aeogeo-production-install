"""Render the AI-visibility hero background: dark navy fiber-optic wave with bokeh."""
import numpy as np
from PIL import Image

rng = np.random.default_rng(11)
W, H = 2400, 1000

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
t = yy / (H - 1)

top = np.array([2, 6, 14], np.float32)
mid = np.array([5, 22, 38], np.float32)
bot = np.array([2, 9, 20], np.float32)
base = np.where(t[..., None] < 0.5,
                top + (mid - top) * (t[..., None] / 0.5),
                mid + (bot - mid) * ((t[..., None] - 0.5) / 0.5))

# broad teal haze behind the wave
cx, cy = 0.60 * W, 0.50 * H
haze = np.exp(-(((xx - cx) / (0.42 * W)) ** 2 + ((yy - cy) / (0.32 * H)) ** 2))
base = base + haze[..., None] * np.array([6, 24, 38], np.float32)


def blur(a, sigma):
    """Gaussian blur via a frequency-domain kernel (PIL cannot blur float images)."""
    if sigma <= 0:
        return a.astype(np.float32)
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fy ** 2 + fx ** 2))
    return np.fft.irfft2(np.fft.rfft2(a) * g, s=a.shape).astype(np.float32)


# centre line of the ribbon: crest at left, trough mid, gentle rise to the right
ctrl_t = np.array([0.0, 0.12, 0.26, 0.42, 0.58, 0.74, 0.88, 1.0])
ctrl_y = np.array([0.20, 0.28, 0.44, 0.58, 0.63, 0.56, 0.47, 0.43]) * H
xs_idx = np.arange(W, dtype=np.float32)
ys = np.interp(xs_idx, ctrl_t * (W - 1), ctrl_y)
k = np.exp(-(np.arange(-90, 91) ** 2) / (2 * 26 ** 2))
k /= k.sum()
ys = np.convolve(np.pad(ys, 90, mode="edge"), k, mode="same")[90:-90]

spread = 10 + 200 * (xs_idx / (W - 1)) ** 1.25

lum = np.zeros((H, W), np.float32)
lum_soft = np.zeros((H, W), np.float32)

for _ in range(190):
    u = rng.uniform(-1, 1)
    phase = rng.uniform(0, 2 * np.pi)
    freq = rng.uniform(0.0035, 0.011)
    wob = (3 + 12 * abs(u)) * np.sin(xs_idx * freq + phase)
    yline = ys + u * spread * rng.uniform(0.75, 1.0) + wob
    amp = np.full(W, rng.uniform(0.18, 0.95) * (0.45 + 0.55 * np.cos(u * 1.15) ** 2), np.float32)

    xi = xs_idx.astype(np.int32)
    yi = np.floor(yline).astype(np.int32)
    frac = yline - yi
    ok = (yi >= 0) & (yi < H - 1)
    xi, yi, frac, a = xi[ok], yi[ok], frac[ok], amp[ok]
    np.add.at(lum, (yi, xi), a * (1 - frac))
    np.add.at(lum, (yi + 1, xi), a * frac)
    # thin secondary hairline just off the strand for the bundle texture
    yi2 = yi + 2
    np.add.at(lum_soft, (yi2, xi), a * 0.35)

lum = lum + lum_soft
lum = np.clip(lum, 0, None)

core = blur(lum, 0.7) * 1.25
g1 = blur(lum, 5.5)
g2 = blur(lum, 26)

# fibre speckles riding the strands
dots = np.zeros((H, W), np.float32)
n = 1500
dx = rng.integers(0, W, n)
dy = (ys[dx] + rng.normal(0, 1, n) * spread[dx] * 0.55).astype(np.int32)
dy = np.clip(dy, 1, H - 2)
np.add.at(dots, (dy, dx), rng.uniform(0.5, 2.2, n))
dots = blur(dots, 0.6)

img = base.astype(np.float32)
img = img + core[..., None] * np.array([150, 225, 255], np.float32) * 0.9
img = img + g1[..., None] * np.array([34, 150, 225], np.float32) * 0.85
img = img + g2[..., None] * np.array([14, 80, 150], np.float32) * 0.8
img = img + dots[..., None] * np.array([190, 245, 255], np.float32)

# bokeh discs
bokeh = np.zeros((H, W, 3), np.float32)
palette = np.array([
    [46, 190, 255],
    [70, 205, 255],
    [28, 140, 220],
    [236, 190, 118],
    [210, 170, 110],
    [205, 235, 255],
], np.float32)
weights = np.array([0.24, 0.14, 0.14, 0.22, 0.14, 0.12])
for _ in range(85):
    if rng.random() < 0.55:
        bx = int(rng.uniform(0, 0.48) * W)
        by = int(rng.uniform(0.38, 1.02) * H)
    else:
        bx = int(rng.uniform(0.30, 1.0) * W)
        by = int(rng.uniform(0.18, 0.95) * H)
    r = int(np.exp(rng.uniform(np.log(7), np.log(48))))
    col = palette[rng.choice(len(palette), p=weights)]
    bright = rng.uniform(0.12, 0.55)
    y0, y1 = max(0, by - r), min(H, by + r + 1)
    x0, x1 = max(0, bx - r), min(W, bx + r + 1)
    if y1 <= y0 or x1 <= x0:
        continue
    gy, gx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    d = np.sqrt((gx - bx) ** 2 + (gy - by) ** 2) / max(r, 1)
    a = np.clip(1 - d, 0, 1) ** 1.5
    a = blur(a, max(0.8, r * 0.06))
    bokeh[y0:y1, x0:x1] += a[..., None] * col * bright

img = img + bokeh

# soft tonemap, vignette, grain
img = 255.0 * (1.0 - np.exp(-np.clip(img, 0, None) / 205.0))
vign = 1 - 0.35 * (((xx - W / 2) / (W / 2)) ** 2 * 0.5 + ((yy - H / 2) / (H / 2)) ** 2 * 0.5)
img *= np.clip(vign, 0, 1)[..., None]
img += rng.normal(0, 1.6, img.shape)
img = np.clip(img, 0, 255).astype(np.uint8)

out = Image.fromarray(img, "RGB")
out.save("site/images/visibility-hero-wave.jpg", quality=86, optimize=True, progressive=True)
out.save("site/images/visibility-hero-wave.webp", quality=82, method=6)
print("saved", out.size)
