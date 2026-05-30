export const CoinSide = Object.freeze({
  HEADS: "cara",
  TAILS: "coroa"
});

export const FLIP_LIMITS = Object.freeze({
  minTurns: 4,
  maxTurns: 8,
  minDurationMs: 1400,
  maxDurationMs: 2200
});

export const REDUCED_MOTION_FLIP = Object.freeze({
  turns: 1,
  durationMs: 480
});

const SIDE_ROTATION_DEG = Object.freeze({
  [CoinSide.HEADS]: 0,
  [CoinSide.TAILS]: 180
});

const DEFAULT_STATE = Object.freeze({
  isFlipping: false,
  lastResult: null,
  flipCount: 0,
  currentRotationDeg: 0
});

function isValidSide(side) {
  return side === CoinSide.HEADS || side === CoinSide.TAILS;
}

function clampToInt(value) {
  return Math.floor(value);
}

function randomInt(min, max, randomFn = Math.random) {
  const randomValue = randomFn();
  return clampToInt(randomValue * (max - min + 1)) + min;
}

function normalizeRotation(value) {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function deriveRandomBit(randomValue) {
  return randomValue < 0.5 ? 0 : 1;
}

function getRandomBit() {
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const randomSeed = new Uint32Array(1);
    globalThis.crypto.getRandomValues(randomSeed);
    return randomSeed[0] % 2;
  }

  return deriveRandomBit(Math.random());
}

export function chooseSide(randomBit = getRandomBit()) {
  if (randomBit !== 0 && randomBit !== 1) {
    throw new Error("randomBit must be 0 or 1");
  }

  return randomBit === 0 ? CoinSide.HEADS : CoinSide.TAILS;
}

export function createFlipConfig(side, randomFn = Math.random) {
  if (!isValidSide(side)) {
    throw new Error("Invalid side for coin flip");
  }

  const extraTurns = randomInt(FLIP_LIMITS.minTurns, FLIP_LIMITS.maxTurns, randomFn);
  const durationMs = randomInt(FLIP_LIMITS.minDurationMs, FLIP_LIMITS.maxDurationMs, randomFn);
  const totalRotationDeg = extraTurns * 360 + SIDE_ROTATION_DEG[side];

  return Object.freeze({
    durationMs,
    totalRotationDeg,
    extraTurns
  });
}

export function createReducedMotionFlipConfig(side) {
  if (!isValidSide(side)) {
    throw new Error("Invalid side for reduced motion config");
  }

  const totalRotationDeg = REDUCED_MOTION_FLIP.turns * 360 + SIDE_ROTATION_DEG[side];

  return Object.freeze({
    durationMs: REDUCED_MOTION_FLIP.durationMs,
    totalRotationDeg,
    extraTurns: REDUCED_MOTION_FLIP.turns
  });
}

export function resolveTargetRotation(currentRotationDeg, totalRotationDeg, side) {
  if (!isValidSide(side)) {
    throw new Error("Invalid side for target rotation");
  }

  const currentNormalized = normalizeRotation(currentRotationDeg);
  const sideRotation = SIDE_ROTATION_DEG[side];
  const landingDelta = (sideRotation - currentNormalized + 360) % 360;
  const spinOnlyRotation = totalRotationDeg - sideRotation;

  return currentRotationDeg + spinOnlyRotation + landingDelta;
}

function withNextState(previousState, updates) {
  return Object.freeze({
    ...previousState,
    ...updates
  });
}

function createSilentAudioController() {
  return {
    async startSpinSound() {},
    stopSpinSound() {},
    async playLandingSound() {}
  };
}

function defaultAudioContextFactory() {
  const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
  return AudioContextCtor ? new AudioContextCtor() : null;
}

function safeStopNode(node, when = 0) {
  if (!node || typeof node.stop !== "function") {
    return;
  }

  try {
    node.stop(when);
  } catch {
    // Ignore node stop races when already stopped.
  }
}

