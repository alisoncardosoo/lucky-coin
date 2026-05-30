import { describe, expect, it, vi } from "vitest";
import { CoinSide, createAudioController, initLuckyCoin, preloadCoinImages } from "../app.js";

class MockParam {
  constructor(initialValue = 0) {
    this.value = initialValue;
  }

  setValueAtTime(value) {
    this.value = value;
  }

  linearRampToValueAtTime(value) {
    this.value = value;
  }

  exponentialRampToValueAtTime(value) {
    this.value = value;
  }

  cancelScheduledValues() {}
}

class MockNode {
  constructor() {
    this.connections = [];
  }

  connect(node) {
    this.connections.push(node);
    return node;
  }
}

class MockGainNode extends MockNode {
  constructor() {
    super();
    this.gain = new MockParam(0.02);
  }
}

class MockFilterNode extends MockNode {
  constructor() {
    super();
    this.frequency = new MockParam(0);
    this.Q = new MockParam(0);
    this.type = "lowpass";
  }
}

class MockOscillatorNode extends MockNode {
  constructor() {
    super();
    this.frequency = new MockParam(0);
    this.detune = new MockParam(0);
    this.type = "sine";
    this.startCalls = [];
    this.stopCalls = [];
  }

  start(when = 0) {
    this.startCalls.push(when);
  }

  stop(when = 0) {
    this.stopCalls.push(when);
  }
}

class MockAudioContext {
  constructor() {
    this.state = "suspended";
    this.currentTime = 1;
    this.destination = new MockNode();
    this.created = {
      gains: [],
      filters: [],
      oscillators: []
    };
    this.resume = vi.fn(async () => {
      this.state = "running";
    });
  }

  createGain() {
    const node = new MockGainNode();
    this.created.gains.push(node);
    return node;
  }

  createBiquadFilter() {
    const node = new MockFilterNode();
    this.created.filters.push(node);
    return node;
  }

  createOscillator() {
    const node = new MockOscillatorNode();
    this.created.oscillators.push(node);
    return node;
  }
}

describe("audio controller", () => {
  it("starts spin, stops spin and plays landing sound", async () => {
    const context = new MockAudioContext();
    const audioController = createAudioController({ audioContextFactory: () => context });

    await audioController.startSpinSound();

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.created.oscillators.length).toBe(4);

    audioController.stopSpinSound();

    const firstSessionOscillators = context.created.oscillators.slice(0, 4);
    expect(firstSessionOscillators.some((node) => node.stopCalls.length > 0)).toBe(true);

    await audioController.playLandingSound(CoinSide.HEADS);

    expect(context.created.oscillators.length).toBeGreaterThan(4);
  });

  it("keeps silent fallback when context cannot be created", async () => {
    const audioController = createAudioController({ audioContextFactory: () => null });

    await expect(audioController.startSpinSound()).resolves.toBeUndefined();
    expect(() => audioController.stopSpinSound()).not.toThrow();
    await expect(audioController.playLandingSound(CoinSide.TAILS)).resolves.toBeUndefined();
    await expect(audioController.playLandingSound("invalid-side")).resolves.toBeUndefined();
  });
});

describe("preload and init", () => {
  it("preloads images and reports status", async () => {
    const OriginalImage = global.Image;
    class FakeImage {
      set src(value) {
        if (value.includes("ok")) {
          setTimeout(() => this.onload?.(), 0);
        } else {
          setTimeout(() => this.onerror?.(), 0);
        }
      }
    }

    global.Image = FakeImage;

    const results = await preloadCoinImages(["ok.png", "fail.png"]);
    expect(results).toEqual([true, false]);

    global.Image = OriginalImage;
  });

  it("binds click and keyboard interactions", async () => {
    document.body.innerHTML = `
      <button id="coin-button" type="button" aria-label="Girar moeda">
        <span id="coin"></span>
      </button>
      <p id="result">Pronto para jogar</p>
    `;

    const context = new MockAudioContext();
    const originalAudioContext = global.AudioContext;

    global.AudioContext = class {
      constructor() {
        return context;
      }
    };

    const matchMedia = vi.fn(() => ({ matches: true }));
    const app = initLuckyCoin(document, { matchMedia });

    const coinButton = document.getElementById("coin-button");
    const result = document.getElementById("result");
    const coin = document.getElementById("coin");

    const emitTransitionEnd = () => {
      const event = new Event("transitionend", { bubbles: true });
      Object.defineProperty(event, "propertyName", { value: "transform" });
      coin.dispatchEvent(event);
    };

    coinButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    emitTransitionEnd();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.textContent).toMatch(/Resultado: (Cara|Coroa)/);

    coinButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    emitTransitionEnd();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(matchMedia).toHaveBeenCalled();

    app.dispose();
    global.AudioContext = originalAudioContext;
  });

  it("registers service worker when running on http", () => {
    document.body.innerHTML = `
      <button id="coin-button" type="button" aria-label="Girar moeda">
        <span id="coin"></span>
      </button>
      <button id="spin-button" type="button" aria-label="Girar moeda">Girar moeda</button>
      <p id="result">Pronto para jogar</p>
      <p id="coin-outcome">Jogue para descobrir</p>
    `;

    const register = vi.fn(() => Promise.resolve({}));
    const fakeNavigator = { serviceWorker: { register } };
    const fakeWindow = {
      location: { protocol: "http:" },
      matchMedia: vi.fn(() => ({ matches: false }))
    };

    const app = initLuckyCoin(document, fakeWindow, fakeNavigator);

    expect(register).toHaveBeenCalledWith("./service-worker.js");
    app.dispose();
  });
});
