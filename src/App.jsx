import React, { useState, useCallback, useEffect } from "react"; // Updated to use hooks instead of Component
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

import MatrixBackground from "./components/MatrixBackground";
import ParticleCanvas from "./components/ParticleCanvas";
import Header from "./components/Header";
import GameCarousel from "./components/GameCarousel";

// NOTE: path matches your structure
import Dodos from "./games/dodos/Dodos";
import FruitGame from "./games/fruit-game/FruitGame";
import AliceInWonderland from "./games/alice/AliceInWonderland";
import Runner from "./games/pre-game/Runner";

import Footer from "./components/Footer";
import "./styles/global.css";
import "./styles/header.css";

// Error Boundary Component (Converted to functional component with hooks)
const ErrorBoundary = ({ children }) => {
  const [hasError, setHasError] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const handleError = (error) => {
      setHasError(true);
      setError(error);
    };
    window.addEventListener("error", handleError);
    return () => window.removeEventListener("error", handleError);
  }, []);

  if (hasError) {
    return (
      <div className="error-boundary">
        <h1>Something went wrong: {error?.message}</h1>
        <button
          className="matrix-button"
          onClick={() => window.location.reload()}
          aria-label="Reload the page"
        >
          <span className="button-text">RELOAD</span>
        </button>
      </div>
    );
  }
  return children;
};

function LandingPage() {
  return (
    <div className="header-container">
      <div className="header-content">
        <div className="ticker">
          <span className="ticker-text hiperia-ticker-text">HIPERIA</span>
        </div>
        <p className="header-description">
          A decentralized micro-gaming ecosystem designed to be
          self-sustaining for retailers, featuring transparent and
          on-chain verified draw.
        </p>
        <div className="wallet-btn">
          <WalletMultiButton
            className="start-game-button wallet-adapter-button matrix-button"
            aria-label="Connect Wallet to Start Game"
          >
            START GAME
          </WalletMultiButton>
        </div>
      </div>
    </div>
  );
}

const ContentWrapper = React.memo(({ onEnterGame }) => {
  const { connected } = useWallet();
  const [currentView, setCurrentView] = useState(null);
  const [isConnectedStable, setIsConnectedStable] = useState(connected);

  // Debounce wallet connection changes to prevent rapid re-renders
  useEffect(() => {
    const timer = setTimeout(() => setIsConnectedStable(connected), 100);
    return () => clearTimeout(timer);
  }, [connected]);

  const handleEnterGameMemo = useCallback(
    (gameName) => {
      setCurrentView(gameName);
    },
    []
  );

  useEffect(() => {
    onEnterGame(handleEnterGameMemo);
  }, [onEnterGame, handleEnterGameMemo]);

  if (!isConnectedStable) return <LandingPage />;

  switch (currentView) {
    case "Runner":
      return <Runner onBack={() => setCurrentView(null)} />;
    case "Dodos":
      return <Dodos onBack={() => setCurrentView(null)} />;
    case "FruitGame":
      return <FruitGame onBack={() => setCurrentView(null)} />;
    case "AliceInWonderland":
      return <AliceInWonderland onBack={() => setCurrentView(null)} />;
    default:
      return <GameCarousel onEnterGame={handleEnterGameMemo} />;
  }
});

export default function App() {
  return (
    <div className="app">
      <MatrixBackground />
      <ParticleCanvas />
      <Header />
      <main>
        <ErrorBoundary>
          <ContentWrapper onEnterGame={() => {}} /> {/* Initial empty callback */}
        </ErrorBoundary>
      </main>
      <Footer />
    </div>
  );
}