export function createAudioController({ audioContextFactory = defaultAudioContextFactory } = {}) {
  let context = null;
  let spinSession = null;

  async function ensureRunningContext() {
    if (!context) {
      context = audioContextFactory();
    }

    if (!context) {
      return null;
    }

    if (context.state === "suspended" && typeof context.resume === "function") {
      await context.resume();
    }

    return context;
  }

  function stopSpinSound() {
    if (!spinSession || !context) {
      return;
    }

    const fadeOutEnds = context.currentTime + 0.12;
    spinSession.masterGain.gain.cancelScheduledValues(context.currentTime);
    spinSession.masterGain.gain.setValueAtTime(spinSession.masterGain.gain.value, context.currentTime);
    spinSession.masterGain.gain.linearRampToValueAtTime(0.0001, fadeOutEnds);

    safeStopNode(spinSession.modulator, fadeOutEnds + 0.02);
    safeStopNode(spinSession.oscA, fadeOutEnds + 0.02);
    safeStopNode(spinSession.oscB, fadeOutEnds + 0.02);
    safeStopNode(spinSession.oscC, fadeOutEnds + 0.02);

    spinSession = null;
  }

  async function startSpinSound() {
    try {
      const audioContext = await ensureRunningContext();
      if (!audioContext) {
        return;
      }

      stopSpinSound();

      const masterGain = audioContext.createGain();
      const highPass = audioContext.createBiquadFilter();
      const shimmer = audioContext.createBiquadFilter();
      const oscA = audioContext.createOscillator();
      const oscB = audioContext.createOscillator();
      const oscC = audioContext.createOscillator();
      const modulator = audioContext.createOscillator();
      const modulationDepth = audioContext.createGain();
      const shimmerDepth = audioContext.createGain();

      highPass.type = "highpass";
      highPass.frequency.value = 740;
      shimmer.type = "bandpass";
      shimmer.frequency.value = 1650;
      shimmer.Q.value = 4.8;

      oscA.type = "triangle";
      oscA.frequency.value = 520;

      oscB.type = "square";
      oscB.frequency.value = 880;
      oscB.detune.value = -6;

      oscC.type = "sawtooth";
      oscC.frequency.value = 1370;
      oscC.detune.value = 9;

      modulator.type = "sine";
      modulator.frequency.value = 19;
      modulationDepth.gain.value = 11;
      shimmerDepth.gain.value = 180;

      masterGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      masterGain.gain.linearRampToValueAtTime(0.05, audioContext.currentTime + 0.05);

      modulator.connect(modulationDepth);
      modulator.connect(shimmerDepth);
      modulationDepth.connect(oscB.detune);
      modulationDepth.connect(oscC.detune);
      shimmerDepth.connect(shimmer.frequency);

      oscA.connect(highPass);
      oscB.connect(highPass);
      oscC.connect(highPass);
      highPass.connect(shimmer);
      shimmer.connect(masterGain);
      masterGain.connect(audioContext.destination);

      oscA.start();
      oscB.start();
      oscC.start();
      modulator.start();

      spinSession = {
        masterGain,
        oscA,
        oscB,
        oscC,
        modulator
      };
    } catch {
      // Silent fallback on browsers with strict autoplay restrictions.
    }
  }

  async function playLandingSound(side) {
    if (!isValidSide(side)) {
      return;
    }

    try {
      const audioContext = await ensureRunningContext();
      if (!audioContext) {
        return;
      }

      const primaryOsc = audioContext.createOscillator();
      const ringOsc = audioContext.createOscillator();
      const sparkleOsc = audioContext.createOscillator();
      const primaryGain = audioContext.createGain();
      const ringGain = audioContext.createGain();
      const sparkleGain = audioContext.createGain();
      const mixGain = audioContext.createGain();
      const highPass = audioContext.createBiquadFilter();
      const resonator = audioContext.createBiquadFilter();

      const now = audioContext.currentTime;
      const basePitch = side === CoinSide.HEADS ? 910 : 820;

      primaryOsc.type = "triangle";
      primaryOsc.frequency.setValueAtTime(basePitch, now);
      primaryOsc.frequency.exponentialRampToValueAtTime(basePitch * 0.61, now + 0.2);

      ringOsc.type = "sine";
      ringOsc.frequency.setValueAtTime(basePitch * 1.49, now);
      ringOsc.frequency.exponentialRampToValueAtTime(basePitch * 1.08, now + 0.29);

      sparkleOsc.type = "square";
      sparkleOsc.frequency.setValueAtTime(basePitch * 2.31, now);
      sparkleOsc.frequency.exponentialRampToValueAtTime(basePitch * 1.64, now + 0.18);

      highPass.type = "highpass";
      highPass.frequency.value = 200;
      resonator.type = "bandpass";
      resonator.frequency.value = 1280;
      resonator.Q.value = 3.8;

      primaryGain.gain.setValueAtTime(0.0001, now);
      primaryGain.gain.linearRampToValueAtTime(0.11, now + 0.004);
      primaryGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.21);

      ringGain.gain.setValueAtTime(0.0001, now);
      ringGain.gain.linearRampToValueAtTime(0.09, now + 0.008);
      ringGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.31);

      sparkleGain.gain.setValueAtTime(0.0001, now);
      sparkleGain.gain.linearRampToValueAtTime(0.045, now + 0.004);
      sparkleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

      mixGain.gain.setValueAtTime(0.95, now);
      mixGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

      primaryOsc.connect(primaryGain);
      ringOsc.connect(ringGain);
      sparkleOsc.connect(sparkleGain);
      primaryGain.connect(highPass);
      ringGain.connect(highPass);
      sparkleGain.connect(highPass);
      highPass.connect(resonator);
      resonator.connect(mixGain);
      mixGain.connect(audioContext.destination);

      primaryOsc.start(now);
      ringOsc.start(now);
      sparkleOsc.start(now);
      safeStopNode(primaryOsc, now + 0.36);
      safeStopNode(ringOsc, now + 0.36);
      safeStopNode(sparkleOsc, now + 0.24);
    } catch {
      // Silent fallback is intentional.
    }
  }

  return {
    startSpinSound,
    stopSpinSound,
    playLandingSound
  };
}

