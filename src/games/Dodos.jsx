import React from "react";
import DonationContainer from "../components/DonationContainer";
import "../index.css";

export default function Dodos({ onBack }) {
  return (
    <div className="dodos-container">
      {/* Back button outside and above the container */}
      <div className="wallet-btn back-button-container">
        <button
          className="start-game-button wallet-adapter-button matrix-button"
          onClick={onBack}
          type="button"
          aria-label="Back to Game Carousel"
        >
          BACK TO GAMES
        </button>
      </div>

      {/* Donation Container */}
      <DonationContainer />
    </div>
  );
}