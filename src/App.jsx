import { useEffect, useState } from "react";
import Header from "./components/Header";
import Footer from "./components/Footer";
import ErrorBoundary from "./components/ErrorBoundary";
import Dodos from "./games/dodos/Dodos";
import BackToTop from "./components/BackToTop";

export default function App() {
  const [activeSection, setActiveSection] = useState(() =>
    window.location.hash === "#support" ? "support" : "dodos",
  );

  useEffect(() => {
    const updateSection = () => {
      setActiveSection(
        window.location.hash === "#support" ? "support" : "dodos",
      );
    };
    window.addEventListener("hashchange", updateSection);
    return () => window.removeEventListener("hashchange", updateSection);
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <a className="brand" href="#dodos" aria-label="Hiperia home">
          <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path
              d="M5 7v18m22-18v18M5 16h22M12 10l8 12"
              stroke="currentColor"
              strokeWidth="4"
            />
          </svg>
          hiperia<span className="brand-period">.</span>
        </a>
        <div className="sidebar-section-label">PLAY</div>
        <nav className="sidebar-nav">
          <a
            className={`nav-item${activeSection === "dodos" ? " nav-item-active" : ""}`}
            href="#dodos"
            aria-current={activeSection === "dodos" ? "location" : undefined}
          >
            <span className="nav-symbol" aria-hidden="true">
              ◈
            </span>
            Dodos
            {activeSection === "dodos" && (
              <span className="nav-active-dot" aria-hidden="true" />
            )}
          </a>
          <button
            className="nav-item nav-item-disabled"
            type="button"
            disabled
            aria-label="Lemon, coming in 2027"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M4 13c-2-4 1-9 5-9l2-1 1 2c4 2 5 7 2 10l-2 2-2-1c-3 1-5-1-6-3Z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            <span className="nav-coming-label">
              Lemon <small>Coming 2027</small>
            </span>
          </button>
          <a
            className={`nav-item${activeSection === "support" ? " nav-item-active" : ""}`}
            href="#support"
            aria-current={activeSection === "support" ? "location" : undefined}
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="m10 16-6.4-6.2a3.6 3.6 0 0 1 5.1-5.1L10 6l1.3-1.3a3.6 3.6 0 0 1 5.1 5.1L10 16Z"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
            Support Hiperia
            {activeSection === "support" && (
              <span className="nav-active-dot" aria-hidden="true" />
            )}
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-network">
            <span className="status-dot" />
            Test networks only
          </div>
          <p>Explore with test SOL.</p>
          <a href="https://faucet.solana.com/" target="_blank" rel="noreferrer">
            Get test SOL <span aria-hidden="true">↗</span>
          </a>
        </div>
      </aside>
      <div className="app-content">
        <Header activeSection={activeSection} />
        <main id="main-content" className="main-content">
          <ErrorBoundary>
            <Dodos />
          </ErrorBoundary>
        </main>
        <Footer />
      </div>
      <BackToTop />
    </div>
  );
}
