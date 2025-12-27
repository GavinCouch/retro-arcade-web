import React from "react";
import NesPlayer from "../emulators/nes/NesPlayer.jsx";

export default function Nes() {
  return (
    <div className="stack">
      <div className="card">
        <h2>NES (BYO ROM)</h2>
        <p className="subtle">
          We do not provide ROMs. Only upload ROM files you legally own or have permission to use.
        </p>
      </div>
      <NesPlayer />
    </div>
  );
}
