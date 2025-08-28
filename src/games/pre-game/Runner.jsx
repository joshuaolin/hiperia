import React, { useEffect, useRef, useState } from 'react';

const Runner = ({ onBack }) => {
  const canvasRef = useRef(null);
  const [gameActive, setGameActive] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(localStorage.getItem('matrixRunnerHighScore') || 0);
  const [lives, setLives] = useState(1);
  const [powerupMessage, setPowerupMessage] = useState('');
  const [comboMessage, setComboMessage] = useState('');
  const [showGameOver, setShowGameOver] = useState(false);
  const [finalScore, setFinalScore] = useState(0);
  const [error, setError] = useState(null);

  // Game variables
  let gameWidth, gameHeight, ctx, groundY, dosX, dosY, dosWidth = 40, dosHeight = 60;
  let isJumping = false, isSliding = false, isFlying = false, jumpVelocity = 0;
  let jumpPower = 15, gravity = 0.6, slideTimer = 0, flyTimer = 0, frameCount = 0;
  let obstacleTimer = 0, obstacleRate = 1500, powerupTimerTotal = 0, powerupRate = 10000;
  let difficulty = 1, lastTimestamp = 0, lastTap = 0, tapTimeout;
  let comboCount = 0, consecutiveDodges = 0, lastObstacleDodged = null;
  let powerLevel = 0, powerStage = 0, activePowerup = null, powerupTimer = 0;
  let invisibleObstaclesLeft = 0;
  let obstacles = [], powerups = [], buildings = [], particles = [], speedLines = [], auraParticles = [];

  useEffect(() => {
    console.log('Runner component mounted, initializing canvas');
    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('Canvas element not found');
      setError('Canvas initialization failed');
      return;
    }
    ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Failed to get 2D context');
      setError('Canvas context initialization failed');
      return;
    }
    gameWidth = canvas.width = 500;
    gameHeight = canvas.height = 0.8 * window.innerHeight;
    groundY = gameHeight - 50;
    dosX = gameWidth * 0.2;
    dosY = groundY - dosHeight;

    initBackground();
    draw();

    const handleTouch = (e) => {
      console.log('Touch/click event triggered');
      if (!gameActive) return;
      e.preventDefault();
      const currentTime = new Date().getTime();
      const tapLength = currentTime - lastTap;

      if (tapTimeout) clearTimeout(tapTimeout);

      if (tapLength < 300 && tapLength > 0) {
        if (!isJumping && !isSliding && !isFlying) {
          isSliding = true;
          slideTimer = 1000;
          dosHeight = 30;
          createDodgeParticles({ x: dosX, y: dosY, width: 10, height: 10, type: 'slide' });
        }
        lastTap = 0;
      } else {
        if (!isJumping && !isSliding && !isFlying) {
          isJumping = true;
          jumpVelocity = jumpPower;
          createDodgeParticles({ x: dosX, y: dosY, width: 10, height: 10, type: 'jump' });
        }
        tapTimeout = setTimeout(() => { lastTap = 0; }, 300);
        lastTap = currentTime;
      }
    };

    canvas.addEventListener('touchstart', handleTouch, { passive: false });
    canvas.addEventListener('click', handleTouch, { passive: false });

    return () => {
      console.log('Cleaning up event listeners');
      canvas.removeEventListener('touchstart', handleTouch);
      canvas.removeEventListener('click', handleTouch);
    };
  }, [gameActive]);

  const initBackground = () => {
    buildings = [];
    for (let i = 0; i < 15; i++) {
      buildings.push({
        x: i * 150,
        height: 100 + Math.random() * 150,
        width: 80 + Math.random() * 70,
        color: `hsl(120, 100%, ${20 + Math.random() * 20}%)`,
        speed: 0.5 + Math.random() * 0.5,
        windows: Array.from({ length: 5 }, () => ({
          x: 10 + Math.random() * (80 + Math.random() * 70 - 20),
          y: 10 + Math.random() * (100 + Math.random() * 150 - 20),
          lit: Math.random() > 0.5,
        })),
      });
    }
  };

  const startGame = () => {
    console.log('Starting game');
    setGameActive(true);
    setScore(0);
    setLives(1);
    setShowGameOver(false);
    setPowerupMessage('');
    setComboMessage('');
    setError(null);
    obstacles = [];
    powerups = [];
    particles = [];
    speedLines = [];
    auraParticles = [];
    obstacleTimer = 0;
    powerupTimerTotal = 0;
    comboCount = 0;
    consecutiveDodges = 0;
    powerLevel = 0;
    powerStage = 0;
    activePowerup = null;
    powerupTimer = 0;
    invisibleObstaclesLeft = 0;
    dosY = groundY - dosHeight;
    isJumping = false;
    isSliding = false;
    isFlying = false;
    jumpVelocity = 0;
    slideTimer = 0;
    flyTimer = 0;
    lastTimestamp = performance.now();
    requestAnimationFrame(gameLoop);
  };

  const gameLoop = (timestamp) => {
    if (!gameActive) return;
    const deltaTime = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    update(deltaTime);
    draw();
    requestAnimationFrame(gameLoop);
  };

  const update = (deltaTime) => {
    updateDos(deltaTime);
    updateObstacles(deltaTime);
    updatePowerups(deltaTime);
    updateBackground(deltaTime);
    updateParticles(deltaTime);
    updateSpeedLines(deltaTime);
    updateAuraParticles(deltaTime);
    updateDifficulty();
    updatePowerLevel();
    updatePowerupTimer(deltaTime);
    frameCount++;
  };

  const updateDos = (deltaTime) => {
    if (isFlying) {
      flyTimer -= deltaTime;
      dosY = groundY - dosHeight - 100;
      if (flyTimer <= 0) {
        isFlying = false;
        dosY = groundY - dosHeight;
        setPowerupMessage('Fly mode ended!');
        setTimeout(() => setPowerupMessage(''), 2000);
      }
    }
    if (isJumping && !isFlying) {
      dosY -= jumpVelocity;
      jumpVelocity -= gravity;
      if (dosY >= groundY - dosHeight) {
        dosY = groundY - dosHeight;
        isJumping = false;
        jumpVelocity = 0;
        createLandingParticles();
      }
    }
    if (isSliding && !isFlying) {
      slideTimer -= deltaTime;
      if (slideTimer <= 0) {
        isSliding = false;
        dosHeight = 60;
        createLandingParticles();
      }
    }
  };

  const updateObstacles = (deltaTime) => {
    obstacleTimer += deltaTime;
    if (obstacleTimer > obstacleRate / difficulty) {
      createObstacle();
      obstacleTimer = 0;
    }
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const obstacle = obstacles[i];
      obstacle.x -= obstacle.speed * difficulty * (deltaTime / 16);
      if (checkCollision(obstacle)) {
        hitObstacle();
        break;
      }
      if (obstacle.x + obstacle.width < 0) {
        obstacles.splice(i, 1);
        increaseScore();
        createDodgeParticles(obstacle);
        if (invisibleObstaclesLeft > 0) {
          invisibleObstaclesLeft--;
          if (invisibleObstaclesLeft === 0) {
            setPowerupMessage('Invisibility ended!');
            setTimeout(() => setPowerupMessage(''), 2000);
          }
        }
      }
    }
  };

  const updatePowerups = (deltaTime) => {
    powerupTimerTotal += deltaTime;
    if (powerupTimerTotal > powerupRate / difficulty && Math.random() < 0.01) {
      createPowerup();
      powerupTimerTotal = 0;
    }
    for (let i = powerups.length - 1; i >= 0; i--) {
      const powerup = powerups[i];
      powerup.x -= 3 * difficulty * (deltaTime / 16);
      if (checkPowerupCollision(powerup)) {
        collectPowerup(powerup);
        powerups.splice(i, 1);
        break;
      }
      if (powerup.x + powerup.width < 0) {
        powerups.splice(i, 1);
      }
    }
  };

  const updatePowerupTimer = (deltaTime) => {
    if (activePowerup === 'fly') {
      powerupTimer -= deltaTime;
      setPowerupMessage(`Fly: ${Math.ceil(powerupTimer / 1000)}s`);
      if (powerupTimer <= 0) {
        activePowerup = null;
        setPowerupMessage('');
      }
    }
  };

  const updateBackground = (deltaTime) => {
    for (const building of buildings) {
      building.x -= building.speed * difficulty * (deltaTime / 16);
      if (building.x + building.width < 0) {
        building.x = gameWidth;
        building.height = 100 + Math.random() * 150;
        building.windows.forEach((win) => {
          win.lit = Math.random() > 0.5;
        });
      }
    }
  };

  const updateParticles = (deltaTime) => {
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].x += particles[i].vx;
      particles[i].y += particles[i].vy;
      particles[i].life -= deltaTime / 16;
      if (particles[i].life <= 0) particles.splice(i, 1);
    }
  };

  const updateSpeedLines = (deltaTime) => {
    if (difficulty > 1.5 && Math.random() < 0.3) {
      speedLines.push({
        x: gameWidth,
        y: Math.random() * gameHeight,
        length: 20 + Math.random() * 30,
        speed: 10 + Math.random() * 10,
      });
    }
    for (let i = speedLines.length - 1; i >= 0; i--) {
      speedLines[i].x -= speedLines[i].speed * difficulty;
      if (speedLines[i].x + speedLines[i].length < 0) speedLines.splice(i, 1);
    }
  };

  const updateAuraParticles = (deltaTime) => {
    if (powerLevel > 20) {
      const intensity = Math.floor(powerLevel / 25);
      for (let i = 0; i < intensity; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 20 + Math.random() * 30;
        const speed = 0.5 + Math.random() * 1.5;
        auraParticles.push({
          x: dosX + dosWidth / 2 + Math.cos(angle) * distance,
          y: dosY + dosHeight / 2 + Math.sin(angle) * distance,
          vx: -Math.cos(angle) * speed,
          vy: -Math.sin(angle) * speed,
          radius: 1 + Math.random() * 2,
          color: getAuraColor(),
          life: 20 + Math.random() * 30,
        });
      }
    }
    for (let i = auraParticles.length - 1; i >= 0; i--) {
      auraParticles[i].x += auraParticles[i].vx;
      auraParticles[i].y += auraParticles[i].vy;
      auraParticles[i].life -= deltaTime / 16;
      if (auraParticles[i].life <= 0) auraParticles.splice(i, 1);
    }
  };

  const getAuraColor = () => {
    const colors = ['#00ff41', '#00aaff', '#ffcc00', '#ff0066'];
    return colors[Math.min(powerStage, colors.length - 1)];
  };

  const updateDifficulty = () => {
    difficulty = 1 + (score * 0.01);
    if (difficulty > 3) difficulty = 3;
    obstacleRate = Math.max(800, 1500 - score * 10);
  };

  const updatePowerLevel = () => {
    const newPowerLevel = Math.min(100, Math.floor(score / 2) + (comboCount * 2));
    if (newPowerLevel > powerLevel) {
      powerLevel = newPowerLevel;
      if (powerLevel >= 75) powerStage = 3;
      else if (powerLevel >= 50) powerStage = 2;
      else if (powerLevel >= 25) powerStage = 1;
      else powerStage = 0;
    }
  };

  const createObstacle = () => {
    const type = Math.random() > 0.5 ? 'laser' : 'bullet';
    const speed = 5 + Math.random() * 3;
    const width = type === 'laser' ? 60 : 20;
    const y = type === 'laser' ? groundY - 20 : groundY - 70;
    const height = type === 'laser' ? 10 : 20;
    obstacles.push({ type, x: gameWidth, y, width, height, speed });
  };

  const createPowerup = () => {
    const types = ['life', 'invisible', 'fly'];
    const type = types[Math.floor(Math.random() * types.length)];
    powerups.push({ type, x: gameWidth, y: groundY - 70, width: 30, height: 30, speed: 3 });
  };

  const checkCollision = (obstacle) => {
    if (invisibleObstaclesLeft > 0 || isFlying) return false;
    if (
      dosX < obstacle.x + obstacle.width &&
      dosX + dosWidth > obstacle.x &&
      dosY < obstacle.y + obstacle.height &&
      dosY + dosHeight > obstacle.y
    ) {
      if (obstacle.type === 'laser' && isJumping) {
        consecutiveDodges++;
        lastObstacleDodged = obstacle;
        return false;
      }
      if (obstacle.type === 'bullet' && isSliding) {
        consecutiveDodges++;
        lastObstacleDodged = obstacle;
        return false;
      }
      return true;
    }
    return false;
  };

  const checkPowerupCollision = (powerup) => {
    return (
      dosX < powerup.x + powerup.width &&
      dosX + dosWidth > powerup.x &&
      dosY < powerup.y + powerup.height &&
      dosY + dosHeight > powerup.y
    );
  };

  const collectPowerup = (powerup) => {
    switch (powerup.type) {
      case 'life':
        setLives((prev) => prev + 1);
        setPowerupMessage('Extra life! +1');
        createCollectParticles(powerup, '#ff0066');
        break;
      case 'invisible':
        invisibleObstaclesLeft = 2;
        setPowerupMessage('Invisibility! Next 2 obstacles');
        createCollectParticles(powerup, '#00aaff');
        break;
      case 'fly':
        isFlying = true;
        flyTimer = 5000;
        activePowerup = 'fly';
        powerupTimer = flyTimer;
        setPowerupMessage('Fly mode! 5 seconds');
        createCollectParticles(powerup, '#ffcc00');
        break;
    }
    setTimeout(() => setPowerupMessage(''), 2000);
  };

  const hitObstacle = () => {
    if (lives > 1) {
      setLives((prev) => prev - 1);
      setPowerupMessage('Life lost!');
      setTimeout(() => setPowerupMessage(''), 2000);
      return;
    }
    createExplosionParticles();
    setGameActive(false);
    if (score > highScore) {
      setHighScore(score);
      localStorage.setItem('matrixRunnerHighScore', score);
    }
    setFinalScore(score);
    setComboMessage(consecutiveDodges > 5 ? `Awesome! ${consecutiveDodges} consecutive dodges!` : '');
    setTimeout(() => setShowGameOver(true), 1500);
  };

  const increaseScore = () => {
    const points = 1 + Math.floor(comboCount / 5);
    setScore((prev) => prev + points);
    comboCount++;
    consecutiveDodges++;
    if (comboCount > 5) {
      let text = '';
      if (comboCount >= 15) text = `MATRIX MASTER! x${comboCount}`;
      else if (comboCount >= 10) text = `INCREDIBLE! x${comboCount}`;
      else text = `COMBO! x${comboCount}`;
      setComboMessage(text);
      setTimeout(() => setComboMessage(''), 1000);
    }
    clearTimeout(comboTimeout);
    comboTimeout = setTimeout(() => { comboCount = 0; }, 3000);
  };

  const createDodgeParticles = (obstacle) => {
    const color = obstacle.type === 'laser' ? '#ff0066' : '#ffff00';
    const count = obstacle.type === 'laser' ? 10 : 15;
    for (let i = 0; i < count; i++) {
      particles.push({
        x: obstacle.x + obstacle.width / 2,
        y: obstacle.y + obstacle.height / 2,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        radius: 2 + Math.random() * 3,
        color,
        life: 20 + Math.random() * 30,
      });
    }
  };

  const createCollectParticles = (powerup, color) => {
    for (let i = 0; i < 20; i++) {
      particles.push({
        x: powerup.x + powerup.width / 2,
        y: powerup.y + powerup.height / 2,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        radius: 2 + Math.random() * 3,
        color,
        life: 20 + Math.random() * 30,
      });
    }
  };

  const createLandingParticles = () => {
    for (let i = 0; i < 8; i++) {
      particles.push({
        x: dosX + dosWidth / 2,
        y: dosY + dosHeight,
        vx: (Math.random() - 0.5) * 3,
        vy: -2 - Math.random() * 2,
        radius: 1 + Math.random() * 2,
        color: '#00ff41',
        life: 20 + Math.random() * 20,
      });
    }
  };

  const createExplosionParticles = () => {
    for (let i = 0; i < 30; i++) {
      particles.push({
        x: dosX + dosWidth / 2,
        y: dosY + dosHeight / 2,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        radius: 1 + Math.random() * 4,
        color: i % 2 === 0 ? '#ff0066' : '#00ff41',
        life: 30 + Math.random() * 40,
      });
    }
  };

  const draw = () => {
    if (!ctx) {
      console.error('Canvas context is null in draw');
      setError('Canvas context is null');
      return;
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, gameWidth, gameHeight);
    drawBackground();
    drawSpeedLines();
    ctx.fillStyle = '#002200';
    ctx.fillRect(0, groundY, gameWidth, gameHeight - groundY);
    ctx.strokeStyle = '#00ff41';
    ctx.lineWidth = 1;
    ctx.setLineDash([10, 15]);
    ctx.beginPath();
    for (let i = 0; i < gameWidth; i += 30) {
      ctx.moveTo(i, groundY);
      ctx.lineTo(i, gameHeight);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    drawParticles();
    drawAuraParticles();
    for (const obstacle of obstacles) {
      if (obstacle.type === 'laser') {
        const gradient = ctx.createLinearGradient(obstacle.x, obstacle.y, obstacle.x + obstacle.width, obstacle.y);
        gradient.addColorStop(0, '#ff0066');
        gradient.addColorStop(0.5, '#ff00ff');
        gradient.addColorStop(1, '#ff0066');
        ctx.fillStyle = gradient;
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#ff0066';
        ctx.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
        ctx.shadowBlur = 0;
      } else {
        const gradient = ctx.createRadialGradient(
          obstacle.x + obstacle.width / 2,
          obstacle.y + obstacle.height / 2,
          0,
          obstacle.x + obstacle.width / 2,
          obstacle.y + obstacle.height / 2,
          obstacle.width / 2
        );
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(1, '#ffff00');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2, obstacle.width / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(obstacle.x + obstacle.width, obstacle.y + obstacle.height / 2);
        ctx.lineTo(obstacle.x + obstacle.width + 20, obstacle.y + obstacle.height / 2);
        ctx.stroke();
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#ffff00';
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    for (const powerup of powerups) {
      drawPowerup(powerup);
    }
    drawDos();
    drawPowerAura();
  };

  const drawBackground = () => {
    for (const building of buildings) {
      ctx.fillStyle = building.color;
      ctx.fillRect(building.x, groundY - building.height, building.width, building.height);
      for (const window of building.windows) {
        ctx.fillStyle = window.lit ? '#00ff41' : '#001100';
        ctx.fillRect(building.x + window.x, groundY - building.height + window.y, 5, 10);
        if (window.lit) {
          ctx.shadowBlur = 10;
          ctx.shadowColor = '#00ff41';
          ctx.fillRect(building.x + window.x, groundY - building.height + window.y, 5, 10);
          ctx.shadowBlur = 0;
        }
      }
    }
  };

  const drawPowerup = (powerup) => {
    ctx.shadowBlur = 15;
    switch (powerup.type) {
      case 'life':
        ctx.fillStyle = '#ff0066';
        ctx.shadowColor = '#ff0066';
        ctx.beginPath();
        ctx.moveTo(powerup.x + 15, powerup.y + 5);
        ctx.bezierCurveTo(powerup.x + 15, powerup.y, powerup.x + 5, powerup.y, powerup.x + 5, powerup.y + 10);
        ctx.bezierCurveTo(powerup.x + 5, powerup.y + 17, powerup.x + 15, powerup.y + 25, powerup.x + 15, powerup.y + 25);
        ctx.bezierCurveTo(powerup.x + 15, powerup.y + 25, powerup.x + 25, powerup.y + 17, powerup.x + 25, powerup.y + 10);
        ctx.bezierCurveTo(powerup.x + 25, powerup.y, powerup.x + 15, powerup.y, powerup.x + 15, powerup.y + 5);
        ctx.fill();
        break;
      case 'invisible':
        ctx.fillStyle = '#00aaff';
        ctx.shadowColor = '#00aaff';
        ctx.beginPath();
        ctx.arc(powerup.x + 15, powerup.y + 10, 10, Math.PI, 0, false);
        ctx.lineTo(powerup.x + 25, powerup.y + 25);
        ctx.lineTo(powerup.x + 20, powerup.y + 25);
        ctx.lineTo(powerup.x + 20, powerup.y + 20);
        ctx.lineTo(powerup.x + 10, powerup.y + 20);
        ctx.lineTo(powerup.x + 10, powerup.y + 25);
        ctx.lineTo(powerup.x + 5, powerup.y + 25);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(powerup.x + 12, powerup.y + 10, 2, 0, Math.PI * 2);
        ctx.arc(powerup.x + 18, powerup.y + 10, 2, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'fly':
        ctx.fillStyle = '#ffcc00';
        ctx.shadowColor = '#ffcc00';
        ctx.beginPath();
        ctx.moveTo(powerup.x + 15, powerup.y + 15);
        ctx.lineTo(powerup.x + 5, powerup.y + 10);
        ctx.lineTo(powerup.x + 5, powerup.y + 20);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(powerup.x + 15, powerup.y + 15);
        ctx.lineTo(powerup.x + 25, powerup.y + 10);
        ctx.lineTo(powerup.x + 25, powerup.y + 20);
        ctx.closePath();
        ctx.fill();
        break;
    }
    ctx.shadowBlur = 0;
  };

  const drawSpeedLines = () => {
    ctx.strokeStyle = '#00ff41';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 10]);
    for (const line of speedLines) {
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(line.x, line.y);
      ctx.lineTo(line.x + line.length, line.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  };

  const drawParticles = () => {
    for (const particle of particles) {
      ctx.globalAlpha = particle.life / 70;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fillStyle = particle.color;
      ctx.fill();
      ctx.shadowBlur = 5;
      ctx.shadowColor = particle.color;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  };

  const drawAuraParticles = () => {
    for (const particle of auraParticles) {
      ctx.globalAlpha = particle.life / 70;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      ctx.fillStyle = particle.color;
      ctx.fill();
      ctx.shadowBlur = 8;
      ctx.shadowColor = particle.color;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  };

  const drawPowerAura = () => {
    if (powerLevel > 20) {
      const auraSize = 20 + (powerLevel / 100) * 30;
      const gradient = ctx.createRadialGradient(
        dosX + dosWidth / 2,
        dosY + dosHeight / 2,
        0,
        dosX + dosWidth / 2,
        dosY + dosHeight / 2,
        auraSize
      );
      if (powerStage === 0) {
        gradient.addColorStop(0, 'rgba(0, 255, 65, 0.8)');
        gradient.addColorStop(1, 'rgba(0, 255, 65, 0)');
      } else if (powerStage === 1) {
        gradient.addColorStop(0, 'rgba(0, 170, 255, 0.8)');
        gradient.addColorStop(1, 'rgba(0, 170, 255, 0)');
      } else if (powerStage === 2) {
        gradient.addColorStop(0, 'rgba(255, 204, 0, 0.8)');
        gradient.addColorStop(1, 'rgba(255, 204, 0, 0)');
      } else {
        gradient.addColorStop(0, 'rgba(255, 0, 102, 0.8)');
        gradient.addColorStop(1, 'rgba(255, 0, 102, 0)');
      }
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(dosX + dosWidth / 2, dosY + dosHeight / 2, auraSize, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.shadowBlur = 20;
      ctx.shadowColor = getAuraColor();
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  };

  const drawDos = () => {
    let dosColor = '#00ff41';
    if (isFlying) dosColor = '#ffcc00';
    else if (invisibleObstaclesLeft > 0) dosColor = '#00aaff';
    else if (powerStage === 1) dosColor = '#00aaff';
    else if (powerStage === 2) dosColor = '#ffcc00';
    else if (powerStage === 3) dosColor = '#ff0066';
    if (invisibleObstaclesLeft > 0) ctx.globalAlpha = 0.6;
    ctx.strokeStyle = dosColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 10;
    ctx.shadowColor = dosColor;

    if (isSliding && !isFlying) {
      ctx.beginPath();
      ctx.moveTo(dosX + 20, dosY + 15);
      ctx.lineTo(dosX + 20, dosY + 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dosX + 20, dosY + 10, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(dosX + 20, dosY + 25);
      ctx.lineTo(dosX + 10, dosY + 35);
      ctx.moveTo(dosX + 20, dosY + 25);
      ctx.lineTo(dosX + 30, dosY + 35);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(dosX + 20, dosY + 40);
      ctx.lineTo(dosX + 10, dosY + 40);
      ctx.moveTo(dosX + 20, dosY + 40);
      ctx.lineTo(dosX + 30, dosY + 40);
      ctx.stroke();
    } else if (isJumping && !isFlying) {
      ctx.beginPath();
      ctx.moveTo(dosX + 20, dosY + 15);
      ctx.lineTo(dosX + 20, dosY + 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dosX + 20, dosY + 10, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(dosX + 20, dosY + 25);
      ctx.lineTo(dosX + 5, dosY + 20);
      ctx.moveTo(dosX + 20, dosY + 25);
      ctx.lineTo(dosX + 35, dosY + 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(dosX + 20, dosY + 40);
      ctx.lineTo(dosX + 10, dosY + 45);
      ctx.moveTo(dosX + 20, dosY + 40);
      ctx.lineTo(dosX + 30, dosY + 45);
      ctx.stroke();
    } else if (isFlying) {
      ctx.beginPath();
      ctx.moveTo(dosX + 20, dosY + 15);
      ctx.lineTo(dosX + 20, dosY + 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dosX + 20, dosY + 10, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(dosX + 20, dosY + 25);
      ctx.lineTo(dosX + 5, dosY + 15);
      ctx.moveTo(dosX + 20, dosY + 25);
      ctx.lineTo(dosX + 35, dosY + 15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(dosX + 20, dosY + 40);
      ctx.lineTo(dosX + 15, dosY + 50);
      ctx.moveTo(dosX + 20, dosY + 40);
      ctx.lineTo(dosX + 25, dosY + 50);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(dosX + 20, dosY + 15);
      ctx.lineTo(dosX + 20, dosY + 40);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dosX + 20, dosY + 10, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      const armSwing = Math.sin(frameCount / 5) * 5;
      ctx.moveTo(dosX + 20, dosY + 25);
      ctx.lineTo(dosX + 5, dosY + 15 + armSwing);
      ctx.moveTo(dosX + 20, dosY + 25);
      ctx.lineTo(dosX + 35, dosY + 15 - armSwing);
      ctx.stroke();
      ctx.beginPath();
      const legSwing = Math.sin(frameCount / 3) * 5;
      ctx.moveTo(dosX + 20, dosY + 40);
      ctx.lineTo(dosX + 10, dosY + 50 + legSwing);
      ctx.moveTo(dosX + 20, dosY + 40);
      ctx.lineTo(dosX + 30, dosY + 50 - legSwing);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  };

  const exitGame = () => {
    console.log('Exiting game');
    setShowGameOver(false);
    setGameActive(false);
    setError(null);
    onBack();
  };

  if (error) {
    return (
      <div className="relative w-full max-w-[500px] h-[80vh] mx-auto bg-black border border-red-600 text-red-600 font-mono p-5">
        <h2 className="text-2xl mb-4">Error</h2>
        <p>{error}</p>
        <button
          onClick={exitGame}
          className="matrix-button mt-4"
        >
          <span className="button-text">Back to Menu</span>
        </button>
      </div>
    );
  }

  return (
    <div className="lotto-container">
      <div className="wallet-btn back-button-container">
        <button
          className="matrix-button back-btn"
          onClick={exitGame}
          type="button"
          aria-label="Back to Main Menu"
        >
          <span className="button-text">BACK TO MENU</span>
        </button>
      </div>
      <div className="game-area relative w-full max-w-[500px] h-[80vh] mx-auto bg-black border border-green-400 shadow-[0_0_20px_#00ff41,0_0_40px_rgba(0,255,65,0.3)] font-mono text-green-400 overflow-hidden z-50">
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
        <div className="absolute top-4 right-4 text-2xl z-10 text-green-400 font-bold tracking-wide shadow-[0_0_10px_#00ff41] animate-[flash_0.3s]">{`Score: ${score}`}</div>
        <div className="absolute top-4 left-4 text-lg z-10 text-green-400 opacity-80 shadow-[0_0_5px_#00ff41]">{`High: ${highScore}`}</div>
        <div className="absolute top-12 left-4 text-lg z-10 text-pink-600 shadow-[0_0_5px_#ff0066]">{`Lives: ${lives}`}</div>
        <div className="absolute top-12 right-4 text-base z-10 text-blue-400 shadow-[0_0_5px_#00aaff]">{powerupMessage}</div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-4xl text-fuchsia-500 font-bold shadow-[0_0_10px_#ff00ff] z-10 transition-opacity duration-1000" style={{ opacity: comboMessage ? 1 : 0 }}>{comboMessage}</div>
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-10 flex items-center justify-center opacity-0" style={{ opacity: showGameOver ? 1 : 0 }}>
          <div className="w-[70px] h-[70px] bg-gradient-to-br from-green-400 to-blue-400 rounded-full absolute animate-[tumble_1.5s_ease-out] shadow-[0_0_30px_#00ff41]" />
        </div>
        {!gameActive && !showGameOver && (
          <div className="absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center bg-black/85 z-20 text-center p-5">
            <h1 className="text-5xl mb-5 text-green-400 font-bold tracking-wide animate-[pulse_2s_infinite] shadow-[0_0_15px_#00ff41]">MATRIX RUNNER</h1>
            <p className="text-xl mb-5">Control <strong>Dos</strong> to dodge obstacles in the Matrix</p>
            <div className="my-6 p-5 border border-green-400 bg-green-400/10 rounded-lg shadow-[0_0_15px_rgba(0,255,65,0.2)] max-w-[85%]">
              <p className="text-base mb-2">• Tap: Jump (Dodge low lasers)</p>
              <p className="text-base mb-2">• Collect power-ups for special abilities!</p>
              <p className="text-base mb-2">• Heart: Extra life</p>
              <p className="text-base mb-2">• Ghost: Invisibility for 2 obstacles</p>
              <p className="text-base mb-2">• Wing: Fly mode for 5 seconds</p>
            </div>
            <button
              onClick={startGame}
              className="matrix-button"
            >
              <span className="button-text">START</span>
            </button>
          </div>
        )}
        {showGameOver && (
          <div className="absolute top-0 left-0 w-full h-full flex flex-col items-center justify-center bg-black/85 z-20 text-center p-5">
            <h2 className="text-4xl mb-8 text-green-400 font-bold shadow-[0_0_10px_#00ff41]">GAME OVER</h2>
            <p className="text-xl mb-5">{`Score: ${finalScore}`}</p>
            <p className="text-xl mb-5">{comboMessage}</p>
            <button
              onClick={startGame}
              className="matrix-button"
            >
              <span className="button-text">PLAY AGAIN</span>
            </button>
            <button
              onClick={exitGame}
              className="matrix-button mt-4"
            >
              <span className="button-text">EXIT</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Runner;