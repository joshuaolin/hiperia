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
          "Players select 2 digits from 1 to 22",
          "Each ticket costs 0.0072 SOL",
          "Draws occur daily at 2:00, and 4:00 PM (UTC+8)",
          "Offering 2 chances to win per ticket",
          "We use open-source RNG",
          "Check results after daily draw",
          "Winnings automatically credited instantly",
        ],
      },
      {
        title: "Prizes",
        items: [
          "Match both digits in exact order to win 1 SOL",
          "Prizes automatically credited to player's wallet instantly",
        ],
      },
    ],
  },
{
  id: 2,
  name: "FRUIT GAME [DEC 2025]",
  description: [
    {
      title: "How to Play",
      items: [
        "Players pick 3 fruits",
        "Fruits include 🍑 Peach, 🥭 Mango, 🍎 Apple, 🍌 Banana, 🍒 Cherry, 🍉 Watermelon, 🍍 Pineapple, 🍇 Grapes, 🍓 Strawberry, 🍋 Lemon",
        "Each ticket costs 0.005 SOL",
        "Draw occurs daily at 3:00 PM (UTC+8)",
        "Match order matters – you must match all digits in the correct sequence",
        "Check results after the daily draw",
        "Winnings are automatically credited instantly",
      ],
    },
    {
      title: "Prizes",
      items: [
        "Match all 3 fruits in exact order to win 2.5 SOL",
        "Match the last 2 fruits in exact order to win 0.25 SOL",
        "Match the first fruit only to win 0.05 SOL",
      ],
    },
  ],
},
{
  id: 3,
  name: "ALICE IN WONDERLAND [Q1 2026]",
  description: [
    {
      title: "How to Play",
      items: [
        "Pick 4 cards in exact order",
        "Suits include ♥️ Hearts, ♠️ Spades, ♣️ Clubs, ♦️ Diamonds",
        "Each ticket costs 0.001 SOL",
        "Draw occurs daily at 5:00 PM (UTC+8)",
        "Match order matters – all 4 must be in exact sequence to hit the jackpot",
        "Winnings are automatically credited instantly",
      ],
    },
    {
      title: "Prizes",
      items: [
        "Match all 4 cards in exact order to win 5 SOL",
        "Match last 3 cards in exact order to win 0.1 SOL",
        "Match last 2 cards in exact order to win 0.01 SOL",
      ],
    },
  ],
},
{
  id: 4,
  name: "ASIAN TREASURE [TBA]",
  description: [
    {
      title: "How to Play",
      items: [
        "Players select 5 numbers from 1 to 35",
        "Each ticket costs 0.005 SOL",
        "Draw occurs daily at 6:00 PM (UTC+8)",
        "Winning combination is drawn randomly",
        "Order does not matter – any 5 matching numbers win",
        "If no winner, the jackpot rolls over and grows for the next draw",
        "A portion of every ticket sold is added to the pot",
        "Check results after the daily draw",
        "Winnings are automatically credited instantly",
      ],
    },
    {
      title: "Prizes",
      items: [
        "Match all 5 numbers to win the Progressive Jackpot Pot",
        "Jackpot starts at 5 SOL and grows daily until won",
        "Prizes are credited directly to the player's wallet",
      ],
    },
  ],
},
  {
    id: 5,
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