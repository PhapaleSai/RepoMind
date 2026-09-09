import type { MouseEvent } from "react";

// A quick expanding-circle ripple from the click point — appends a transient .ripple
// span to whatever element was clicked (must be position:relative and overflow:hidden).
export function createRipple(e: MouseEvent<HTMLElement>) {
  const target = e.currentTarget;
  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const span = document.createElement("span");
  span.className = "ripple";
  span.style.width = span.style.height = `${size}px`;
  span.style.left = `${e.clientX - rect.left - size / 2}px`;
  span.style.top = `${e.clientY - rect.top - size / 2}px`;
  target.appendChild(span);
  span.addEventListener("animationend", () => span.remove());
}

// Drives the .spotlight-card CSS radial-highlight effect: attach as onMouseMove on any
// element with class "spotlight-card" and it tracks the pointer via CSS custom properties.
export function handleSpotlight(e: MouseEvent<HTMLElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--x", `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty("--y", `${e.clientY - rect.top}px`);
}
