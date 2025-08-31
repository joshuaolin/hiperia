import React, { useEffect, useRef, useCallback } from "react";
import "./runner.css";

export default function Runner({ onBack }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // UI element refs
  const scoreRef = useRef(null);
  const highScoreRef = useRef(null);
  const startScreenRef = useRef(null);
  const gameOverScreenRef = useRef(null);
  const finalScoreRef = useRef(null);
  const tumbleRef = useRef(null);
  const exitButtonRef = useRef(null);

  // Mutable game state
  const G = useRef(null);

  const resizeCanvasToContainer = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const w = container.offsetWidth;
    const h = container.offsetHeight;
    canvas.width = w;
    canvas.height = h;
    if (G.current) {
      G.current.gameWidth = w;
      G.current.gameHeight = h;
      G.current.groundY = h - 50;
      if (!G.current.isJumping && !G.current.isSliding) {
        G.current.dosY = G.current.groundY - G.current.dosHeight;
      }
    }
  }, []);

  // Particle creation
  const createParticles = useCallback((arr, cfg, count) => {
    for (let i = 0; i < count; i++) {
      arr.push({
        x: cfg.x,
        y: cfg.y,
        vx: (Math.random() - 0.5) * cfg.vxRange,
        vy: (Math.random() - 0.5) * cfg.vyRange,
        radius: cfg.radiusMin + Math.random() * (cfg.radiusMax - cfg.radiusMin),
        color: cfg.color,
        life: cfg.lifeMin + Math.random() * (cfg.lifeMax - cfg.lifeMin),
        trail: cfg.trail || false,
      });
    }
  }, []);

  // Aura color based on power stage
  const getAuraColor = useCallback(() => {
    const { powerStage } = G.current;
    const colors = ["#00ff41", "#00aaff", "#ffcc00", "#ff0066"];
    return colors[Math.min(powerStage, colors.length - 1)];
  }, []);

  // Initialize game state
  const initState = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const high = Number(localStorage.getItem("matrixRunnerHighScore") || 0);

    G.current = {
      canvas,
      ctx,
      gameWidth: canvas.width,
      gameHeight: canvas.height,
      gameActive: false,
      score: 0,
      highScore: high,
      difficulty: 1,
      lastTimestamp: 0,
      lastTap: 0,
      tapTimeout: null,
      comboCount: 0,
      comboTimeout: null,
      powerLevel: 0,
      powerStage: 0,
      dosX: 0,
      dosY: 0,
      dosWidth: 40,
      dosHeight: 60,
      groundY: canvas.height - 50,
      isJumping: false,
      isSliding: false,
      jumpVelocity: 0,
      jumpPower: 15,
      gravity: 0.6,
      slideTimer: 0,
      obstacleTimer: 0,
      obstacleRate: 1100,
      obstacles: [],
      particles: [],
      auraParticles: [],
      buildings: [],
      frameCount: 0,
    };

    G.current.dosX = G.current.gameWidth * 0.2;
    G.current.dosY = G.current.groundY - G.current.dosHeight;

    // Background buildings
    G.current.buildings = [];
    for (let i = 0; i < 15; i++) {
      const b = {
        x: i * 150,
        height: 100 + Math.random() * 150,
        width: 80 + Math.random() * 70,
        color: `hsl(120, 100%, ${20 + Math.random() * 20}%)`,
        speed: 0.5 + Math.random() * 0.5,
        windows: [],
      };
      for (let j = 0; j < 5; j++) {
        b.windows.push({
          x: 10 + Math.random() * (b.width - 20),
          y: 10 + Math.random() * (b.height - 20),
          lit: Math.random() > 0.5,
        });
      }
      G.current.buildings.push(b);
    }

    if (highScoreRef.current) {
      highScoreRef.current.textContent = `High: ${G.current.highScore}`;
    }
  }, []);

  // Start game
  const startGame = useCallback(() => {
    const g = G.current;
    if (!g) return;

    g.gameActive = true;
    g.score = 0;
    g.difficulty = 1;
    g.comboCount = 0;
    g.powerLevel = 0;
    g.powerStage = 0;
    g.obstacles = [];
    g.particles = [];
    g.auraParticles = [];
    g.obstacleTimer = 0;
    g.isJumping = false;
    g.isSliding = false;
    g.jumpVelocity = 0;
    g.slideTimer = 0;
    g.dosY = g.groundY - g.dosHeight;

    if (startScreenRef.current) startScreenRef.current.style.display = "none";
    if (gameOverScreenRef.current) gameOverScreenRef.current.style.display = "none";
    if (exitButtonRef.current) exitButtonRef.current.style.display = "block";
    if (scoreRef.current) scoreRef.current.textContent = "Score: 0";

    g.lastTimestamp = performance.now();
    requestAnimationFrame(gameLoop);
  }, []);

  // Exit game
  const exitGame = useCallback(() => {
    const g = G.current;
    if (!g) return;

    g.gameActive = false;
    g.obstacles = [];
    g.particles = [];
    g.auraParticles = [];
    if (tumbleRef.current) tumbleRef.current.style.opacity = "0";
    if (gameOverScreenRef.current) gameOverScreenRef.current.style.display = "none";
    if (exitButtonRef.current) exitButtonRef.current.style.display = "none";
    if (startScreenRef.current) startScreenRef.current.style.display = "flex";
    if (typeof onBack === "function") onBack();
  }, [onBack]);

  // Input handling (tap/click)
  const handleTouch = useCallback((e) => {
    const g = G.current;
    if (!g || !g.gameActive) return;
    e.preventDefault();

    const now = Date.now();
    const gap = now - g.lastTap;
    if (g.tapTimeout) clearTimeout(g.tapTimeout);

    if (gap < 250 && gap > 0) {
      // Double tap = slide
      if (!g.isJumping && !g.isSliding) {
        g.isSliding = true;
        g.slideTimer = 800;
        g.dosHeight = 30;
        createParticles(g.particles, { x: g.dosX, y: g.dosY, vxRange: 6, vyRange: 6, radiusMin: 1, radiusMax: 3, color: "#00ff41", lifeMin: 15, lifeMax: 30 }, 8);
      }
      g.lastTap = 0;
    } else {
      // Single tap = jump
      if (!g.isJumping && !g.isSliding) {
        g.isJumping = true;
        g.jumpVelocity = g.jumpPower;
        createParticles(g.particles, { x: g.dosX, y: g.dosY, vxRange: 6, vyRange: 6, radiusMin: 1, radiusMax: 3, color: "#00ff41", lifeMin: 15, lifeMax: 30 }, 8);
      }
      g.tapTimeout = setTimeout(() => (g.lastTap = 0), 250);
      g.lastTap = now;
    }
  }, [createParticles]);

  // Game loop
  const gameLoop = useCallback((ts) => {
    const g = G.current;
    if (!g || !g.gameActive) return;

    const dt = ts - g.lastTimestamp;
    g.lastTimestamp = ts;

    update(dt);
    draw();

    requestAnimationFrame(gameLoop);
  }, []);

  // Update game state
  const update = useCallback((dt) => {
    const g = G.current;

    // Dos movement
    if (g.isJumping) {
      g.dosY -= g.jumpVelocity;
      g.jumpVelocity -= g.gravity;
      if (g.dosY >= g.groundY - g.dosHeight) {
        g.dosY = g.groundY - g.dosHeight;
        g.isJumping = false;
        g.jumpVelocity = 0;
      }
    }

    if (g.isSliding) {
      g.slideTimer -= dt;
      if (g.slideTimer <= 0) {
        g.isSliding = false;
        g.dosHeight = 60;
      }
    }

    // Obstacles
    g.obstacleTimer += dt;
    if (g.obstacleTimer > g.obstacleRate / g.difficulty) {
      createObstacle();
      g.obstacleTimer = 0;
    }
    for (let i = g.obstacles.length - 1; i >= 0; i--) {
      const ob = g.obstacles[i];
      ob.x -= ob.speed * g.difficulty * (dt / 16);
      if (checkCollision(ob)) {
        hitObstacle();
        break;
      }
      if (ob.x + ob.width < 0) {
        g.obstacles.splice(i, 1);
        increaseScore();
        createDodgeParticles(ob);
      }
    }

    // Parallax buildings
    for (let i = 0; i < g.buildings.length; i++) {
      const b = g.buildings[i];
      b.x -= b.speed * g.difficulty * (dt / 16);
      if (b.x + b.width < 0) {
        b.x = g.gameWidth;
        b.height = 100 + Math.random() * 150;
        b.windows.forEach((w) => (w.lit = Math.random() > 0.5));
      }
    }

    // Particles
    for (let i = g.particles.length - 1; i >= 0; i--) {
      const pr = g.particles[i];
      pr.x += pr.vx;
      pr.y += pr.vy;
      pr.life -= dt / 16;
      if (pr.life <= 0) g.particles.splice(i, 1);
    }

    // Aura particles
    if (g.powerLevel > 20) {
      const intensity = Math.min(5, Math.floor(g.powerLevel / 15)) * 1.5;
      for (let i = 0; i < intensity; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 30 + Math.random() * 40;
        const speed = 1 + Math.random() * 3;
        g.auraParticles.push({
          x: g.dosX + g.dosWidth / 2 + Math.cos(angle) * distance,
          y: g.dosY + g.dosHeight / 2 + Math.sin(angle) * distance,
          vx: -Math.cos(angle) * speed,
          vy: -Math.sin(angle) * speed,
          radius: 2 + Math.random() * 4,
          color: getAuraColor(),
          life: 30 + Math.random() * 40,
          trail: true,
        });
      }
    }
    for (let i = g.auraParticles.length - 1; i >= 0; i--) {
      const ap = g.auraParticles[i];
      ap.x += ap.vx;
      ap.y += ap.vy;
      ap.life -= dt / 16;
      if (ap.life <= 0) g.auraParticles.splice(i, 1);
    }

    // Difficulty
    g.difficulty = Math.min(2, 1 + g.score * 0.02);
    g.obstacleRate = Math.max(600, 1100 - g.score * 5);

    // Power level
    g.powerLevel = Math.min(100, Math.floor(g.score / 2));
    if (g.powerLevel >= 75) g.powerStage = 3;
    else if (g.powerLevel >= 50) g.powerStage = 2;
    else if (g.powerLevel >= 25) g.powerStage = 1;
    else g.powerStage = 0;

    g.frameCount++;
  }, [createParticles, getAuraColor]);

  // Mechanics
  const createObstacle = useCallback(() => {
    const g = G.current;
    const type = Math.random() > 0.5 ? "laser" : "bullet";
    const speed = 6 + Math.random() * 2;
    const width = type === "laser" ? 60 : 20;
    const y = type === "laser" ? g.groundY - 15 : g.groundY - 70;
    const height = type === "laser" ? 10 : 20;

    g.obstacles.push({ type, x: g.gameWidth, y, width, height, speed });
  }, []);

  const rectHit = (ax, ay, aw, ah, bx, by, bw, bh) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  const checkCollision = useCallback((ob) => {
    const g = G.current;
    if (
      rectHit(
        g.dosX,
        g.dosY,
        g.dosWidth,
        g.dosHeight,
        ob.x,
        ob.y,
        ob.width,
        ob.height
      )
    ) {
      if (ob.type === "laser" && g.isJumping) return false;
      if (ob.type === "bullet" && g.isSliding) return false;
      return true;
    }
    return false;
  }, []);

  const hitObstacle = useCallback(() => {
    const g = G.current;

    // Explosion particles
    createParticles(
      g.particles,
      {
        x: g.dosX + g.dosWidth / 2,
        y: g.dosY + g.dosHeight / 2,
        vxRange: 16,
        vyRange: 16,
        radiusMin: 1,
        radiusMax: 4,
        color: "#ff0066",
        lifeMin: 30,
        lifeMax: 70,
      },
      30
    );

    // Tumble effect
    if (tumbleRef.current) tumbleRef.current.style.opacity = "1";

    g.gameActive = false;

    // High score
    if (g.score > g.highScore) {
      g.highScore = g.score;
      localStorage.setItem("matrixRunnerHighScore", g.highScore);
      if (highScoreRef.current) highScoreRef.current.textContent = `High: ${g.highScore}`;
    }

    // Show game-over
    setTimeout(() => {
      if (tumbleRef.current) tumbleRef.current.style.opacity = "0";
      if (gameOverScreenRef.current) gameOverScreenRef.current.style.display = "flex";
      if (finalScoreRef.current) finalScoreRef.current.textContent = `Score: ${g.score}`;
    }, 500);
  }, [createParticles]);

  const increaseScore = useCallback(() => {
    const g = G.current;
    const points = g.comboCount >= 5 ? 2 : 1;
    g.score += points;
    g.comboCount++;
    if (scoreRef.current) {
      scoreRef.current.textContent = `Score: ${g.score}`;
      scoreRef.current.classList.add("flash");
      setTimeout(() => scoreRef.current && scoreRef.current.classList.remove("flash"), 300);
    }
    clearTimeout(g.comboTimeout);
    g.comboTimeout = setTimeout(() => {
      g.comboCount = 0;
    }, 3000);
  }, []);

  const createDodgeParticles = useCallback(
    (ob) => {
      const g = G.current;
      const color = ob.type === "laser" ? "#ff0066" : "#ffff00";
      const count = ob.type === "laser" ? 10 : 15;
      createParticles(
        g.particles,
        {
          x: ob.x + ob.width / 2,
          y: ob.y + ob.height / 2,
          vxRange: 10,
          vyRange: 10,
          radiusMin: 2,
          radiusMax: 5,
          color,
          lifeMin: 20,
          lifeMax: 50,
        },
        count
      );
    },
    [createParticles]
  );

  // Draw functions
  const drawBackground = useCallback(() => {
    const g = G.current;
    const { ctx, groundY, buildings } = g;

    // Buildings
    for (const b of buildings) {
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, groundY - b.height, b.width, b.height);

      for (const w of b.windows) {
        ctx.fillStyle = w.lit ? "#00ff41" : "#001100";
        ctx.fillRect(b.x + w.x, groundY - b.height + w.y, 5, 10);
        if (w.lit) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = "#00ff41";
          ctx.fillRect(b.x + w.x, groundY - b.height + w.y, 5, 10);
          ctx.shadowBlur = 0;
        }
      }
    }
  }, []);

  const draw = useCallback(() => {
    const g = G.current;
    const { ctx, gameWidth, gameHeight, groundY } = g;

    // Clear canvas
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, gameWidth, gameHeight);

    // Background
    drawBackground();

    // Ground
    ctx.fillStyle = "#002200";
    ctx.fillRect(0, groundY, gameWidth, gameHeight - groundY);
    ctx.strokeStyle = "#00ff41";
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 15]);
    ctx.beginPath();
    for (let i = 0; i < gameWidth; i += 30) {
      ctx.moveTo(i, groundY);
      ctx.lineTo(i, gameHeight);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Particles
    for (const p of g.particles) {
      ctx.globalAlpha = p.life / 70;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.shadowBlur = 5;
      ctx.shadowColor = p.color;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    // Aura particles with trails
    for (const p of g.auraParticles) {
      ctx.globalAlpha = p.life / 70;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.shadowBlur = 15;
      ctx.shadowColor = p.color;
      ctx.fill();
      if (p.trail) {
        const grad = ctx.createLinearGradient(p.x, p.y, p.x - p.vx * 5, p.y - p.vy * 5);
        grad.addColorStop(0, p.color);
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 5, p.y - p.vy * 5);
        ctx.strokeStyle = grad;
        ctx.lineWidth = p.radius;
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    // Obstacles
    for (const ob of g.obstacles) {
      if (ob.type === "laser") {
        const grad = ctx.createLinearGradient(ob.x, ob.y, ob.x + ob.width, ob.y);
        grad.addColorStop(0, "#ff0066");
        grad.addColorStop(0.5, "#ff00ff");
        grad.addColorStop(1, "#ff0066");
        ctx.fillStyle = grad;
        ctx.fillRect(ob.x, ob.y, ob.width, ob.height);
        ctx.shadowBlur = 15;
        ctx.shadowColor = "#ff0066";
        ctx.fillRect(ob.x, ob.y, ob.width, ob.height);
        ctx.shadowBlur = 0;
      } else {
        const grad = ctx.createRadialGradient(
          ob.x + ob.width / 2,
          ob.y + ob.height / 2,
          0,
          ob.x + ob.width / 2,
          ob.y + ob.height / 2,
          ob.width / 2
        );
        grad.addColorStop(0, "#ffffff");
        grad.addColorStop(1, "#ffff00");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(ob.x + ob.width / 2, ob.y + ob.height / 2, ob.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(ob.x + ob.width, ob.y + ob.height / 2);
        ctx.lineTo(ob.x + ob.width + 20, ob.y + ob.height / 2);
        ctx.stroke();
        ctx.shadowBlur = 20;
        ctx.shadowColor = "#ffff00";
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // Power aura circle
    if (g.powerLevel > 20) {
      const baseAuraSize = 30 + (g.powerLevel / 100) * 40;
      const pulse = Math.sin(g.frameCount / 20) * 10;
      const auraSize = baseAuraSize + pulse;

      // Inner glow
      const innerGrad = ctx.createRadialGradient(
        g.dosX + g.dosWidth / 2,
        g.dosY + g.dosHeight / 2,
        0,
        g.dosX + g.dosWidth / 2,
        g.dosY + g.dosHeight / 2,
        auraSize / 2
      );
      const auraColor = getAuraColor();
      innerGrad.addColorStop(0, `${auraColor}cc`);
      innerGrad.addColorStop(1, `${auraColor}00`);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(g.dosX + g.dosWidth / 2, g.dosY + g.dosHeight / 2, auraSize / 2, 0, Math.PI * 2);
      ctx.fillStyle = innerGrad;
      ctx.fill();
      ctx.shadowBlur = 30;
      ctx.shadowColor = auraColor;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Outer glow
      const outerGrad = ctx.createRadialGradient(
        g.dosX + g.dosWidth / 2,
        g.dosY + g.dosHeight / 2,
        0,
        g.dosX + g.dosWidth / 2,
        g.dosY + g.dosHeight / 2,
        auraSize
      );
      outerGrad.addColorStop(0, `${auraColor}66`);
      outerGrad.addColorStop(1, `${auraColor}00`);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(g.dosX + g.dosWidth / 2, g.dosY + g.dosHeight / 2, auraSize, 0, Math.PI * 2);
      ctx.fillStyle = outerGrad;
      ctx.fill();
      ctx.shadowBlur = 40;
      ctx.shadowColor = auraColor;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // Dos character
    let dosColor = getAuraColor();
    ctx.strokeStyle = dosColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.shadowBlur = 15;
    ctx.shadowColor = dosColor;

    if (g.isSliding) {
      ctx.beginPath();
      ctx.moveTo(g.dosX + 20, g.dosY + 15);
      ctx.lineTo(g.dosX + 20, g.dosY + 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(g.dosX + 20, g.dosY + 10, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.dosX + 20, g.dosY + 25);
      ctx.lineTo(g.dosX + 10, g.dosY + 35);
      ctx.moveTo(g.dosX + 20, g.dosY + 25);
      ctx.lineTo(g.dosX + 30, g.dosY + 35);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.dosX + 20, g.dosY + 40);
      ctx.lineTo(g.dosX + 10, g.dosY + 40);
      ctx.moveTo(g.dosX + 20, g.dosY + 40);
      ctx.lineTo(g.dosX + 30, g.dosY + 40);
      ctx.stroke();
    } else if (g.isJumping) {
      ctx.beginPath();
      ctx.moveTo(g.dosX + 20, g.dosY + 15);
      ctx.lineTo(g.dosX + 20, g.dosY + 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(g.dosX + 20, g.dosY + 10, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(g.dosX + 20, g.dosY + 25);
      ctx.lineTo(g.dosX + 5, g.dosY + 20);
      ctx.moveTo(g.dosX + 20, g.dosY + 25);
      ctx.lineTo(g.dosX + 35, g.dosY + 20);
      ctx.stroke();
      ctx.beginPath();
      const legSwing = Math.sin(g.frameCount / 3) * 5;
      ctx.moveTo(g.dosX + 20, g.dosY + 40);
      ctx.lineTo(g.dosX + 10, g.dosY + 45);
      ctx.moveTo(g.dosX + 20, g.dosY + 40);
      ctx.lineTo(g.dosX + 30, g.dosY + 45);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(g.dosX + 20, g.dosY + 15);
      ctx.lineTo(g.dosX + 20, g.dosY + 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(g.dosX + 20, g.dosY + 10, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      const armSwing = Math.sin(g.frameCount / 5) * 5;
      ctx.moveTo(g.dosX + 20, g.dosY + 25);
      ctx.lineTo(g.dosX + 5, g.dosY + 15 + armSwing);
      ctx.moveTo(g.dosX + 20, g.dosY + 25);
      ctx.lineTo(g.dosX + 35, g.dosY + 15 - armSwing);
      ctx.stroke();
      ctx.beginPath();
      const legSwing = Math.sin(g.frameCount / 3) * 5;
      ctx.moveTo(g.dosX + 20, g.dosY + 40);
      ctx.lineTo(g.dosX + 10, g.dosY + 50 + legSwing);
      ctx.moveTo(g.dosX + 20, g.dosY + 40);
      ctx.lineTo(g.dosX + 30, g.dosY + 50 - legSwing);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }, [drawBackground, createParticles, getAuraColor]);

  // Mount
  useEffect(() => {
    initState();
    resizeCanvasToContainer();

    const canvas = canvasRef.current;
    canvas.addEventListener("touchstart", handleTouch, { passive: false });
    canvas.addEventListener("click", handleTouch, { passive: false });

    const ro = new ResizeObserver(() => resizeCanvasToContainer());
    if (containerRef.current) ro.observe(containerRef.current);
    const onWinResize = () => resizeCanvasToContainer();
    window.addEventListener("resize", onWinResize);

    return () => {
      canvas.removeEventListener("touchstart", handleTouch);
      canvas.removeEventListener("click", handleTouch);
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
      G.current = null;
    };
  }, [initState, handleTouch, resizeCanvasToContainer]);

  return (
    <div className="mr-body">
      <div className="mr-game-container" id="game-container" ref={containerRef}>
        <canvas id="game-canvas" ref={canvasRef} />
        <div id="score-display" ref={scoreRef}>Score: 0</div>
        <div id="high-score" ref={highScoreRef}>High: 0</div>
        {/* <button id="exit-button" ref={exitButtonRef} className="btn" onClick={exitGame}>
          EXIT
        </button> */}
        <div className="tumble-effect" id="tumble-effect" ref={tumbleRef}>
          <div className="tumble-dos"></div>
        </div>
        <div id="start-screen" ref={startScreenRef}>
          <h1>MATRIX RUNNER</h1>
          <p>Control Dos to dodge obstacles!</p>
          <div className="instructions">
            <p>• Tap: Jump (dodge lasers)</p>
            <p>• Double-tap: Slide (dodge bullets)</p>
            <p>• One hit, game over!</p>
          </div>
          <button className="btn" onClick={startGame}>START</button>
        </div>
        <div id="game-over-screen" ref={gameOverScreenRef}>
          <h2>GAME OVER</h2>
          <p id="final-score" ref={finalScoreRef}>Score: 0</p>
          <button className="btn" onClick={startGame}>PLAY AGAIN</button>
          <button className="btn" onClick={exitGame}>EXIT</button>
        </div>
      </div>
    </div>
  );
}