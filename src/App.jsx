import React from "react";
import { Link, Route, Routes } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Nes from "./pages/Nes.jsx";

export default function App() {
  return (
    <div className="container">
      <header className="header">
        <div>
          <h1>Retro Arcade Web</h1>
          <p className="subtle">Browser emulators • Bring your own ROM • No ROM hosting</p>
        </div>
        <nav className="nav">
          <Link to="/">Home</Link>
          <Link to="/nes">NES</Link>
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/nes" element={<Nes />} />
      </Routes>

      <footer className="footer subtle">
        Only upload ROMs you legally own or have permission to use.
      </footer>
    </div>
  );
}
