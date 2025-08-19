import React, { useState, useMemo, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import "../styles/donation-container.css";

// Mock data (replace with API call in production)
const leaderboardData = [
  { address: "0x123...abc", donation: 1000 },
  { address: "0x456...def", donation: 2 },
  { address: "0x789...ghi", donation: 1 },
  { address: "0xabc...jkl", donation: 0.5 },
  { address: "0xdef...mno", donation: 0.2 },
];

// Sub-component for Donator Info
function DonatorCard({ title, donator, className }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (className !== "top-donator-card") return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let particles = [];
    let mouseX = null;
    let mouseY = null;

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    const createParticle = () => {
      const isExplosion = particles.length < 30;
      return {
        x: isExplosion ? canvas.width / 2 : Math.random() * canvas.width,
        y: isExplosion ? canvas.height / 2 : Math.random() * canvas.height,
        size: Math.random() * 4 + 2,
        speedX: isExplosion ? (Math.random() - 0.5) * 6 : (Math.random() - 0.5) * 2,
        speedY: isExplosion ? (Math.random() - 0.5) * 6 : (Math.random() - 0.5) * 2,
        opacity: Math.random() * 0.5 + 0.4,
        life: isExplosion ? 30 : 80,
      };
    };

    const drawParticles = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles = particles.filter((p) => p.life > 0);
      particles.forEach((p) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 204, 0, ${p.opacity})`;
        ctx.fill();
        p.x += p.speedX;
        p.y += p.speedY;
        p.life -= 1;
        p.opacity -= 0.01;
        if (mouseX && mouseY) {
          const dx = p.x - mouseX;
          const dy = p.y - mouseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 60) {
            p.speedX += dx * 0.025;
            p.speedY += dy * 0.025;
          }
        }
      });
      if (mouseX && mouseY) {
        ctx.beginPath();
        ctx.arc(mouseX, mouseY, 40, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 204, 0, 0.12)`;
        ctx.fill();
      }
      if (particles.length < 20) particles.push(createParticle());
      requestAnimationFrame(drawParticles);
    };

    const handleHover = (e) => {
      mouseX = e.offsetX;
      mouseY = e.offsetY;
      particles.push(...Array.from({ length: 12 }, createParticle));
      // Optional: Add sound effect
      // new Audio('/sounds/supremacy-blast.mp3').play();
    };

    const handleMouseMove = (e) => {
      mouseX = e.offsetX;
      mouseY = e.offsetY;
    };

    const handleMouseLeave = () => {
      mouseX = null;
      mouseY = null;
    };

    resizeCanvas();
    particles = Array.from({ length: 20 }, createParticle);
    drawParticles();

    const container = containerRef.current;
    if (container) {
      container.addEventListener("mouseenter", handleHover);
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("mouseleave", handleMouseLeave);
      window.addEventListener("resize", resizeCanvas);
    }

    return () => {
      if (container) {
        container.removeEventListener("mouseenter", handleHover);
        container.removeEventListener("mousemove", handleMouseMove);
        container.removeEventListener("mouseleave", handleMouseLeave);
      }
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [className]);

  return (
    <div
      className={`donation-section ${className} animate-section`}
      ref={containerRef}
    >
      {className === "top-donator-card" && (
        <canvas ref={canvasRef} className="particle-canvas" />
      )}
      <h2 className={className === "top-donator-card" ? "cosmic-shimmer" : "cosmic-glitch"}>
        {title}
      </h2>
      <p className={`${className}-text`}>
        <a
          href={`https://solscan.io/account/${donator.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="address-link"
          aria-label={`${title} address: ${donator.address}`}
        >
          {donator.address}
        </a>
        {donator.donation && (
          <span className="donation-amount cosmic-glitch"> ({donator.donation} SOL)</span>
        )}
        {className === "top-donator-card" && (
          <span className="top-donator-badge" title="Top Donator">
            👑
          </span>
        )}
      </p>
    </div>
  );
}

DonatorCard.propTypes = {
  title: PropTypes.string.isRequired,
  donator: PropTypes.shape({
    address: PropTypes.string.isRequired,
    donation: PropTypes.number,
  }).isRequired,
  className: PropTypes.string.isRequired,
};

// Sub-component for Donation Form
function DonationForm({ onDonate, error, amount, setAmount }) {
  const [placeholder, setPlaceholder] = useState("");
  const [successParticles, setSuccessParticles] = useState(false);
  const fullPlaceholder = "Enter SOL amount...";

  useEffect(() => {
    let index = 0;
    const typeInterval = setInterval(() => {
      setPlaceholder(fullPlaceholder.slice(0, index));
      index++;
      if (index > fullPlaceholder.length) index = 0;
    }, 90);
    return () => clearInterval(typeInterval);
  }, []);

  useEffect(() => {
    if (successParticles) {
      const timer = setTimeout(() => setSuccessParticles(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [successParticles]);

  const handleDonateWithEffect = () => {
    onDonate();
    setSuccessParticles(true);
    // Optional: Add sound effect
    // new Audio('/sounds/cosmic-burst.mp3').play();
  };

  return (
    <div className="donation-section animate-section">
      <h2 className="cosmic-glitch">💸 MAKE A DONATION</h2>
      <div
        className={`donation-form ${successParticles ? "success-particles" : ""}`}
        role="form"
        aria-labelledby="donation-form"
      >
        <input
          type="number"
          className="donation-input"
          placeholder={placeholder}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="0.01"
          step="0.01"
          max="1000"
          aria-describedby="donation-error"
          required
          style={{ WebkitAppearance: "none", MozAppearance: "textfield" }}
        />
        <button
          className="donation-btn"
          onClick={handleDonateWithEffect}
          aria-label="Submit donation"
        >
          DONATE
        </button>
      </div>
      {error && (
        <p className="error-message cosmic-glitch" id="donation-error">
          {error}
        </p>
      )}
    </div>
  );
}

DonationForm.propTypes = {
  onDonate: PropTypes.func.isRequired,
  error: PropTypes.string,
  amount: PropTypes.string.isRequired,
  setAmount: PropTypes.func.isRequired,
};

// Sub-component for Leaderboard
function Leaderboard({ data }) {
  return (
    <div className="donation-section leaderboard animate-section">
      <h2 className="cosmic-glitch">📊 LEADERBOARD</h2>
      <table role="grid">
        <thead>
          <tr>
            <th scope="col">Rank</th>
            <th scope="col">Address</th>
            <th scope="col">Donation (SOL)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((user, index) => (
            <tr
              key={user.address}
              className={`leaderboard-row animate-row ${
                index === 0 ? "leaderboard-rank1" : ""
              }`}
              style={{ animationDelay: `${index * 0.08}s` }}
            >
              <td className="cosmic-glitch">#{index + 1}</td>
              <td>
                <a
                  href={`https://solscan.io/account/${user.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="address-link cosmic-glitch"
                  aria-label={`Donator address: ${user.address}`}
                >
                  {user.address}
                </a>
              </td>
              <td className="cosmic-glitch">{user.donation}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

Leaderboard.propTypes = {
  data: PropTypes.arrayOf(
    PropTypes.shape({
      address: PropTypes.string.isRequired,
      donation: PropTypes.number.isRequired,
    })
  ).isRequired,
};

export default function DonationContainer() {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const { topDonator, recentDonator } = useMemo(() => {
    const sortedData = [...leaderboardData].sort(
      (a, b) => b.donation - a.donation
    );
    return {
      topDonator: sortedData[0] || { address: "N/A", donation: 0 },
      recentDonator: leaderboardData[0] || { address: "N/A", donation: 0 },
    };
  }, []);

  const handleDonate = () => {
    const donationAmount = parseFloat(amount);
    if (!amount || isNaN(donationAmount) || donationAmount <= 0) {
      setError("⚠️ Invalid donation amount. Must be greater than 0 SOL.");
      setSuccess("");
      return;
    }
    if (donationAmount > 1000) {
      setError("⚠️ Donation amount cannot exceed 1000 SOL.");
      setSuccess("");
      return;
    }
    setError("");
    setSuccess(`✅ Donated ${donationAmount} SOL! 🚀`);
    setAmount("");
    // In a real app, update leaderboardData via API
  };

  return (
    <div
      className="donation-container game-card matrix-bg"
      role="region"
      aria-label="Donation Hub"
    >
      <DonatorCard
        title="🏆 TOP DONATOR"
        donator={topDonator}
        className="top-donator-card"
      />
      <DonatorCard
        title="✨ RECENT DONATOR"
        donator={recentDonator}
        className="recent-donator"
      />
      <DonationForm
        onDonate={handleDonate}
        error={error}
        amount={amount}
        setAmount={setAmount}
      />
      {success && <p className="success-message cosmic-glitch">{success}</p>}
      <Leaderboard data={leaderboardData} />
    </div>
  );
}