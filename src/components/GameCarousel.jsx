import React, { useState } from "react";
import { motion } from "framer-motion";
import { useSwipeable } from "react-swipeable";
import DonationContainer from "./DonationContainer";
import "../styles/game-carousel.css";

const games = [
  {
    id: 1,
    name: "DODOS [OCT 2025]",
    description: [
      {
        title: "How to Play",
        items: [
          "Players select 2 unique digits from 1 to 31 (no duplicates allowed)",
          "Each ticket costs 0.005 SOL, payable via Solana-compatible wallet",
          "Draws occur daily at 2:00, 3:00, and 4:00 PM Asia time (UTC+8), using open-source RNG",
          "Offering three chances to win per ticket",
          "Check results after daily draw",
          "Winnings automatically credited instantly",
        ],
      },
      {
        title: "Prizes",
        items: [
          "Match both digits in exact order to win 1.2 SOL",
          "Prizes automatically credited to player's wallet instantly",
        ],
      },
    ],
  },
  {
    id: 2,
    name: "LEMON KICK [DEC 2025]",
    description: [
      {
        title: "How to Play",
        items: [
          "Choose a win probability from 5% to 60% (in 5% increments) and predict if the kick goes 'left' or 'right'",
          "Each ticket costs 0.005, payable via Solana-compatible wallet",
          "Draws occur instantly using open-source RNG",
          "Higher win probabilities yield smaller payouts, lower probabilities offer larger payouts",
          "Check results instantly after the kick",
        ],
      },
      {
        title: "Prizes",
        items: [
          "Payouts vary based on chosen win probability: e.g., 0.095 SOL for 5% win rate, 0.0075 SOL for 60% win rate",
          "Prizes automatically credited to player's wallet instantly",
        ],
      },
    ],
  },
  {
    id: 3,
    name: "FRUIT GAME [2026]",
    description: [
      {
        title: "How to Play",
        items: [
          "TBA"
        ],
      },
      {
        title: "Prizes",
        items: [
          "TBA"
        ],
      },
    ],
  },
  {
    id: 4,
    name: "SUPPORT HIPERIA",
    description: []
  }
];

export default function GameCarousel({ onEnterGame }) {
  const [current, setCurrent] = useState(0);

  const nextGame = () => setCurrent((prev) => (prev + 1) % games.length);
  const prevGame = () => setCurrent((prev) => (prev - 1 + games.length) % games.length);

  const swipeHandlers = useSwipeable({
    onSwipedLeft: nextGame,
    onSwipedRight: prevGame,
    preventDefaultTouchmoveEvent: true,
    trackMouse: true,
  });

  return (
    <div>
      <div className="carousel-container" {...swipeHandlers}>
        <motion.div
          key={games[current].id}
          initial={{ opacity: 0, x: 100 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -100 }}
          transition={{ duration: 0.5 }}
          className="game-card"
        >
          <h2 className="game-title">
            <span className="ticker-text hiperia-ticker-text">{games[current].name}</span>
          </h2>

          <div className="game-description">
            {games[current].description.map((section, sectionIndex) => (
              <div key={sectionIndex} className="description-section">
                <h3 className="section-title">{section.title}:</h3>
                <ul className="bullet-list">
                  {section.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {games[current].name.includes("DODOS") && (
            <div className="wallet-btn">
              <button
                className="matrix-button"
                onClick={() => onEnterGame("Dodos")}
                aria-label="Enter DODOS Game"
              >
                ENTER GAME
              </button>
            </div>
          )}

          {games[current].name.includes("SUPPORT") && <DonationContainer />}
        </motion.div>

        <button className="carousel-btn prev-btn" onClick={prevGame} aria-label="Previous game">
          ⬅
        </button>
        <button className="carousel-btn next-btn" onClick={nextGame} aria-label="Next game">
          ➡
        </button>

        <div className="mobile-indicators">
          {games.map((game, index) => (
            <span
              key={game.id}
              className={`indicator-dot ${index === current ? "active" : ""}`}
              onClick={() => setCurrent(index)}
              aria-label={`Go to game ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}