function waitForCoinTransition(coinElement, durationMs) {
  return new Promise((resolve) => {
    let isDone = false;

    const finish = () => {
      if (isDone) {
        return;
      }

      isDone = true;
      coinElement.removeEventListener("transitionend", onTransitionEnd);
      clearTimeout(timeoutId);
      resolve();
    };

    const onTransitionEnd = (event) => {
      if (event.target === coinElement && event.propertyName === "transform") {
        finish();
      }
    };

    const timeoutId = setTimeout(finish, durationMs + 100);

    coinElement.addEventListener("transitionend", onTransitionEnd);
  });
}

function setResultText(resultElement, message, isFlipping = false) {
  resultElement.textContent = message;
  resultElement.classList.toggle("is-flipping", isFlipping);
}

function setOutcomeText(outcomeElement, message, isFlipping = false) {
  if (!outcomeElement) {
    return;
  }

  outcomeElement.textContent = message;
  outcomeElement.classList.toggle("is-flipping", isFlipping);
}

function applyCoinTransform(coinElement, rotationDeg, durationMs) {
  coinElement.style.transition = `transform ${durationMs}ms cubic-bezier(.2,.8,.2,1)`;
  coinElement.style.transform = `rotateY(${rotationDeg}deg)`;
}

export function createCoinController({
  coinElement,
  buttonElement,
  spinButtonElement = null,
  resultElement,
  outcomeElement = null,
  audioController = createSilentAudioController(),
  randomFn = Math.random,
  transitionWaiter = waitForCoinTransition,
  prefersReducedMotion = false
}) {
  let state = DEFAULT_STATE;

  function getState() {
    return state;
  }

  function setBusyUI(isBusy) {
    buttonElement.disabled = isBusy;
    buttonElement.setAttribute("aria-busy", String(isBusy));

    if (spinButtonElement) {
      spinButtonElement.disabled = isBusy;
      spinButtonElement.setAttribute("aria-busy", String(isBusy));
    }
  }

  async function runFlip() {
    if (state.isFlipping) {
      return state.lastResult;
    }

    const selectedSide = chooseSide(deriveRandomBit(randomFn()));
    const flipConfig = prefersReducedMotion
      ? createReducedMotionFlipConfig(selectedSide)
      : createFlipConfig(selectedSide, randomFn);

    const targetRotationDeg = resolveTargetRotation(
      state.currentRotationDeg,
      flipConfig.totalRotationDeg,
      selectedSide
    );

    state = withNextState(state, {
      isFlipping: true,
      currentRotationDeg: targetRotationDeg
    });

    setBusyUI(true);
    setResultText(resultElement, "Girando...", true);
    setOutcomeText(outcomeElement, "Girando moeda...", true);

    await audioController.startSpinSound();

    applyCoinTransform(coinElement, targetRotationDeg, flipConfig.durationMs);
    await transitionWaiter(coinElement, flipConfig.durationMs);

    audioController.stopSpinSound();
    await audioController.playLandingSound(selectedSide);

    const finalLabel = selectedSide === CoinSide.HEADS ? "Resultado: Cara" : "Resultado: Coroa";
    const outcomeLabel = selectedSide === CoinSide.HEADS ? "Deu Cara" : "Deu Coroa";

    state = withNextState(state, {
      isFlipping: false,
      lastResult: selectedSide,
      flipCount: state.flipCount + 1
    });

    setResultText(resultElement, finalLabel, false);
    setOutcomeText(outcomeElement, outcomeLabel, false);
    setBusyUI(false);

    return selectedSide;
  }

  function destroy() {
    audioController.stopSpinSound();
  }

  return {
    getState,
    runFlip,
    destroy
  };
}

