import { colord } from "colord";
import workletSource from "./worklet.js?raw";

export const isCSSHoudiniSupported = typeof CSS !== "undefined" && CSS.paintWorklet !== undefined;

interface InitOptions {
  readonly onlyInViewport?: boolean;
}

export interface SpoilerPainterOptions {
  readonly fps?: number;
  readonly gap?: number | boolean;
  readonly density?: number;
  readonly mimicWords?: boolean;
  readonly accentColor?: string;
  readonly fallback?: string | false;
  readonly forceFallback?: boolean;
}

export const DEFAULT_OPTIONS = {
  fps: 24,
  gap: 6,
  density: 0.12,
  mimicWords: false,
  fallback: "black",
} as const;

export type CtorOptions = InitOptions & SpoilerPainterOptions;

interface TransitionOptions {
  readonly animate?: boolean | number;
}

const DEFAULT_FPS = 24;

/*
 * The maximum size of a block that can be drawn without using tiling
 * (to improve performance and enable gaps)
 */
const BLOCK_MAX_TILE = 293; // prime

/*
 * The maximum width of an inline element that can be drawn without using tiling
 */
const INLINE_MAX_TILE = 333; // prime

const DEFAULT_FADE_DURATION = 1.5; // in seconds

const GAP_RATIO = 8.0;

// Check if the user has requested reduced motion
const prefersReducedMotion =
  "matchMedia" in globalThis &&
  typeof globalThis.matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

class SpoilerPainter {
  readonly el: HTMLElement;
  maxFPS: number = DEFAULT_FPS;

  #forceFallback: boolean = false;

  constructor(el: HTMLElement, options: CtorOptions = {}) {
    this.el = el;

    this.#tstop = 0;
    this.update(options);

    if (options.onlyInViewport === true) {
      // ensure that animation isn't running when the element is not visible
      this.#watchInViewport();
    }
  }

  #wasDestroyed = false;

  /**
   * Stops everything and reverts the styles
   */
  destroy() {
    this.#wasDestroyed = true;
    this.stopAnimation();

    ["background", "--t", "--t-stop", "--fade", "--gap", "--words", "--density"].forEach((prop) => {
      this.el.style.removeProperty(prop);
    });

    // Cleanup the Intersection Observer
    if (this.#observer) {
      this.#observer.disconnect();
      this.#observer = null;
    }
  }

  /**
   * `fps` - the maximum frames per second
   * `mimicWords` - if true, the spoiler will try to mimic the shape of words (cssvar)
   * `density` - overrides the density of the noise (cssvar)
   * `gap` - in px a gap that particles won't spawn within (ignored for elements that exceed
   *         the size limit)
   */
  update({
    fps = DEFAULT_OPTIONS.fps,
    gap = DEFAULT_OPTIONS.gap,
    mimicWords = DEFAULT_OPTIONS.mimicWords,
    density = DEFAULT_OPTIONS.density,
    fallback = DEFAULT_OPTIONS.fallback,
    forceFallback,
    accentColor,
  }: SpoilerPainterOptions = {}) {
    if (this.#wasDestroyed) {
      throw new Error("Painter has been destroyed and can't be used again.");
    }

    // disable animation if the user has requested reduced motion
    this.maxFPS = prefersReducedMotion ? 0 : fps;
    this.#forceFallback = Boolean(forceFallback);

    if (!isCSSHoudiniSupported || forceFallback) {
      this.el.style.setProperty("--fallback", fallback || "initial");
      return;
    }

    const isBlockElement = getComputedStyle(this.el).getPropertyValue("display") !== "inline";
    this.useBackgroundStyle("auto", "auto", { tile: false });

    /* block elements */
    if (isBlockElement) {
      // this feature can't be used with block elements!
      mimicWords = false;

      const rect = this.el.getBoundingClientRect();

      if (rect.width * rect.height > BLOCK_MAX_TILE * BLOCK_MAX_TILE) {
        this.useBackgroundStyle(
          Math.min(rect.width, BLOCK_MAX_TILE),
          Math.min(rect.height, BLOCK_MAX_TILE),
          { tile: true },
        );
      } else {
        // we can draw the whole block without tiling meaning we can use gaps
        // cap the gap value, so that it looks nice on smaller elements
        const capGap = Math.floor(
          Math.min(Number(gap), rect.width / GAP_RATIO, rect.height / GAP_RATIO),
        );

        this.el.style.setProperty("--gap", `${capGap}px ${capGap}px`);
      }
    }

    if (!isBlockElement) {
      const rects = [...this.el.getClientRects()];
      const heightOfLine = Math.min(...rects.map((r) => r.height));

      this.useBackgroundStyle(INLINE_MAX_TILE, heightOfLine, { tile: true });

      // use top/bottom gaps only
      const capGap = Math.floor(Math.min(heightOfLine / GAP_RATIO, Number(gap)));
      this.el.style.setProperty("--gap", `0 ${capGap}px`);
    }

    this.el.style.setProperty("--words", String(mimicWords));
    this.el.style.setProperty("--density", String(density));

    if (accentColor) {
      const hsl = colord(accentColor).toHsl();
      this.el.style.setProperty("--accent", `${hsl.h}deg ${hsl.s}% ${hsl.l}%`);
    } else {
      this.el.style.removeProperty("--accent");
    }
  }

