import React from "react";

export default function Ticker() {
  return (
    <main role="main" className="main">
      <div className="ticker" aria-live="polite">
        <span className="ticker-text">COMING SOON... (12.12.25)</span>
      </div>
    </main>
  );
}