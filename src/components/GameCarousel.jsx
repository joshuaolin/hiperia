import React, { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useSwipeable } from "react-swipeable";
import "../styles/game-carousel.css";

/** —— config —— **/
const WALLET_ADDRESS = "Ghxn7ree6MFQxC8hFTJ8Lo319xEZzqVFLcmDLKVFpPaa";
const WALLET_ADDRESS2 = "AJsbig6jgfZhHKL9LDQjFGNhuJ8qdEsqK2Hdh3YAL7rn";

/** —— small, self-contained copy component —— **/
const CopyWalletRow = React.memo(({ address, isCopied, onCopy }) => {
  return (
    <div className="copy-wallet-row" role="group" aria-label="wallet address">
      <div className="copy-wallet-text" title="wallet address">
        {address}
      </div>
      <button
        type="button"
        className="copy-wallet-btn"
        onClick={onCopy}
        aria-live="polite"
        aria-label="copy wallet address"
      >
        <span className="copy-icon" aria-hidden="true">{isCopied ? "✅" : "📋"}</span>
        {isCopied ? "Copied" : "Copy"}
      </button>
    </div>
  );
});

/** —— data —— **/
const games = [
  {
    id: 1,
    name: "ANNOUNCEMENT",
    description: [
      {
        title: "TIMESLOT (UTC+8)",
        items: [
          "2:00 PM = DODOS - INITIAL DRAW [Q4 2025]",
          "3:00 PM = FRUIT GAME [Q1 2026]",
          "4:00 PM = DODOS - FINAL DRAW [Q4 2025]",
          "5:00 PM = ALICE IN WONDERLAND [Q1 2026]",
          "6:00 PM = ASIAN TREASURE [TBA]",
        ],
      },
      {
        title: "SUPPORT HIPERIA",
        items: [
          "Funds will go directly into future development, community rewards, and ongoing improvements.",
          "Supporters may receive eligibility for upcoming airdrop.*",
          "DONATION ADDRESS (SOLANA NETWORK):",
          WALLET_ADDRESS,
          // "Memecoin CA:",
          // WALLET_ADDRESS2,
        ],
      },
      {
        title: "MINI GAME",
        items: [
          "Control Dos to dodge obstacles",
          "Tap to Jump",
          "Have Fun and Enjoy"
        ],
      },
    ],
  },
  {
    id: 2,
    name: "DODOS [Q4 2025]",
    description: [
      {
        title: "How to Play",
        items: [
          "Players select 2 digits from 1 to 22",
          "Each ticket costs 0.0072 SOL",
          "Draws occur daily at 2:00, and 4:00 PM",
          "Offering 2 chances to win per ticket",
          "Check results after daily draw",
          "Winnings automatically credited instantly",
        ],
      },
      {
        title: "Prizes",
        items: [
          "Match both digits in exact order to win 1 SOL",
          "Match both digits in any order to win 0.01 SOL",
        ],
      },
    ],
  },
  {
    id: 3,
    name: "FRUIT GAME [Q1 2026]",
    description: [
      {
        title: "How to Play",
        items: [
          "Players pick 3 fruits",
          "Fruits include 🍑 Peach, 🥭 Mango, 🍎 Apple, 🍌 Banana, 🍒 Cherry, 🍍 Pineapple, 🍇 Grapes, 🍓 Strawberry, 🍋 Lemon",
          "Each ticket costs 0.005 SOL",
          "Draw occurs daily at 3:00 PM",
          "Match order matters – you must match all fruits in the correct sequence",
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
    id: 4,
    name: "4D [Q1 2026]",
    description: [
      {
        title: "How to Play",
        items: [
          "Players select 4 numbers from 1 to 9",
          "Each ticket costs 0.001 SOL",
          "Draw occurs daily at 5:00 PM",
          "Match order matters – all 4 must be in exact sequence to hit the jackpot",
          "Winnings are automatically credited instantly",
        ],
      },
      {
        title: "Prizes",
        items: [
          "Match all 4 numbers in exact order to win 5 SOL",
          "Match last 3 numbers in exact order to win 0.1 SOL",
          "Match last 2 numbers in exact order to win 0.01 SOL",
        ],
      },
    ],
  },
  {
    id: 5,
    name: "ASIAN TREASURE [TBA]",
    description: [
      {
        title: "How to Play",
        items: [
          "Players select 5 numbers from 1 to 35",
          "Each ticket costs 0.005 SOL",
          "Draw occurs daily at 6:00 PM",
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
        ],
      },
    ],
  },
];

export default function GameCarousel({ onEnterGame }) {
  const [current, setCurrent] = useState(0);
  const [copiedAddress, setCopiedAddress] = useState(null);

  const handleCopy = useCallback((address) => () => {
    navigator.clipboard.writeText(address.trim()).then(() => {
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 1400);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = address.trim();
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress(null), 1400);
    });
  }, []);

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
            {games[current].description.map((section, sectionIndex) => {
              const isSupportSection =
                typeof section.title === "string" &&
                section.title.toLowerCase().includes("support hiperia");

              return (
                <div key={sectionIndex} className="description-section">
                  <h3 className="section-title">{section.title}:</h3>
                  <ul className="bullet-list">
                    {section.items.map((item, itemIndex) => {
                      const isWalletLine =
                        typeof item === "string" &&
                        (item.trim() === WALLET_ADDRESS || item.trim() === WALLET_ADDRESS2);

                      if (isSupportSection && isWalletLine) {
                        return (
                          <li key={itemIndex} style={{ listStyle: "none", marginLeft: "-1.2rem" }}>
                            <CopyWalletRow
                              address={item.trim()}
                              isCopied={copiedAddress === item.trim()}
                              onCopy={handleCopy(item.trim())}
                            />
                          </li>
                        );
                      }

                      return <li key={itemIndex}>{item}</li>;
                    })}
                  </ul>
                </div>
              );
            })}
          </div>

          {games[current].name.includes("ANNOUNCEMENT") && (
            <div className="wallet-btn">
              <button
                className="matrix-button"
                onClick={() => onEnterGame("Runner")}
                aria-label="Enter ANNOUNCEMENT Game"
              >
                MINI GAME
              </button>
            </div>
          )}

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

          {games[current].name.includes("FRUIT GAME1") && (
            <div className="wallet-btn">
              <button
                className="matrix-button"
                onClick={() => onEnterGame("FruitGame")}
                aria-label="Enter Fruit Game"
              >
                ENTER GAME
              </button>
            </div>
          )}

          {games[current].name.includes("4D1") && (
            <div className="wallet-btn">
              <button
                className="matrix-button"
                onClick={() => onEnterGame("AliceInWonderland")}
                aria-label="Enter Alice in Wonderland Game"
              >
                ENTER GAME
              </button>
            </div>
          )}
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