// Lightweight, dependency-free confetti burst (Web Animations API). Fired when
// a card is dropped into the "Done / Completed" column.
export function fireConfetti(x?: number, y?: number) {
  if (typeof document === "undefined") return;
  const colors = ["#00c875", "#fdab3d", "#e2445c", "#0073ea", "#a25ddc", "#22c55e"];
  const cx = x ?? window.innerWidth / 2;
  const cy = y ?? window.innerHeight / 3;
  const N = 70;

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden;";
  document.body.appendChild(host);

  for (let i = 0; i < N; i++) {
    const piece = document.createElement("div");
    const size = 6 + Math.random() * 7;
    const color = colors[i % colors.length];
    const angle = Math.random() * Math.PI * 2;
    const speed = 100 + Math.random() * 280;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed - (140 + Math.random() * 160); // bias upward first
    const rot = Math.random() * 720 - 360;
    piece.style.cssText =
      `position:fixed;left:${cx}px;top:${cy}px;width:${size}px;height:${size * 0.55}px;` +
      `background:${color};border-radius:2px;will-change:transform,opacity;`;
    host.appendChild(piece);
    const anim = piece.animate(
      [
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`, opacity: 1, offset: 0.65 },
        { transform: `translate(${dx * 1.25}px, ${dy + 340}px) rotate(${rot * 1.5}deg)`, opacity: 0 },
      ],
      { duration: 1100 + Math.random() * 700, easing: "cubic-bezier(.2,.7,.3,1)" },
    );
    anim.onfinish = () => piece.remove();
  }
  window.setTimeout(() => host.remove(), 2400);
}
