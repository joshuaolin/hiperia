import React, { useState } from "react";
import { motion } from "framer-motion";
import { useSwipeable } from "react-swipeable";
import "../index.css";

const games = [
  {
    id: 1,
    name: "DODOS [SOON - 12.12.25]",
    description: [
      {
        title: "How to Play",
        items: [
          "Connect Solana-compatible wallet to platform",
          "Players select 2 unique digits from 1 to 31 (no duplicates allowed)",
          "Each ticket costs 0.005 SOL, payable via Solana-compatible wallet",
          "Draws occur daily at 2:00 PM Asia time (UTC+8)",
          "Check results after daily draw",
          "Winnings automatically credited instantly"
        ]
      },
      {
        title: "Prizes",
        items: [
          "Exact Order: Match both digits in exact order to win 1.2 SOL",
          "Any Order: Match both digits in any order to win 0.6 SOL",
          "Prizes automatically credited to player's wallet instantly"
        ]
      },
      {
        title: "Airdrop Eligibility",
        items: [
          "Chance to win up to 2 SOL plus 50% of weekly donations",
          "More tickets purchased = higher airdrop win chances"
        ]
      }
    ]
  },
  { 
    id: 2, 
    name: "9 LITTLE INDIANS [TBA]", 
    description: "" 
  },
];

export default function GameCarousel() {
  const [current, setCurrent] = useState(0);

  const nextGame = () => setCurrent((prev) => (prev + 1) % games.length);
  const prevGame = () =>
    setCurrent((prev) => (prev - 1 + games.length) % games.length);

  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => nextGame(),
    onSwipedRight: () => prevGame(),
    preventDefaultTouchmoveEvent: true,
    trackMouse: true
  });

  return (
    <div className="carousel-container" {...swipeHandlers}>
      <motion.div
        key={games[current].id}
        initial={{ opacity: 0, x: 100 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -100 }}
        transition={{ duration: 0.5 }}
        className="game-card"
      >
        <h2 className="game-title">{games[current].name}</h2>
        
        {Array.isArray(games[current].description) ? (
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
        ) : (
          <p className="game-description">{games[current].description}</p>
        )}
      </motion.div>

      <button 
        className="carousel-btn prev-btn" 
        onClick={prevGame}
        aria-label="Previous game"
      >
        ⬅
      </button>
      <button 
        className="carousel-btn next-btn" 
        onClick={nextGame}
        aria-label="Next game"
      >
        ➡
      </button>

      <div className="mobile-indicators">
        {games.map((game, index) => (
          <span 
            key={game.id}
            className={`indicator-dot ${index === current ? 'active' : ''}`}
            onClick={() => setCurrent(index)}
          />
        ))}
      </div>
    </div>
  );
}