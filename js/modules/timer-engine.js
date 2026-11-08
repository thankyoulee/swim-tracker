import { formatTime, parseTime } from "../utils/time-parser.js";

const WINDOW_IDS = ["A", "B"];

/**
 * 挂载池边双窗倒计时器。
 * A 窗用于包干计时，B 窗用于固定间歇；B 可设置循环间歇。
 */
export function mountTimer(container) {
  container._destroyTimer?.();
  container.replaceChildren();

  const timers = {
    A: createTimerState(30),
    B: createTimerState(30),
  };
  let audioContext = null;
  let animationFrame = null;

  const grid = document.createElement("div");
  grid.className = "timer-grid";
  const controls = {};

  WINDOW_IDS.forEach((id) => {
    const isInterval = id === "B";
    const panel = document.createElement("section");
    panel.className = "timer";
    panel.dataset.windowId = id;
    panel.innerHTML = `
      <div class="timer-title"><b>${id} 窗 · ${isInterval ? "间歇" : "包干"}倒计时</b></div>
      <output class="clock" aria-live="polite">${formatTime(timers[id].remainingSeconds)}</output>
      <label class="field">设定时间（支持 45、1:30、1.30）
        <input class="timer-input" type="text" inputmode="decimal" value="30" aria-label="${id} 窗设定时间">
      </label>
      ${isInterval ? `<label class="timer-loop"><input type="checkbox"> 循环间歇</label>` : ""}
      <div class="timer-actions">
        <button type="button" data-action="start">启动</button>
        <button type="button" data-action="pause" disabled>暂停</button>
        <button type="button" data-action="reset">重置</button>
      </div>`;

    const input = panel.querySelector(".timer-input");
    const loopInput = panel.querySelector(".timer-loop input");
    const output = panel.querySelector(".clock");
    const startButton = panel.querySelector('[data-action="start"]');
    const pauseButton = panel.querySelector('[data-action="pause"]');
    const resetButton = panel.querySelector('[data-action="reset"]');
    controls[id] = { input, loopInput, output, startButton, pauseButton, resetButton };

    input.addEventListener("change", () => {
      const seconds = parseTime(input.value);
      if (!Number.isFinite(seconds) || seconds < 0) {
        input.value = formatTime(timers[id].configuredSeconds);
        return;
      }
      timers[id].configuredSeconds = seconds;
      if (!timers[id].running) timers[id].remainingSeconds = seconds;
      refreshWindow(id);
    });
    startButton.addEventListener("click", () => start(id));
    pauseButton.addEventListener("click", () => pause(id));
    resetButton.addEventListener("click", () => reset(id));
    grid.append(panel);
  });
  container.append(grid);

  function createTimerState(initialSeconds) {
    return {
      configuredSeconds: initialSeconds,
      remainingSeconds: initialSeconds,
      running: false,
      endsAt: 0,
    };
  }

  function refreshWindow(id) {
    const state = timers[id];
    const { input, loopInput, output, startButton, pauseButton } = controls[id];
    output.value = formatTime(state.remainingSeconds);
    output.textContent = formatTime(state.remainingSeconds);
    if (!state.running) input.value = input.value || String(state.configuredSeconds);
    if (loopInput) state.loop = loopInput.checked;
    startButton.disabled = state.running || state.remainingSeconds <= 0;
    pauseButton.disabled = !state.running;
  }

  function start(id) {
    const state = timers[id];
    const seconds = parseTime(controls[id].input.value);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    if (state.remainingSeconds <= 0) state.remainingSeconds = seconds;
    state.configuredSeconds = seconds;
    state.endsAt = performance.now() + state.remainingSeconds * 1000;
    state.running = true;
    enableAudio();
    refreshWindow(id);
    scheduleTick();
  }

  function pause(id) {
    const state = timers[id];
    if (!state.running) return;
    state.remainingSeconds = Math.max(0, Math.ceil((state.endsAt - performance.now()) / 1000));
    state.running = false;
    refreshWindow(id);
  }

  function reset(id) {
    const state = timers[id];
    state.running = false;
    state.remainingSeconds = state.configuredSeconds;
    refreshWindow(id);
  }

  function scheduleTick() {
    if (animationFrame === null) animationFrame = requestAnimationFrame(tick);
  }

  function tick() {
    animationFrame = null;
    let anyRunning = false;
    for (const id of WINDOW_IDS) {
      const state = timers[id];
      if (!state.running) continue;
      anyRunning = true;
      state.remainingSeconds = Math.max(0, Math.ceil((state.endsAt - performance.now()) / 1000));
      if (state.remainingSeconds === 0) {
        finish(id);
      }
      refreshWindow(id);
    }
    if (anyRunning || WINDOW_IDS.some((id) => timers[id].running)) scheduleTick();
  }

  function finish(id) {
    const state = timers[id];
    notifyEnd();
    if (id === "B" && controls.B.loopInput?.checked && state.configuredSeconds > 0) {
      state.remainingSeconds = state.configuredSeconds;
      state.endsAt = performance.now() + state.configuredSeconds * 1000;
      state.running = true;
      return;
    }
    state.running = false;
  }

  function enableAudio() {
    if (!globalThis.AudioContext && !globalThis.webkitAudioContext) return;
    if (!audioContext) {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      audioContext = new Context();
    }
    if (audioContext.state === "suspended") void audioContext.resume();
  }

  function notifyEnd() {
    navigator.vibrate?.([180, 80, 180]);
    try {
      enableAudio();
      if (!audioContext) return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(0.12, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.28);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.28);
    } catch (error) {
      console.warn("无法播放计时提示音", error);
    }
  }

  function configureInterval(value) {
    const seconds = parseTime(value);
    if (!Number.isFinite(seconds) || seconds < 0) return;
    const state = timers.B;
    state.configuredSeconds = seconds;
    state.remainingSeconds = seconds;
    state.running = false;
    controls.B.input.value = String(value);
    refreshWindow("B");
  }

  const onTimerOpen = (event) => configureInterval(event.detail);
  document.addEventListener("timer:open", onTimerOpen);
  WINDOW_IDS.forEach(refreshWindow);

  container._destroyTimer = () => {
    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
    document.removeEventListener("timer:open", onTimerOpen);
    audioContext?.close?.();
  };
}
