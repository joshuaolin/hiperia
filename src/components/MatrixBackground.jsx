import React, { useEffect, useRef } from "react";

export default function MatrixBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();

    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ";
    const fontSize = 14;
    let columns = canvas.width / fontSize;
    let drops = Array(Math.floor(columns)).fill(0);

    const drawMatrix = () => {
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#00cc00";
      ctx.font = `${fontSize}px Courier New`;

      for (let i = 0; i < drops.length; i++) {
        const text = chars.charAt(Math.floor(Math.random() * chars.length));
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        ctx.fillText(text, x, y);

        if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    };

    const animate = () => {
      drawMatrix();
      requestAnimationFrame(animate);
    };
    animate();

    window.addEventListener("resize", () => {
      resize();
      columns = canvas.width / fontSize;
      drops = Array(Math.floor(columns)).fill(0);
    });
  }, []);

  return (
    <canvas
      ref={canvasRef}
      id="matrix-bg"
      className="fixed top-0 left-0 w-full h-full -z-50"
    ></canvas>
  );
}