  useBackgroundStyle(ws: string | number, hs: string | number, options?: { tile: boolean }) {
    ws = typeof ws === "number" ? `${ws}px` : ws;
    hs = typeof hs === "number" ? `${hs}px` : hs;

    const repeatAndPosition = options?.tile ? "repeat left center" : "no-repeat center center";

    this.el.style.background = `paint(spoiler) ${repeatAndPosition} / ${ws} ${hs}`;
  }

  /**
   * Hides and reveals the content. Turns the noise animation on and off.
   */
  #isHidden: boolean = false;

  get isHidden() {
    return this.#isHidden;
  }

  #_fadeDuration: number = 0.0;

  set #fadeDuration(value: number | null) {
    this.el.style.setProperty("--fade", `${(this.#_fadeDuration = Number(value))}s`);
  }

  get #fadeDuration(): number {
    return this.#_fadeDuration;
  }

  parseFadeDuration(value: number | boolean | undefined) {
    if (prefersReducedMotion) return 0;

    const duration = value === true ? DEFAULT_FADE_DURATION : Number(value);
    return duration;
  }

  hide({ animate = true }: TransitionOptions = {}) {
    this.#isHidden = true;

    if (!isCSSHoudiniSupported || this.#forceFallback) {
      this.el.style.setProperty("background", "var(--fallback)");
      return;
    }

    this.#fadeDuration = this.parseFadeDuration(animate);
    this.#tstop = null; // reset the stop point
    this.t = 0; // reset the clock

    this.startAnimation();
  }

  reveal({ animate = true }: TransitionOptions = {}) {
    this.#isHidden = false;

    if (!isCSSHoudiniSupported || this.#forceFallback) {
      this.el.style.removeProperty("background");
      return;
    }

    const duration = this.parseFadeDuration(animate);

    this.#fadeDuration = duration;
    this.#tstop = this.t;

    if (duration <= 0) {
      this.stopAnimation();
    }
  }

  /**
   * Clock states
   */
  #_t = 0.0;
  #t0 = 0.0;
  #_tstop: number | null = null;

  get #tstop(): number | null {
    return this.#_tstop;
  }

  set #tstop(value: number | null) {
    this.#_tstop = value;
    if (value !== null) {
      this.el.style.setProperty("--t-stop", value.toFixed(3)); // 1ms precision
    } else {
      this.el.style.removeProperty("--t-stop");
    }
  }

  get t() {
    return this.#_t;
  }

  set t(value: number) {
    this.#_t = value;
    this.el.style.setProperty("--t", value.toFixed(3)); // 1ms precision
  }

  // animation loop
  #frame = (now: DOMHighResTimeStamp) => {
    if (this.#wasDestroyed) return;
    const shouldStop = this.#tstop && this.t > this.#tstop + this.#fadeDuration;

    if (this.maxFPS > 0 && !shouldStop) {
      this.#raf = requestAnimationFrame(this.#frame);
    }

    const dt = now - this.#t0;

    // don't skip the first frame (dt = 0)
    if (dt > 0 && dt < 1000 / this.maxFPS) return; // skip frames to limit fps

    this.t += dt / 1000; // in seconds
    this.#t0 = now;
  };

  /** Animation state */

  #raf: ReturnType<typeof requestAnimationFrame> | null = null;

  startAnimation() {
    this.#t0 = performance.now();
    this.#frame(this.#t0);
  }

  stopAnimation() {
    if (this.#raf) {
      cancelAnimationFrame(this.#raf);
      this.#raf = null;
    }
  }

  get isAnimating() {
    return this.#raf !== null;
  }

  #observer: IntersectionObserver | null = null;

  #watchInViewport(): void {
    if (typeof IntersectionObserver === "undefined") return;

    this.#observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            this.stopAnimation();
          } else {
            this.startAnimation();
          }
        });
      },
      {
        root: null, // observes the element in the viewport
        threshold: 0.1, // trigger if 10% of the element is visible
      },
    );

    this.#observer.observe(this.el);
  }
}

declare global {
  namespace CSS {
    module paintWorklet {
      function addModule(moduleURL: string): Promise<void>;
    }
  }
}

if (isCSSHoudiniSupported) {
  // register paint inline worklet
  CSS.paintWorklet.addModule(
    URL.createObjectURL(new Blob([workletSource], { type: "application/javascript" })),
  );
}

export { SpoilerPainter };
