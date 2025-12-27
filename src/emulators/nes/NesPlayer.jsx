import React, { useEffect, useMemo, useRef, useState } from "react";
import { NES } from "jsnes";

const W = 256;
const H = 240;

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

export default function NesPlayer() {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const runningRef = useRef(false);
  const nesRef = useRef(null);

  const [status, setStatus] = useState("Upload a .nes ROM to start.");
  const [loadedName, setLoadedName] = useState("");

  const nes = useMemo(() => {
    return new NES({
      onFrame(frameBuffer) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const img = ctx.getImageData(0, 0, W, H);

        for (let i = 0; i < frameBuffer.length; i++) {
          const p = frameBuffer[i];
          const idx = i * 4;
          img.data[idx + 0] = (p >> 16) & 0xff;
          img.data[idx + 1] = (p >> 8) & 0xff;
          img.data[idx + 2] = p & 0xff;
          img.data[idx + 3] = 0xff;
        }
        ctx.putImageData(img, 0, 0);
      }
    });
  }, []);

  useEffect(() => {
    nesRef.current = nes;

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

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function press(key, isDown) {
    const n = nesRef.current;
    if (!n) return;

    // jsnes: buttons are (player, button)
    const p = 1;
    const map = {
      A: n.buttonDown.bind(n, p, n.BUTTON_A),
      B: n.buttonDown.bind(n, p, n.BUTTON_B),
      SELECT: n.buttonDown.bind(n, p, n.BUTTON_SELECT),
      START: n.buttonDown.bind(n, p, n.BUTTON_START),
      UP: n.buttonDown.bind(n, p, n.BUTTON_UP),
      DOWN: n.buttonDown.bind(n, p, n.BUTTON_DOWN),
      LEFT: n.buttonDown.bind(n, p, n.BUTTON_LEFT),
      RIGHT: n.buttonDown.bind(n, p, n.BUTTON_RIGHT)
    };

    const mapUp = {
      A: n.buttonUp.bind(n, p, n.BUTTON_A),
      B: n.buttonUp.bind(n, p, n.BUTTON_B),
      SELECT: n.buttonUp.bind(n, p, n.BUTTON_SELECT),
      START: n.buttonUp.bind(n, p, n.BUTTON_START),
      UP: n.buttonUp.bind(n, p, n.BUTTON_UP),
      DOWN: n.buttonUp.bind(n, p, n.BUTTON_DOWN),
      LEFT: n.buttonUp.bind(n, p, n.BUTTON_LEFT),
      RIGHT: n.buttonUp.bind(n, p, n.BUTTON_RIGHT)
    };

    (isDown ? map[key] : mapUp[key])?.();
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
      nesRef.current.loadROM(bin);
      setLoadedName(file.name);
      setStatus("Loaded. Click Play.");
      stop();
      drawOneFrame();
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
    if (!loadedName) {
      setStatus("Load a ROM first.");
      return;
    }
    if (runningRef.current) return;
    runningRef.current = true;
    setStatus("Playing…");
    rafRef.current = requestAnimationFrame(loop);
  }

  function stop() {
    runningRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }

  function reset() {
    stop();
    // Reloading ROM is simplest “reset”
    setStatus("Reset: reload the ROM to restart the game.");
  }

  return (
    <div className="card" style={{ display: "grid", gap: 12 }}>
      <div className="subtle">
        Controls: WASD = D-pad • J = A • K = B • Enter = Start • Space = Select
      </div>

      <input
        type="file"
        accept=".nes"
        onChange={(e) => loadRom(e.target.files?.[0])}
      />

      <div className="row" style={{ justifyContent: "flex-start", gap: 10 }}>
        <button className="btn" onClick={play}>Play</button>
        <button className="btn ghost" onClick={stop}>Pause</button>
        <button className="btn ghost" onClick={reset}>Reset</button>
        <div className="subtle" style={{ marginLeft: "auto" }}>
          {loadedName ? `Loaded: ${loadedName}` : "No ROM loaded"}
        </div>
      </div>

      <div style={{ display: "grid", justifyItems: "start" }}>
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
    </div>
  );
}
