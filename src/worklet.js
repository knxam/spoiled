const _IS_WORKLET = typeof registerPaint !== "undefined";

const lcgrand =
  (seed = 1) =>
  (a = 0, b = 1) =>
    a +
    (Math.abs(b - a) *
      (Math.imul(48271, (seed = Math.imul(214013, seed) + 2531011)) & 0x7fffffff)) /
      0x7fffffff;

const lerp = (a, b, t) => a + (b - a) * t;

// vector utils
const pol2vec = (l, a = 0) => [l * Math.cos(a), l * Math.sin(a)];
const vecmag = ([x, y]) => Math.sqrt(x * x + y * y);
const vecnorm = ([x, y], l = vecmag([x, y])) => (l === 0 ? [0, 0] : [x / l, y / l]);

// TODO!
function trapezoidalWave(t, l, n) {
  if (t < 0.2) {
    return t / 0.2;
  } else if (t > n - l) {
    return (n - t) / l;
  } else {
    return 1;
  }
}

const _cycle = (x, n) => ((x % n) + n) % n;
const _mirror = (x, n, r) => (x < r ? n + x : x > n - r ? x - n : x);

const cycleBounds = ([x, y], [w, h], r) => {
  const [tx, ty] = [_cycle(x, w), _cycle(y, h)];
  return [
    [tx, ty],
    [_mirror(tx, w, r), _mirror(ty, h, r)],
  ];
};

const words = "5344247686631652935544373471676176265274".split("").map((x) => parseInt(x, 10));

const wordDist = (pos, gap, em) => {
  // i=0..1 gap=0..1
  let marker = 0,
    i = 0;
  chunks = [];
  do {
    chunks.push([marker, (marker = Math.min(1, marker + words[i++ % words.length] * em))]);
    marker += gap;
  } while (marker < 1);
  chunks[chunks.length - 1][1] = 1;

  const len = chunks.map(([a, b]) => b - a).reduce((a, b) => a + b, 0);
};

/**
 * WORKLET
 */

const getCSSVar = (props, name) => {
  const val = props.get(name);
  return val?.length >= 1 ? val[0] : undefined;
};

class SpoilerPainter {
  static get contextOptions() {
    return { alpha: true };
  }

  /*
   use this function to retrieve any custom properties (or regular properties, such as 'height')
   defined for the element, return them in the specified array
  */
  static get inputProperties() {
    return ["--t", "--gap", "--accent"];
  }

  paint(ctx, size, props) {
    const rand = lcgrand(19234); // predictable random

    // global world time in seconds (always increasing)
    const worldt = parseFloat(getCSSVar(props, "--t")) || 0,
      // `devicePixelRatio` and `dprx` are not the same
      // user agents use higher density bitmaps for canvases when
      // painting from worklets, so 1px stands for 1px on the screen
      dprx = _IS_WORKLET ? 1.0 : devicePixelRatio,
      // hsl format
      accent = (getCSSVar(props, "--accent") || "0 0% 70%").split(" "),
      frict = 0,
      vmin = 2,
      vmax = 12,
      width = size.width / dprx,
      height = size.height / dprx,
      // gaps to the edges
      [vgap, hgap] = (getCSSVar(props, "--gap") || "0px 0px").split(" ").map(parseFloat),
      // assuming density is constant, total number of particles depends
      // on the sq area, but limit it so it doesn't hurt performance
      density = 6,
      n = Math.min(4000, (width * height) / density),
      // size deviation, disabled for low DPR devices, so we don't end up with
      // particles that have initial size of 0 px
      sizedev = devicePixelRatio > 1 ? 0.5 : 0.0;

    ctx.clearRect(0, 0, size.width, size.height);

    for (let i = 0; i < n; ++i) {
      /** Initial values */
      const x0 = rand(vgap, width - vgap);
      const y0 = rand(hgap, height - hgap);

      const v0mag = rand(vmin, vmax),
        size0 = rand(1.0, 1.0 + sizedev);

      const _l = parseInt(accent[2]);
      const lightness = Math.floor(lerp(_l * 0.5, _l, rand()));

      const v0 = pol2vec(v0mag, rand(0, Math.PI * 2));
      const [vx0norm, vy0norm] = vecnorm(v0);
      const [vx0, vy0] = v0;

      const shape = rand() > 0.5 ? "square" : "circle";

      /** Time */
      const lifetime = rand(0.3, 1.5); // in sec
      const respawn = rand(0, 1); // how long until the next respawn

      // ensures that particles don't all spawn at the same time
      const phase = rand(0, lifetime + respawn);
      let t = Math.min(lifetime, (worldt + phase) % (lifetime + respawn));

      if (t >= lifetime) continue;

      const vx = vx0 - 0.5 * frict * t * vx0norm;
      const vy = vy0 - 0.5 * frict * t * vy0norm;

      const x = x0 + vx * t;
      const y = y0 + vy * t;

      const visibility = trapezoidalWave(t, 0.5, lifetime);
      const alpha = 1 - t / lifetime;
      const size = size0 * visibility;

      for (const [wx, wy] of cycleBounds([x, y], [width, height], size / 2)) {
        ctx.beginPath();

        ctx.fillStyle = `hsl(${accent[0]} ${accent[1]} ${lightness}% / ${Math.round(
          alpha * 100
        )}%)`;

        // Two types of shapes ■ and ●
        if (shape === "square") {
          ctx.rect(dprx * wx, dprx * wy, dprx * size, dprx * size);
        } else {
          ctx.arc(dprx * wx, dprx * wy, (dprx * size) / 2, 0, Math.PI * 2);
        }

        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

export { SpoilerPainter };
if (_IS_WORKLET) registerPaint("spoiler", SpoilerPainter);