import React from "react";
import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="card">
      <h2>Emulators</h2>
      <p className="subtle">
        This site does not provide ROM files. You upload your own ROM locally and it runs in your browser.
      </p>

      <ul className="list">
        <li className="row">
          <div className="rowMain">
            <div className="rowTitle">Nintendo Entertainment System (NES)</div>
            <div className="subtle">Upload a .nes ROM • Keyboard controls • Canvas video</div>
          </div>
          <Link className="btn" to="/nes">Open</Link>
        </li>
      </ul>

      <p className="subtle" style={{ marginTop: 12 }}>
        More emulators coming soon (SNES, Game Boy, etc.).
      </p>
    </div>
  );
}
