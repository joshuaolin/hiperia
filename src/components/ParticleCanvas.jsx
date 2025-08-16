import React, { useEffect, useRef } from "react";

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
  draw(ctx) {
    ctx.fillStyle = `rgba(0,255,0,${this.opacity})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default function ParticleCanvas() {
  const canvasRef = useRef(null);
  const particles = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    function createParticles(e) {
      const maxParticles = window.innerWidth <= 640 ? 10 : 20;
      if (particles.current.length < 100) {
        for (let i = 0; i < maxParticles; i++) {
          particles.current.push(new Particle(e.clientX, e.clientY));
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = particles.current.length - 1; i >= 0; i--) {
        particles.current[i].update();
        particles.current[i].draw(ctx);
        if (
          particles.current[i].opacity <= 0 ||
          particles.current[i].size <= 0.1
        ) {
          particles.current.splice(i, 1);
        }
      }
      requestAnimationFrame(animate);
    }

    document.body.addEventListener("mousemove", createParticles);
    animate();

    window.addEventListener("resize", () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });
  }, []);

  return <canvas ref={canvasRef} id="particle-canvas"></canvas>;
}