export function preloadCoinImages(imageSources = []) {
  const preloadJobs = imageSources.map(
    (source) =>
      new Promise((resolve) => {
        const image = new Image();
        image.src = source;
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
      })
  );

  return Promise.all(preloadJobs);
}

function registerInstallableWebApp(windowRef = window, navigatorRef = navigator) {
  const isHttpProtocol =
    windowRef?.location?.protocol === "http:" || windowRef?.location?.protocol === "https:";

  if (!isHttpProtocol) {
    return;
  }

  if (!("serviceWorker" in navigatorRef)) {
    return;
  }

  navigatorRef.serviceWorker.register("./service-worker.js").catch(() => {
    // Ignore registration failures to keep app usable without PWA features.
  });
}

export function initLuckyCoin(
  documentRef = document,
  windowRef = window,
  navigatorRef = globalThis.navigator
) {
  const coinElement = documentRef.getElementById("coin");
  const buttonElement = documentRef.getElementById("coin-button");
  const spinButtonElement = documentRef.getElementById("spin-button");
  const resultElement = documentRef.getElementById("result");
  const outcomeElement = documentRef.getElementById("coin-outcome");

  if (!coinElement || !buttonElement || !resultElement) {
    throw new Error("Lucky Coin: required DOM elements not found");
  }

  void preloadCoinImages(["./assets/cara.png", "./assets/coroa.png"]);

  const prefersReducedMotion =
    typeof windowRef.matchMedia === "function" &&
    windowRef.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const controller = createCoinController({
    coinElement,
    buttonElement,
    spinButtonElement,
    resultElement,
    outcomeElement,
    audioController: createAudioController(),
    prefersReducedMotion
  });

  registerInstallableWebApp(windowRef, navigatorRef);

  const onInteract = async (event) => {
    if (event.type === "keydown") {
      const keyboardEvent = event;
      if (keyboardEvent.key !== "Enter" && keyboardEvent.key !== " ") {
        return;
      }
      keyboardEvent.preventDefault();
    }

    await controller.runFlip();
  };

  buttonElement.addEventListener("click", onInteract);
  buttonElement.addEventListener("keydown", onInteract);
  spinButtonElement?.addEventListener("click", onInteract);

  return {
    dispose() {
      buttonElement.removeEventListener("click", onInteract);
      buttonElement.removeEventListener("keydown", onInteract);
      spinButtonElement?.removeEventListener("click", onInteract);
      controller.destroy();
    },
    controller
  };
}

if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  document.getElementById("coin-button")
) {
  initLuckyCoin(document, window);
}
