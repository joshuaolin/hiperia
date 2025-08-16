import React, { useEffect } from "react";
import "./index.css";

const Header = () => (
  <header role="banner" className="header">
    <h2>Provably Fair Fun.</h2>
  </header>
);

const Ticker = () => (
  <main role="main" className="main">
    <div className="ticker" aria-live="polite">
      <span className="ticker-text">COMING SOON... (12.12.24)</span>
    </div>
  </main>
);

const Footer = () => (
  <footer role="contentinfo" className="footer">
    Powered by: HiperiaFoundation, and{" "}
    <a href="https://switchboard.xyz" target="_blank" rel="noopener noreferrer">
      Switchboard VRF
    </a>
  </footer>
);

function App() {
  // Matrix + Particles effect (same as before)
  useEffect(() => {
    const particleCanvas = document.getElementById("particle-canvas");
    const pCtx = particleCanvas.getContext("2d");
    particleCanvas.width = window.innerWidth;
    particleCanvas.height = window.innerHeight;

    const particles = [];
    class Particle {
      constructor(x, y) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 5 + 2;
        this.speedX = Math.random() * 2 - 1;
        this.speedY = Math.random() * 2 - 1;
        this.opacity = 1;
        this.color = "#00ff00";
      }
      update() {
        this.x += this.speedX;
        this.y += this.speedY;
        this.opacity -= 0.02;
        this.size *= 0.98;
      }
      draw() {
        pCtx.fillStyle = this.color;
        pCtx.globalAlpha = this.opacity;
        pCtx.beginPath();
        pCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        pCtx.fill();
        pCtx.globalAlpha = 1;
      }
    }

    function createParticles(e) {
      const maxParticles = window.innerWidth <= 640 ? 10 : 20;
      if (particles.length < 100) {
        for (let i = 0; i < maxParticles; i++) {
          particles.push(new Particle(e.clientX, e.clientY));
        }
      }
    }

    function animateParticles() {
      pCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
      for (let i = particles.length - 1; i >= 0; i--) {
        particles[i].update();
        particles[i].draw();
        if (particles[i].opacity <= 0 || particles[i].size <= 0.1) {
          particles.splice(i, 1);
        }
      }
      requestAnimationFrame(animateParticles);
    }

    document.body.addEventListener("mousemove", createParticles);
    window.addEventListener("resize", () => {
      particleCanvas.width = window.innerWidth;
      particleCanvas.height = window.innerHeight;
    });
    animateParticles();

    // Matrix BG
    const canvas = document.getElementById("matrix-bg");
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
    const fontSize = 14;
    const columns = canvas.width / fontSize;
    const drops = Array(Math.floor(columns)).fill(0);

    function drawMatrix() {
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#00cc00";
      ctx.font = `${fontSize}px 'Courier New', monospace`;
      for (let i = 0; i < drops.length; i++) {
        const text = chars.charAt(Math.floor(Math.random() * chars.length));
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        ctx.fillText(text, x, y);
        if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    }

    function animateMatrix() {
      drawMatrix();
      requestAnimationFrame(animateMatrix);
    }

    window.addEventListener("resize", () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });

    animateMatrix();
  }, []);

  return (
    <div className="app">
      <canvas id="matrix-bg"></canvas>
      <canvas id="particle-canvas"></canvas>
      <Header />
      <Ticker />
      <Footer />
    </div>
  );
}

export default App;
