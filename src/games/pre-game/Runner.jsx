import React, { useEffect, useRef, useCallback } from "react";
import "./runner.css";

export default function Runner({ onBack }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // UI element refs
  const scoreRef = useRef(null);
  const highScoreRef = useRef(null);
  const livesRef = useRef(null);
  const powerupTimerRef = useRef(null);
  const comboRef = useRef(null);
  const powerupNoteRef = useRef(null);
  const startScreenRef = useRef(null);
  const gameOverScreenRef = useRef(null);
  const finalScoreRef = useRef(null);
  const comboMsgRef = useRef(null);
  const tumbleRef = useRef(null);

  // the entire mutable game state lives in here
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
      if (!G.current.isJumping && !G.current.isFlying) {
        G.current.dosY = G.current.groundY - G.current.dosHeight;
      }
    }
  }, []);

  // ————— helpers mapped from original —————
  const getAuraColor = useCallback(() => {
    const { powerStage } = G.current;
    const colors = ["#00ff41", "#00aaff", "#ffcc00", "#ff0066"];
    return colors[Math.min(powerStage, colors.length - 1)];
  }, []);

  const showPowerupNotification = useCallback((message) => {
    const el = powerupNoteRef.current;
    if (!el) return;
    el.textContent = message;
    el.style.opacity = "1";
    setTimeout(() => (el.style.opacity = "0"), 2000);
  }, []);

  const showComboText = useCallback(() => {
    const comboDisplay = comboRef.current;
    if (!comboDisplay) return;
    const { comboCount } = G.current;
    let text = "";
    if (comboCount >= 15) text = "MATRIX MASTER! x" + comboCount;
    else if (comboCount >= 10) text = "INCREDIBLE! x" + comboCount;
    else if (comboCount >= 5) text = "COMBO! x" + comboCount;

    if (text) {
      comboDisplay.textContent = text;
      comboDisplay.style.opacity = "1";
      setTimeout(() => (comboDisplay.style.opacity = "0"), 1000);
    }
  }, []);

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
      });
    }
  }, []);

  // ————— init game state —————
  const initState = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const high = Number(localStorage.getItem("matrixRunnerHighScore") || 0);

    G.current = {
      // canvas
      canvas,
      ctx,
      gameWidth: canvas.width,
      gameHeight: canvas.height,

      // flags
      gameActive: false,

      // meta
      score: 0,
      highScore: high,
      difficulty: 1,
      lastTimestamp: 0,

      // tap/double-tap
      lastTap: 0,
      tapTimeout: null,
      comboCount: 0,
      comboTimeout: null,
      consecutiveDodges: 0,
      lastObstacleDodged: null,

      // power
      powerLevel: 0,
      powerStage: 0,
      lives: 1,
      activePowerup: null,
      powerupTimer: 0,
      invisibleObstaclesLeft: 0,

      // dos
      dosX: 0,
      dosY: 0,
      dosWidth: 40,
      dosHeight: 60,
      groundY: canvas.height - 50,
      isJumping: false,
      isSliding: false,
      isFlying: false,
      jumpVelocity: 0,
      jumpPower: 15,
      gravity: 0.6,
      slideTimer: 0,
      flyTimer: 0,
      frameCount: 0,
      vulnerableTimer: 0, // Added for vulnerability period

      // objs
      obstacles: [],
      obstacleTimer: 0,
      obstacleRate: 1500,

      powerups: [],
      powerupTimerTotal: 0,
      powerupRate: 10000,

      buildings: [],
      particles: [],
      speedLines: [],
      auraParticles: [],
    };

    // starting positions
    G.current.dosX = G.current.gameWidth * 0.2;
    G.current.dosY = G.current.groundY - G.current.dosHeight;

    // background buildings
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

    // update UI
    if (highScoreRef.current) {
      highScoreRef.current.textContent = `High: ${G.current.highScore}`;
    }
  }, []);

  // ————— game start/exit —————
  const startGame = useCallback(() => {
    const g = G.current;
    if (!g) return;

    // reset state
    g.gameActive = true;
    g.score = 0;
    g.difficulty = 1;
    g.obstacles = [];
    g.powerups = [];
    g.obstacleTimer = 0;
    g.powerupTimerTotal = 0;
    g.comboCount = 0;
    g.consecutiveDodges = 0;
    g.particles = [];
    g.speedLines = [];
    g.auraParticles = [];
    g.powerLevel = 0;
    g.powerStage = 0;
    g.lives = 1;
    g.activePowerup = null;
    g.powerupTimer = 0;
    g.invisibleObstaclesLeft = 0;
    g.vulnerableTimer = 0;

    g.dosY = g.groundY - g.dosHeight;
    g.isJumping = false;
    g.isSliding = false;
    g.isFlying = false;
    g.jumpVelocity = 0;
    g.slideTimer = 0;
    g.flyTimer = 0;

    if (startScreenRef.current) startScreenRef.current.style.display = "none";
    if (gameOverScreenRef.current) gameOverScreenRef.current.style.display = "none";
    if (scoreRef.current) scoreRef.current.textContent = "Score: 0";
    if (livesRef.current) livesRef.current.textContent = "Lives: 1";
    if (powerupTimerRef.current) powerupTimerRef.current.textContent = "";

    g.lastTimestamp = performance.now();
    requestAnimationFrame(gameLoop);
  }, []);

  const exitGame = useCallback(() => {
    // simply show start screen again (same behavior as original)
    if (gameOverScreenRef.current) gameOverScreenRef.current.style.display = "none";
    if (startScreenRef.current) startScreenRef.current.style.display = "flex";
    if (typeof onBack === "function") onBack();
  }, [onBack]);

  // ————— input (tap / click / touch) —————
  const handleTouch = useCallback((e) => {
    const g = G.current;
    if (!g || !g.gameActive) return;
    e.preventDefault();

    const now = Date.now();
    const gap = now - g.lastTap;
    if (g.tapTimeout) clearTimeout(g.tapTimeout);

    if (gap < 300 && gap > 0) {
      // double tap = slide
      if (!g.isJumping && !g.isSliding && !g.isFlying) {
        g.isSliding = true;
        g.slideTimer = 1000;
        g.dosHeight = 30;
        // tiny particles
        createParticles(g.particles, { x: g.dosX, y: g.dosY, vxRange: 6, vyRange: 6, radiusMin: 1, radiusMax: 3, color: "#00ff41", lifeMin: 15, lifeMax: 30 }, 8);
      }
      g.lastTap = 0;
    } else {
      // single tap = jump
      if (!g.isJumping && !g.isSliding && !g.isFlying) {
        g.isJumping = true;
        g.jumpVelocity = g.jumpPower;
        createParticles(g.particles, { x: g.dosX, y: g.dosY, vxRange: 6, vyRange: 6, radiusMin: 1, radiusMax: 3, color: "#00ff41", lifeMin: 15, lifeMax: 30 }, 8);
      }
      g.tapTimeout = setTimeout(() => (g.lastTap = 0), 300);
      g.lastTap = now;
    }
  }, [createParticles]);

  // ————— core loop —————
  const gameLoop = useCallback((ts) => {
    const g = G.current;
    if (!g || !g.gameActive) return;

    const dt = ts - g.lastTimestamp;
    g.lastTimestamp = ts;

    update(dt);
    draw();

    requestAnimationFrame(gameLoop);
  }, []);

  // ————— update —————
  const update = useCallback((dt) => {
    const g = G.current;

    // Update vulnerability timer
    if (g.vulnerableTimer > 0) {
      g.vulnerableTimer -= dt;
    }

    // dos
    if (g.isFlying) {
      g.flyTimer -= dt;
      g.dosY = g.groundY - g.dosHeight - 100;
      if (g.flyTimer <= 0) {
        g.isFlying = false;
        g.dosY = g.groundY - g.dosHeight;
        // Set vulnerability period after landing from flight
        g.vulnerableTimer = 1000; // 1 second vulnerability
        showPowerupNotification("Fly mode ended! Vulnerable for 1s");
      }
    }

    if (g.isJumping && !g.isFlying) {
      g.dosY -= g.jumpVelocity;
      g.jumpVelocity -= g.gravity;
      if (g.dosY >= g.groundY - g.dosHeight) {
        g.dosY = g.groundY - g.dosHeight;
        g.isJumping = false;
        g.jumpVelocity = 0;
        // Set vulnerability period after landing from jump
        g.vulnerableTimer = 1000; // 1 second vulnerability
      }
    }

    if (g.isSliding && !g.isFlying) {
      g.slideTimer -= dt;
      if (g.slideTimer <= 0) {
        g.isSliding = false;
        g.dosHeight = 60;
        // Set vulnerability period after sliding
        g.vulnerableTimer = 1000; // 1 second vulnerability
      }
    }

    // obstacles
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
        if (g.invisibleObstaclesLeft > 0) {
          g.invisibleObstaclesLeft--;
          if (g.invisibleObstaclesLeft === 0) showPowerupNotification("Invisibility ended!");
        }
      }
    }

    // powerups
    g.powerupTimerTotal += dt;
    if (g.powerupTimerTotal > g.powerupRate / g.difficulty && Math.random() < 0.01) {
      createPowerup();
      g.powerupTimerTotal = 0;
    }
    for (let i = g.powerups.length - 1; i >= 0; i--) {
      const p = g.powerups[i];
      p.x -= 3 * g.difficulty * (dt / 16);
      if (checkPowerupCollision(p)) {
        collectPowerup(p);
        g.powerups.splice(i, 1);
        break;
      }
      if (p.x + p.width < 0) g.powerups.splice(i, 1);
    }

    // active powerup timer
    if (g.activePowerup === "fly") {
      g.powerupTimer -= dt;
      if (powerupTimerRef.current) {
        powerupTimerRef.current.textContent = `Fly: ${Math.ceil(g.powerupTimer / 1000)}s`;
      }
      if (g.powerupTimer <= 0) {
        g.activePowerup = null;
        if (powerupTimerRef.current) powerupTimerRef.current.textContent = "";
      }
    }

    // parallax buildings
    for (let i = 0; i < g.buildings.length; i++) {
      const b = g.buildings[i];
      b.x -= b.speed * g.difficulty * (dt / 16);
      if (b.x + b.width < 0) {
        b.x = g.gameWidth;
        b.height = 100 + Math.random() * 150;
        b.windows.forEach((w) => (w.lit = Math.random() > 0.5));
      }
    }

    // particles
    for (let i = g.particles.length - 1; i >= 0; i--) {
      const pr = g.particles[i];
      pr.x += pr.vx;
      pr.y += pr.vy;
      pr.life -= dt / 16;
      if (pr.life <= 0) g.particles.splice(i, 1);
    }

    // speed lines
    if (g.difficulty > 1.5 && Math.random() < 0.3) {
      g.speedLines.push({
        x: g.gameWidth,
        y: Math.random() * g.gameHeight,
        length: 20 + Math.random() * 30,
        speed: 10 + Math.random() * 10,
      });
    }
    for (let i = g.speedLines.length - 1; i >= 0; i--) {
      const sl = g.speedLines[i];
      sl.x -= sl.speed * g.difficulty;
      if (sl.x + sl.length < 0) g.speedLines.splice(i, 1);
    }

    // aura particles (power)
    if (g.powerLevel > 20) {
      const intensity = Math.floor(g.powerLevel / 25);
      for (let i = 0; i < intensity; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 20 + Math.random() * 30;
        const speed = 0.5 + Math.random() * 1.5;
        g.auraParticles.push({
          x: g.dosX + g.dosWidth / 2 + Math.cos(angle) * distance,
          y: g.dosY + g.dosHeight / 2 + Math.sin(angle) * distance,
          vx: -Math.cos(angle) * speed,
          vy: -Math.sin(angle) * speed,
          radius: 1 + Math.random() * 2,
          color: getAuraColor(),
          life: 20 + Math.random() * 30,
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

    // difficulty
    g.difficulty = Math.min(3, 1 + g.score * 0.01);
    g.obstacleRate = Math.max(800, 1500 - g.score * 10);

    // power level
    const newPL = Math.min(100, Math.floor(g.score / 2) + g.comboCount * 2);
    if (newPL > g.powerLevel) {
      g.powerLevel = newPL;
      if (g.powerLevel >= 75) g.powerStage = 3;
      else if (g.powerLevel >= 50) g.powerStage = 2;
      else if (g.powerLevel >= 25) g.powerStage = 1;
      else g.powerStage = 0;
    }

    g.frameCount++;
  }, [getAuraColor, showPowerupNotification, createParticles]);

  // ————— mechanics —————
  const createObstacle = useCallback(() => {
    const g = G.current;
    const type = Math.random() > 0.5 ? "laser" : "bullet";
    const speed = 5 + Math.random() * 3;
    const width = type === "laser" ? 60 : 20;
    const y = type === "laser" ? g.groundY - 20 : g.groundY - 70;
    const height = type === "laser" ? 10 : 20;

    g.obstacles.push({ type, x: g.gameWidth, y, width, height, speed });
  }, []);

  const createPowerup = useCallback(() => {
    const g = G.current;
    const types = ["life", "invisible", "fly"];
    const type = types[Math.floor(Math.random() * types.length)];
    g.powerups.push({ type, x: g.gameWidth, y: g.groundY - 70, width: 30, height: 30, speed: 3 });
  }, []);

  const rectHit = (ax, ay, aw, ah, bx, by, bw, bh) =>
    ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

  const checkCollision = useCallback((ob) => {
    const g = G.current;
    // Player is invulnerable during these conditions
    if (g.invisibleObstaclesLeft > 0 || g.isFlying || g.vulnerableTimer > 0) return false;
    
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
      if (ob.type === "laser" && g.isJumping) {
        g.consecutiveDodges++;
        g.lastObstacleDodged = ob;
        return false;
      }
      if (ob.type === "bullet" && g.isSliding) {
        g.consecutiveDodges++;
        g.lastObstacleDodged = ob;
        return false;
      }
      return true;
    }
    return false;
  }, []);

  const checkPowerupCollision = useCallback((p) => {
    const g = G.current;
    return rectHit(g.dosX, g.dosY, g.dosWidth, g.dosHeight, p.x, p.y, p.width, p.height);
  }, []);

  const collectPowerup = useCallback(
    (p) => {
      const g = G.current;
      switch (p.type) {
        case "life":
          g.lives++;
          if (livesRef.current) livesRef.current.textContent = `Lives: ${g.lives}`;
          showPowerupNotification("Extra life! +1");
          createParticles(g.particles, { x: p.x + p.width / 2, y: p.y + p.height / 2, vxRange: 10, vyRange: 10, radiusMin: 2, radiusMax: 5, color: "#ff0066", lifeMin: 20, lifeMax: 40 }, 20);
          break;
        case "invisible":
          g.invisibleObstaclesLeft = 2;
          showPowerupNotification("Invisibility! Next 2 obstacles");
          createParticles(g.particles, { x: p.x + p.width / 2, y: p.y + p.height / 2, vxRange: 10, vyRange: 10, radiusMin: 2, radiusMax: 5, color: "#00aaff", lifeMin: 20, lifeMax: 40 }, 20);
          break;
        case "fly":
          g.isFlying = true;
          g.flyTimer = 2000;
          g.activePowerup = "fly";
          g.powerupTimer = g.flyTimer;
          showPowerupNotification("Fly mode! 2 seconds");
          createParticles(g.particles, { x: p.x + p.width / 2, y: p.y + p.height / 2, vxRange: 10, vyRange: 10, radiusMin: 2, radiusMax: 5, color: "#ffcc00", lifeMin: 20, lifeMax: 40 }, 20);
          break;
        default:
          break;
      }
    },
    [showPowerupNotification, createParticles]
  );

  const hitObstacle = useCallback(() => {
    const g = G.current;

    // if spare life
    if (g.lives > 1) {
      g.lives--;
      if (livesRef.current) livesRef.current.textContent = `Lives: ${g.lives}`;
      showPowerupNotification("Life lost!");
      // Set vulnerability period after losing a life
      g.vulnerableTimer = 1000; // 1 second vulnerability
      return;
    }

    // explosion particles
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

    // tumble effect
    if (tumbleRef.current) tumbleRef.current.style.opacity = "1";

    g.gameActive = false;

    // high score
    if (g.score > g.highScore) {
      g.highScore = g.score;
      localStorage.setItem("matrixRunnerHighScore", g.highScore);
      if (highScoreRef.current) highScoreRef.current.textContent = `High: ${g.highScore}`;
    }

    // show game-over
    setTimeout(() => {
      if (tumbleRef.current) tumbleRef.current.style.opacity = "0";
      if (gameOverScreenRef.current) gameOverScreenRef.current.style.display = "flex";
      if (finalScoreRef.current) finalScoreRef.current.textContent = `Score: ${g.score}`;
      if (comboMsgRef.current) {
        comboMsgRef.current.textContent =
          g.consecutiveDodges > 5 ? `Awesome! ${g.consecutiveDodges} consecutive dodges!` : "";
      }
    }, 1500);
  }, [createParticles, showPowerupNotification]);

  const increaseScore = useCallback(() => {
    const g = G.current;
    const points = 1 + Math.floor(g.comboCount / 5);
    g.score += points;
    g.comboCount++;
    g.consecutiveDodges++;

    if (g.comboCount > 5) showComboText();

    clearTimeout(g.comboTimeout);
    g.comboTimeout = setTimeout(() => {
      g.comboCount = 0;
    }, 3000);

    if (scoreRef.current) {
      scoreRef.current.textContent = `Score: ${g.score}`;
      scoreRef.current.classList.add("flash");
      setTimeout(() => scoreRef.current && scoreRef.current.classList.remove("flash"), 300);
    }
  }, [showComboText]);

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

  // ————— draw —————
  const drawBackground = useCallback(() => {
    const g = G.current;
    const { ctx, groundY, buildings } = g;

    // buildings
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

  const drawPowerup = useCallback((p) => {
    const g = G.current;
    const { ctx } = g;
    ctx.shadowBlur = 15;

    if (p.type === "life") {
      ctx.fillStyle = "#ff0066";
      ctx.shadowColor = "#ff0066";
      ctx.beginPath();
      ctx.moveTo(p.x + 15, p.y + 5);
      ctx.bezierCurveTo(p.x + 15, p.y, p.x + 5, p.y, p.x + 5, p.y + 10);
      ctx.bezierCurveTo(p.x + 5, p.y + 17, p.x + 15, p.y + 25, p.x + 15, p.y + 25);
      ctx.bezierCurveTo(p.x + 15, p.y + 25, p.x + 25, p.y + 17, p.x + 25, p.y + 10);
      ctx.bezierCurveTo(p.x + 25, p.y, p.x + 15, p.y, p.x + 15, p.y + 5);
      ctx.fill();
    } else if (p.type === "invisible") {
      ctx.fillStyle = "#00aaff";
      ctx.shadowColor = "#00aaff";
      ctx.beginPath();
      ctx.arc(p.x + 15, p.y + 10, 10, Math.PI, 0, false);
      ctx.lineTo(p.x + 25, p.y + 25);
      ctx.lineTo(p.x + 20, p.y + 25);
      ctx.lineTo(p.x + 20, p.y + 20);
      ctx.lineTo(p.x + 10, p.y + 20);
      ctx.lineTo(p.x + 10, p.y + 25);
      ctx.lineTo(p.x + 5, p.y + 25);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.arc(p.x + 12, p.y + 10, 2, 0, Math.PI * 2);
      ctx.arc(p.x + 18, p.y + 10, 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.type === "fly") {
      ctx.fillStyle = "#ffcc00";
      ctx.shadowColor = "#ffcc00";
      ctx.beginPath();
      ctx.moveTo(p.x + 15, p.y + 15);
      ctx.lineTo(p.x + 5, p.y + 10);
      ctx.lineTo(p.x + 5, p.y + 20);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(p.x + 15, p.y + 15);
      ctx.lineTo(p.x + 25, p.y + 10);
      ctx.lineTo(p.x + 25, p.y + 20);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }, []);

  const draw = useCallback(() => {
    const g = G.current;
    const { ctx, gameWidth, gameHeight, groundY } = g;

    // clear
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, gameWidth, gameHeight);

    // background
    drawBackground();

    // speed lines
    ctx.strokeStyle = "#00ff41";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 10]);
    for (const line of g.speedLines) {
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(line.x, line.y);
      ctx.lineTo(line.x + line.length, line.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // ground
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

    // particles
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

    // aura particles
    for (const p of g.auraParticles) {
      ctx.globalAlpha = p.life / 70;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    // obstacles
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

    // powerups
    for (const p of g.powerups) drawPowerup(p);

    // Dos character
    let dosColor = "#00ff41";
    if (g.isFlying) dosColor = "#ffcc00";
    else if (g.invisibleObstaclesLeft > 0) dosColor = "#00aaff";
    else if (g.powerStage === 1) dosColor = "#00aaff";
    else if (g.powerStage === 2) dosColor = "#ffcc00";
    else if (g.powerStage === 3) dosColor = "#ff0066";

    // Flash during vulnerability period
    if (g.vulnerableTimer > 0 && Math.floor(g.frameCount / 5) % 2 === 0) {
      ctx.globalAlpha = 0.5;
    } else if (g.invisibleObstaclesLeft > 0) {
      ctx.globalAlpha = 0.6;
    }

    ctx.strokeStyle = dosColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.shadowBlur = 10;
    ctx.shadowColor = dosColor;

    if (g.isSliding && !g.isFlying) {
      // sliding
      ctx.beginPath(); ctx.moveTo(g.dosX + 20, g.dosY + 15); ctx.lineTo(g.dosX + 20, g.dosY + 40); ctx.stroke();
      ctx.beginPath(); ctx.arc(g.dosX + 20, g.dosY + 10, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.dosX + 20, g.dosY + 25); ctx.lineTo(g.dosX + 10, g.dosY + 35);
      ctx.moveTo(g.dosX + 20, g.dosY + 25); ctx.lineTo(g.dosX + 30, g.dosY + 35); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.dosX + 20, g.dosY + 40); ctx.lineTo(g.dosX + 10, g.dosY + 40);
      ctx.moveTo(g.dosX + 20, g.dosY + 40); ctx.lineTo(g.dosX + 30, g.dosY + 40); ctx.stroke();
    } else if (g.isJumping && !g.isFlying) {
      // jumping
      ctx.beginPath(); ctx.moveTo(g.dosX + 20, g.dosY + 15); ctx.lineTo(g.dosX + 20, g.dosY + 40); ctx.stroke();
      ctx.beginPath(); ctx.arc(g.dosX + 20, g.dosY + 10, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.dosX + 20, g.dosY + 25); ctx.lineTo(g.dosX + 5, g.dosY + 20);
      ctx.moveTo(g.dosX + 20, g.dosY + 25); ctx.lineTo(g.dosX + 35, g.dosY + 20); ctx.stroke();
      ctx.beginPath(); const legSwing = Math.sin(g.frameCount / 3) * 5;
      ctx.moveTo(g.dosX + 20, g.dosY + 40); ctx.lineTo(g.dosX + 10, g.dosY + 45);
      ctx.moveTo(g.dosX + 20, g.dosY + 40); ctx.lineTo(g.dosX + 30, g.dosY + 45); ctx.stroke();
    } else if (g.isFlying) {
      // flying
      ctx.beginPath(); ctx.moveTo(g.dosX + 20, g.dosY + 15); ctx.lineTo(g.dosX + 20, g.dosY + 40); ctx.stroke();
      ctx.beginPath(); ctx.arc(g.dosX + 20, g.dosY + 10, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.dosX + 20, g.dosY + 25); ctx.lineTo(g.dosX + 5, g.dosY + 15);
      ctx.moveTo(g.dosX + 20, g.dosY + 25); ctx.lineTo(g.dosX + 35, g.dosY + 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.dosX + 20, g.dosY + 40); ctx.lineTo(g.dosX + 15, g.dosY + 50);
      ctx.moveTo(g.dosX + 20, g.dosY + 40); ctx.lineTo(g.dosX + 25, g.dosY + 50); ctx.stroke();
    } else {
      // running
      ctx.beginPath(); ctx.moveTo(g.dosX + 20, g.dosY + 15); ctx.lineTo(g.dosX + 20, g.dosY + 40); ctx.stroke();
      ctx.beginPath(); ctx.arc(g.dosX + 20, g.dosY + 10, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      const armSwing = Math.sin(g.frameCount / 5) * 5;
      ctx.moveTo(g.dosX + 20, g.dosY + 25); ctx.lineTo(g.dosX + 5, g.dosY + 15 + armSwing);
      ctx.moveTo(g.dosX + 20, g.dosY + 25); ctx.lineTo(g.dosX + 35, g.dosY + 15 - armSwing); ctx.stroke();
      ctx.beginPath();
      const legSwing = Math.sin(g.frameCount / 3) * 5;
      ctx.moveTo(g.dosX + 20, g.dosY + 40); ctx.lineTo(g.dosX + 10, g.dosY + 50 + legSwing);
      ctx.moveTo(g.dosX + 20, g.dosY + 40); ctx.lineTo(g.dosX + 30, g.dosY + 50 - legSwing); ctx.stroke();
    }

    // power aura circle
    if (g.powerLevel > 20) {
      const auraSize = 20 + (g.powerLevel / 100) * 30;
      const grad = ctx.createRadialGradient(
        g.dosX + g.dosWidth / 2,
        g.dosY + g.dosHeight / 2,
        0,
        g.dosX + g.dosWidth / 2,
        g.dosY + g.dosHeight / 2,
        auraSize
      );
      if (g.powerStage === 0) {
        grad.addColorStop(0, "rgba(0,255,65,0.8)");
        grad.addColorStop(1, "rgba(0,255,65,0)");
      } else if (g.powerStage === 1) {
        grad.addColorStop(0, "rgba(0,170,255,0.8)");
        grad.addColorStop(1, "rgba(0,170,255,0)");
      } else if (g.powerStage === 2) {
        grad.addColorStop(0, "rgba(255,204,0,0.8)");
        grad.addColorStop(1, "rgba(255,204,0,0)");
      } else {
        grad.addColorStop(0, "rgba(255,0,102,0.8)");
        grad.addColorStop(1, "rgba(255,0,102,0)");
      }
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(g.dosX + g.dosWidth / 2, g.dosY + g.dosHeight / 2, auraSize, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowBlur = 20;
      ctx.shadowColor = getAuraColor();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
    
    // Reset alpha if it was changed
    ctx.globalAlpha = 1;
  }, [drawBackground, drawPowerup, getAuraColor]);

  // ————— mount —————
  useEffect(() => {
    initState();
    resizeCanvasToContainer();

    const canvas = canvasRef.current;
    // pointer/touch handlers on canvas
    canvas.addEventListener("touchstart", handleTouch, { passive: false });
    canvas.addEventListener("click", handleTouch, { passive: false });

    // resize observer
    const ro = new ResizeObserver(() => resizeCanvasToContainer());
    if (containerRef.current) ro.observe(containerRef.current);
    const onWinResize = () => resizeCanvasToContainer();
    window.addEventListener("resize", onWinResize);

    return () => {
      canvas.removeEventListener("touchstart", handleTouch);
      canvas.removeEventListener("click", handleTouch);
      ro.disconnect();
      window.removeEventListener("resize", onWinResize);
      G.current = null; // stop loop
    };
  }, [initState, handleTouch, resizeCanvasToContainer]);

  return (
    <div className="mr-body">
      <div className="back-button-container">
        <button
          className="matrix-button back-btn"
          onClick={onBack}
          aria-label="Back to Game Carousel"
        >
          <span className="button-text">BACK TO GAMES</span>
        </button>
      </div>
      
      <div className="mr-game-container" id="game-container" ref={containerRef}>
        <canvas id="game-canvas" ref={canvasRef} />

        <div id="score-display" ref={scoreRef}>Score: 0</div>
        <div id="high-score" ref={highScoreRef}>High: 0</div>
        <div id="lives-display" ref={livesRef}>Lives: 1</div>
        <div id="powerup-timer" ref={powerupTimerRef}></div>
        <div id="combo-display" ref={comboRef}></div>
        <div id="powerup-notification" ref={powerupNoteRef}></div>

        <div className="tumble-effect" id="tumble-effect" ref={tumbleRef}>
          <div className="tumble-dos"></div>
        </div>

        {/* START SCREEN */}
        <div id="start-screen" ref={startScreenRef}>
          <h1>MATRIX RUNNER</h1>
          <p>Control <strong>Dos</strong> to dodge obstacles in the Matrix</p>
          <div className="instructions">
            <p>• Tap: Jump (Dodge low lasers)</p>
            <p>• Double-tap: Slide (Dodge bullets)</p>
            <p>• Collect power-ups for special abilities!</p>
            <p>• ❤️ Extra life  • 👻 Invisibility (2 obstacles)  • 🪽 Fly (2s)</p>
          </div>
          <button className="btn" onClick={startGame}>START</button>
        </div>

        {/* GAME OVER */}
        <div id="game-over-screen" ref={gameOverScreenRef}>
          <h2>GAME OVER</h2>
          <p id="final-score" ref={finalScoreRef}>Score: 0</p>
          <p id="combo-message" ref={comboMsgRef}></p>
          <button className="btn" onClick={startGame}>PLAY AGAIN</button>
          <button className="btn" onClick={exitGame}>EXIT</button>
        </div>
      </div>
    </div>
  );
}