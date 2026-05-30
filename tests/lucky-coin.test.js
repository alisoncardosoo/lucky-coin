import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CoinSide,
  FLIP_LIMITS,
  chooseSide,
  createCoinController,
  createFlipConfig,
  createReducedMotionFlipConfig,
  resolveTargetRotation
} from "../app.js";

function createSequentialRandom(values) {
  const queue = [...values];
  return () => {
    if (queue.length === 0) {
      return 0.5;
    }
    return queue.shift();
  };
}

function buildDomFixture() {
  document.body.innerHTML = `
    <p id="coin-outcome"></p>
    <button id="coin-button" type="button">
      <span id="coin"></span>
    </button>
    <p id="result"></p>
  `;

  return {
    outcomeElement: document.getElementById("coin-outcome"),
    coinElement: document.getElementById("coin"),
    buttonElement: document.getElementById("coin-button"),
    resultElement: document.getElementById("result")
  };
}

describe("chooseSide", () => {
  it("returns cara when random bit is 0", () => {
    expect(chooseSide(0)).toBe(CoinSide.HEADS);
  });

  it("returns coroa when random bit is 1", () => {
    expect(chooseSide(1)).toBe(CoinSide.TAILS);
  });

  it("throws for invalid random bit", () => {
    expect(() => chooseSide(2)).toThrow("randomBit must be 0 or 1");
  });
});

describe("createFlipConfig", () => {
  it("returns duration and turns in configured range", () => {
    const configAtMin = createFlipConfig(CoinSide.HEADS, () => 0);
    const configAtMax = createFlipConfig(CoinSide.TAILS, () => 0.9999);

    expect(configAtMin.durationMs).toBe(FLIP_LIMITS.minDurationMs);
    expect(configAtMin.extraTurns).toBe(FLIP_LIMITS.minTurns);
    expect(configAtMax.durationMs).toBe(FLIP_LIMITS.maxDurationMs);
    expect(configAtMax.extraTurns).toBe(FLIP_LIMITS.maxTurns);
  });

  it("creates final rotation that includes requested side", () => {
    const heads = createFlipConfig(CoinSide.HEADS, () => 0.2);
    const tails = createFlipConfig(CoinSide.TAILS, () => 0.2);

    expect(heads.totalRotationDeg % 360).toBe(0);
    expect(tails.totalRotationDeg % 360).toBe(180);
  });
});

describe("createReducedMotionFlipConfig", () => {
  it("keeps a short visible spin for reduced motion mode", () => {
    const config = createReducedMotionFlipConfig(CoinSide.TAILS);

    expect(config.durationMs).toBeGreaterThan(0);
    expect(config.extraTurns).toBe(1);
    expect(config.totalRotationDeg % 360).toBe(180);
  });
});

describe("resolveTargetRotation", () => {
  it("normalizes current rotation and lands on selected side", () => {
    const target = resolveTargetRotation(810, 1980, CoinSide.TAILS);
    expect(target % 360).toBe(180);
  });
});

describe("createCoinController", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("updates DOM with final result and unlocks button", async () => {
    const { outcomeElement, coinElement, buttonElement, resultElement } = buildDomFixture();

    const audioController = {
      startSpinSound: vi.fn(async () => {}),
      stopSpinSound: vi.fn(() => {}),
      playLandingSound: vi.fn(async () => {})
    };

    const transitionWaiter = vi.fn(async () => {});
    const randomFn = createSequentialRandom([0.2, 0.15, 0.3]);

    const controller = createCoinController({
      coinElement,
      buttonElement,
      resultElement,
      outcomeElement,
      audioController,
      transitionWaiter,
      randomFn
    });

    const result = await controller.runFlip();

    expect(result).toBe(CoinSide.HEADS);
    expect(resultElement.textContent).toBe("Resultado: Cara");
    expect(outcomeElement.textContent).toBe("Deu Cara");
    expect(buttonElement.disabled).toBe(false);
    expect(coinElement.style.transform).toContain("rotateY(");
    expect(controller.getState().flipCount).toBe(1);
  });

  it("ignores a second call while already flipping", async () => {
    const { outcomeElement, coinElement, buttonElement, resultElement } = buildDomFixture();

    let releaseTransition;
    const transitionWaiter = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseTransition = resolve;
        })
    );

    const audioController = {
      startSpinSound: vi.fn(async () => {}),
      stopSpinSound: vi.fn(() => {}),
      playLandingSound: vi.fn(async () => {})
    };

    const randomFn = createSequentialRandom([0.8, 0.3, 0.4]);

    const controller = createCoinController({
      coinElement,
      buttonElement,
      resultElement,
      outcomeElement,
      audioController,
      transitionWaiter,
      randomFn
    });

    const firstRunPromise = controller.runFlip();
    const secondRunPromise = controller.runFlip();

    expect(controller.getState().isFlipping).toBe(true);
    expect(audioController.startSpinSound).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(transitionWaiter).toHaveBeenCalledTimes(1);
    });

    releaseTransition();

    const [firstResult, secondResult] = await Promise.all([firstRunPromise, secondRunPromise]);

    expect(firstResult).toBe(CoinSide.TAILS);
    expect(secondResult).toBeNull();
    expect(controller.getState().flipCount).toBe(1);
  });

  it("plays audio in correct sequence", async () => {
    const { outcomeElement, coinElement, buttonElement, resultElement } = buildDomFixture();

    const events = [];
    const audioController = {
      startSpinSound: vi.fn(async () => {
        events.push("start");
      }),
      stopSpinSound: vi.fn(() => {
        events.push("stop");
      }),
      playLandingSound: vi.fn(async () => {
        events.push("landing");
      })
    };

    const controller = createCoinController({
      coinElement,
      buttonElement,
      resultElement,
      outcomeElement,
      audioController,
      transitionWaiter: vi.fn(async () => {}),
      randomFn: createSequentialRandom([0.3, 0.3, 0.2])
    });

    await controller.runFlip();

    expect(events).toEqual(["start", "stop", "landing"]);
  });

  it("uses short animation instead of instant swap in reduced motion", async () => {
    const { outcomeElement, coinElement, buttonElement, resultElement } = buildDomFixture();

    const controller = createCoinController({
      coinElement,
      buttonElement,
      resultElement,
      outcomeElement,
      audioController: {
        startSpinSound: vi.fn(async () => {}),
        stopSpinSound: vi.fn(() => {}),
        playLandingSound: vi.fn(async () => {})
      },
      transitionWaiter: vi.fn(async () => {}),
      randomFn: createSequentialRandom([0.1]),
      prefersReducedMotion: true
    });

    await controller.runFlip();

    expect(coinElement.style.transition).toContain("480ms");
  });

  it("keeps the correct side on consecutive flips", async () => {
    const { outcomeElement, coinElement, buttonElement, resultElement } = buildDomFixture();

    const controller = createCoinController({
      coinElement,
      buttonElement,
      resultElement,
      outcomeElement,
      audioController: {
        startSpinSound: vi.fn(async () => {}),
        stopSpinSound: vi.fn(() => {}),
        playLandingSound: vi.fn(async () => {})
      },
      transitionWaiter: vi.fn(async () => {}),
      randomFn: createSequentialRandom([0.9, 0.2, 0.2, 0.95, 0.2, 0.2])
    });

    await controller.runFlip();
    await controller.runFlip();

    expect(controller.getState().lastResult).toBe(CoinSide.TAILS);
    expect(controller.getState().currentRotationDeg % 360).toBe(180);
    expect(resultElement.textContent).toBe("Resultado: Coroa");
    expect(outcomeElement.textContent).toBe("Deu Coroa");
  });
});
