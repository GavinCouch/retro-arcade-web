import React, { useEffect, useRef, useState } from "react";
import * as jsnes from "jsnes";

const W = 256;
const H = 240;

// If colors look weird, flip this to false.
const USE_ABGR = true;

// Key mapping (Player 1)
const KEYMAP = {
  KeyW: "UP",
  KeyS: "DOWN",
  KeyA: "LEFT",
  KeyD: "RIGHT",
  KeyJ: "A",
  KeyK: "B",
  Enter: "START",
  Space: "SELECT"
};

// ---- Save-state settings ----
const SAVE_VERSION = 1;
const AUTOSAVE_EVERY_MS = 20_000; // 20s
const LS_PREFIX = "retro-arcade-web:nes";

function djb2Hash(str) {
  // Small, fast hash for localStorage keys (not crypto)
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  // Convert to unsigned hex
  return (h >>> 0).toString(16);
}

function nowIso() {
  return new Date().toISOString();
}

export default function NesPlayer() {
  const canvasRef = useRef(null);
  const surfaceRef = useRef(null);

  const rafRef = useRef(null);
  const runningRef = useRef(false);

  const nesRef = useRef(null);

  // Store the last loaded ROM so Reset can cold-boot it
  const romBinRef = useRef(null);
  const romNameRef = useRef("");

  // Stable key for save states per ROM
  const romKeyRef = useRef(null);

  // ---- Audio (Safari-safe) ----
  const audioCtxRef = useRef(null);
  const audioNodeRef = useRef(null);
  const audioQRef = useRef([]); // interleaved L,R float samples

  // Autosave timer
  const autosaveTimerRef = useRef(null);

  const [status, setStatus] = useState("Upload a .nes ROM to start.");
  const [loadedName, setLoadedName] = useState("");
  const [hasSave, setHasSave] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);

  function ensureAudio() {
    // Safari requires audio to be created/resumed from a user gesture.
    if (audioCtxRef.current) {
      audioCtxRef.current.resume?.();
      return;
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      setStatus("AudioContext not supported in this browser.");
      return;
    }

    const ctx = new AudioContext();
    audioCtxRef.current = ctx;

    // ScriptProcessorNode is deprecated but still the simplest Safari-compatible option.
    const bufferSize = 1024;
    const node = ctx.createScriptProcessor(bufferSize, 0, 2);

    node.onaudioprocess = (e) => {
      const outL = e.outputBuffer.getChannelData(0);
      const outR = e.outputBuffer.getChannelData(1);
      const q = audioQRef.current;

      for (let i = 0; i < outL.length; i++) {
        if (q.length >= 2) {
          outL[i] = q.shift();
          outR[i] = q.shift();
        } else {
          outL[i] = 0;
          outR[i] = 0;
        }
      }
    };

    node.connect(ctx.destination);
    audioNodeRef.current = node;
  }

  function createNES() {
    return new jsnes.NES({
      onFrame(frameBuffer) {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const img = ctx.getImageData(0, 0, W, H);
        const data = img.data;

        for (let i = 0; i < frameBuffer.length; i++) {
          const p = frameBuffer[i];
          const idx = i * 4;

          if (USE_ABGR) {
            // ABGR -> RGBA
            data[idx + 0] = p & 0xff; // R
            data[idx + 1] = (p >> 8) & 0xff; // G
            data[idx + 2] = (p >> 16) & 0xff; // B
          } else {
            // AARRGGBB -> RGBA
            data[idx + 0] = (p >> 16) & 0xff; // R
            data[idx + 1] = (p >> 8) & 0xff; // G
            data[idx + 2] = p & 0xff; // B
          }

          data[idx + 3] = 0xff;
        }

        ctx.putImageData(img, 0, 0);
      },

      onAudioSample(l, r) {
        const q = audioQRef.current;
        q.push(l, r);

        // Cap queue to ~1 second of stereo at 44.1kHz to avoid runaway memory.
        const max = 44100 * 2;
        if (q.length > max) q.splice(0, q.length - max);
      }
    });
  }

  function getSaveStorageKey() {
    if (!romKeyRef.current) return null;
    return `${LS_PREFIX}:savestate:v${SAVE_VERSION}:${romKeyRef.current}`;
  }

  function refreshSaveIndicators() {
    const key = getSaveStorageKey();
    if (!key) {
      setHasSave(false);
      setLastSavedAt(null);
      return;
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        setHasSave(false);
        setLastSavedAt(null);
        return;
      }
      const parsed = JSON.parse(raw);
      setHasSave(true);
      setLastSavedAt(parsed?.meta?.savedAt || null);
    } catch {
      setHasSave(false);
      setLastSavedAt(null);
    }
  }

  function exportState(nesInstance) {
    // Try multiple common APIs across jsnes builds
    if (!nesInstance) return null;

    if (typeof nesInstance.toJSON === "function") return nesInstance.toJSON();
    if (typeof nesInstance.serialize === "function") return nesInstance.serialize();
    if (typeof nesInstance.saveState === "function") return nesInstance.saveState();

    // Some builds may expose a JSON snapshot method under different names
    if (typeof nesInstance.getState === "function") return nesInstance.getState();

    throw new Error("This jsnes build does not expose a save-state API.");
  }

  function importState(nesInstance, state) {
    if (!nesInstance) return;

    if (typeof nesInstance.fromJSON === "function") {
      nesInstance.fromJSON(state);
      return;
    }
    if (typeof nesInstance.deserialize === "function") {
      nesInstance.deserialize(state);
      return;
    }
    if (typeof nesInstance.loadState === "function") {
      nesInstance.loadState(state);
      return;
    }
    if (typeof nesInstance.setState === "function") {
      nesInstance.setState(state);
      return;
    }

    throw new Error("This jsnes build does not expose a load-state API.");
  }

  function saveStateToLocalStorage({ silent = false } = {}) {
    const key = getSaveStorageKey();
    if (!key) {
      if (!silent) setStatus("Load a ROM before saving.");
      return false;
    }
    const n = nesRef.current;
    if (!n) return false;

    try {
      const state = exportState(n);
      const payload = {
        meta: {
          version: SAVE_VERSION,
          romName: romNameRef.current || loadedName,
          romKey: romKeyRef.current,
          savedAt: nowIso()
        },
        state
      };
      localStorage.setItem(key, JSON.stringify(payload));
      setHasSave(true);
      setLastSavedAt(payload.meta.savedAt);
      if (!silent) setStatus(`Saved state (${new Date(payload.meta.savedAt).toLocaleString()})`);
      return true;
    } catch (e) {
      if (!silent) setStatus(`Save failed: ${String(e?.message || e)}`);
      return false;
    }
  }

  function loadStateFromLocalStorage() {
    const key = getSaveStorageKey();
    if (!key) {
      setStatus("Load a ROM before loading a save.");
      return;
    }
    const raw = localStorage.getItem(key);
    if (!raw) {
      setStatus("No save state found for this ROM.");
      return;
    }

    try {
      const payload = JSON.parse(raw);
      if (!payload?.state) {
        setStatus("Save state data is invalid.");
        return;
      }

      stop();

      // Cold boot NES, load ROM, then import state
      const fresh = createNES();
      fresh.loadROM(romBinRef.current);
      importState(fresh, payload.state);

      nesRef.current = fresh;

      // Clear queued audio so it doesn't smear
      audioQRef.current = [];

      setStatus(`Loaded save (${new Date(payload?.meta?.savedAt || Date.now()).toLocaleString()})`);
      drawOneFrame();
      surfaceRef.current?.focus?.();
    } catch (e) {
      setStatus(`Load failed: ${String(e?.message || e)}`);
    }
  }

  function deleteStateFromLocalStorage() {
    const key = getSaveStorageKey();
    if (!key) return;

    try {
      localStorage.removeItem(key);
      setHasSave(false);
      setLastSavedAt(null);
      setStatus("Deleted save state for this ROM.");
    } catch (e) {
      setStatus(`Delete failed: ${String(e?.message || e)}`);
    }
  }

  function startAutosaveTimer() {
    stopAutosaveTimer();
    autosaveTimerRef.current = window.setInterval(() => {
      // Only autosave if a ROM is loaded; keep it silent.
      if (romBinRef.current && romKeyRef.current) saveStateToLocalStorage({ silent: true });
    }, AUTOSAVE_EVERY_MS);
  }

  function stopAutosaveTimer() {
    if (autosaveTimerRef.current) {
      clearInterval(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }

  useEffect(() => {
    // Initialize emulator instance
    nesRef.current = createNES();

    // Init canvas
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d");
      ctx.fillRect(0, 0, W, H);
    }

    const down = (e) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      press(k, true);
    };

    const up = (e) => {
      const k = KEYMAP[e.code];
      if (!k) return;
      e.preventDefault();
      press(k, false);
    };

    const beforeUnload = () => {
      // Attempt a last-second silent autosave
      try {
        if (romBinRef.current && romKeyRef.current) saveStateToLocalStorage({ silent: true });
      } catch {
        // ignore
      }
    };

    // Capture mode is more reliable on Safari.
    document.addEventListener("keydown", down, true);
    document.addEventListener("keyup", up, true);
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      document.removeEventListener("keydown", down, true);
      document.removeEventListener("keyup", up, true);
      window.removeEventListener("beforeunload", beforeUnload);

      stop();
      stopAutosaveTimer();

      try {
        audioNodeRef.current?.disconnect();
      } catch {}
      try {
        audioCtxRef.current?.close();
      } catch {}

      audioNodeRef.current = null;
      audioCtxRef.current = null;
      audioQRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function press(key, isDown) {
    const n = nesRef.current;
    if (!n) return;

    const buttonMap = {
      A: jsnes.Controller.BUTTON_A,
      B: jsnes.Controller.BUTTON_B,
      SELECT: jsnes.Controller.BUTTON_SELECT,
      START: jsnes.Controller.BUTTON_START,
      UP: jsnes.Controller.BUTTON_UP,
      DOWN: jsnes.Controller.BUTTON_DOWN,
      LEFT: jsnes.Controller.BUTTON_LEFT,
      RIGHT: jsnes.Controller.BUTTON_RIGHT
    };

    const btn = buttonMap[key];
    if (btn == null) return;

    // Try common jsnes shapes, in order.
    const attempts = [
      () => {
        const c = n.controllers?.[0];
        if (!c) return false;
        if (isDown) c.buttonDown(btn);
        else c.buttonUp(btn);
        return true;
      },
      () => {
        const c = n.controller1;
        if (!c) return false;
        if (isDown) c.buttonDown(btn);
        else c.buttonUp(btn);
        return true;
      },
      () => {
        if (typeof n.buttonDown !== "function" || typeof n.buttonUp !== "function") return false;
        if (isDown) n.buttonDown(0, btn);
        else n.buttonUp(0, btn);
        return true;
      },
      () => {
        if (typeof n.buttonDown !== "function" || typeof n.buttonUp !== "function") return false;
        if (isDown) n.buttonDown(1, btn);
        else n.buttonUp(1, btn);
        return true;
      }
    ];

    for (const fn of attempts) {
      try {
        if (fn()) return;
      } catch {
        // try next
      }
    }
  }

  async function loadRom(file) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".nes")) {
      setStatus("Please select a .nes ROM file.");
      return;
    }

    setStatus("Loading ROM…");
    setLoadedName("");

    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);

    // jsnes expects a binary string
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);

    try {
      // Save ROM so Reset/Load Save can reload it
      romBinRef.current = bin;
      romNameRef.current = file.name;

      // Build a stable-ish rom key from name + length + small hash
      romKeyRef.current = `${file.name}:${bin.length}:${djb2Hash(bin.slice(0, 20000))}`;

      // Load into current emulator
      nesRef.current = createNES();
      nesRef.current.loadROM(bin);

      setLoadedName(file.name);
      setStatus("Loaded. Click Play (audio starts on Play).");

      document.activeElement?.blur?.();
      surfaceRef.current?.focus?.();

      // Reset audio queue and timers for new ROM
      audioQRef.current = [];
      startAutosaveTimer();

      stop();
      drawOneFrame();

      // If a save exists, offer to load it
      refreshSaveIndicators();
      const key = getSaveStorageKey();
      const has = key ? !!localStorage.getItem(key) : false;
      if (has) {
        setStatus("Save found for this ROM. Click “Load Save” to continue.");
      }
    } catch (e) {
      setStatus(`Failed to load ROM: ${String(e?.message || e)}`);
    }
  }

  function drawOneFrame() {
    try {
      nesRef.current?.frame();
    } catch {
      // ignore
    }
  }

  function loop() {
    if (!runningRef.current) return;
    nesRef.current?.frame();
    rafRef.current = requestAnimationFrame(loop);
  }

  function play() {
    surfaceRef.current?.focus?.();

    if (!loadedName) {
      setStatus("Load a ROM first.");
      return;
    }

    // Must be called from user gesture to unlock audio in Safari
    ensureAudio();

    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Playing… (Press Enter = Start)");
    rafRef.current = requestAnimationFrame(loop);
  }

  function stop() {
    runningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function reset() {
    if (!romBinRef.current) {
      setStatus("No ROM loaded to reset.");
      return;
    }

    stop();

    // Cold-boot: brand-new emulator instance
    nesRef.current = createNES();

    // Clear queued audio so it doesn't smear across reset
    audioQRef.current = [];

    // Reload the ROM into the new instance
    nesRef.current.loadROM(romBinRef.current);

    setLoadedName(romNameRef.current || loadedName);
    setStatus("Reset complete. Click Play to start fresh.");
    drawOneFrame();

    surfaceRef.current?.focus?.();
  }

  // Optional test buttons (kept from earlier debugging)
  function tapStartTest() {
    press("START", true);
    press("START", false);
  }

  function holdRightDown() {
    press("RIGHT", true);
  }

  function holdRightUp() {
    press("RIGHT", false);
  }

  const prettyLastSaved = lastSavedAt ? new Date(lastSavedAt).toLocaleString() : null;

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div className="subtle">
        Controls: WASD = D-pad • J = A • K = B • Enter = Start • Space = Select
      </div>

      <input type="file" accept=".nes" onChange={(e) => loadRom(e.target.files?.[0])} />

      <div className="row" style={{ justifyContent: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <button className="btn" onClick={play}>
          Play
        </button>
        <button className="btn ghost" onClick={stop}>
          Pause
        </button>
        <button className="btn ghost" onClick={reset} disabled={!loadedName}>
          Reset
        </button>

        <button
          className="btn"
          onClick={() => saveStateToLocalStorage({ silent: false })}
          disabled={!loadedName}
          title={!loadedName ? "Load a ROM first" : "Save your progress to this browser"}
        >
          Save State
        </button>

        <button
          className="btn"
          onClick={loadStateFromLocalStorage}
          disabled={!loadedName || !hasSave}
          title={!hasSave ? "No save found for this ROM" : "Load your saved progress"}
        >
          Load Save
        </button>

        <button
          className="btn ghost"
          onClick={deleteStateFromLocalStorage}
          disabled={!loadedName || !hasSave}
          title={!hasSave ? "No save found for this ROM" : "Delete saved progress for this ROM"}
        >
          Delete Save
        </button>

        <button className="btn ghost" onMouseDown={holdRightDown} onMouseUp={holdRightUp}>
          Hold Right (test)
        </button>

        <button className="btn ghost" onClick={tapStartTest}>
          Tap Start (test)
        </button>

        <div className="subtle" style={{ marginLeft: "auto", display: "grid", gap: 2 }}>
          <div>{loadedName ? `Loaded: ${loadedName}` : "No ROM loaded"}</div>
          <div>{hasSave ? `Save: ${prettyLastSaved || "yes"}` : "Save: none"}</div>
        </div>
      </div>

      <div
        ref={surfaceRef}
        tabIndex={0}
        style={{ outline: "none", display: "grid", justifyItems: "start" }}
      >
        <canvas
          ref={canvasRef}
          style={{
            width: 512,
            height: 480,
            imageRendering: "pixelated",
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "black"
          }}
        />
      </div>

      <div className="subtle">{status}</div>

      <div className="subtle" style={{ lineHeight: 1.4 }}>
        Save states are stored locally in your browser (localStorage). If you clear site data, your saves are removed.
        Autosave runs every {Math.round(AUTOSAVE_EVERY_MS / 1000)}s while a ROM is loaded.
      </div>
    </div>
  );
}

