import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import "@fontsource/russo-one";
import "./styles/global.css";
import "./styles/menu.css";
import App from "./App";
import { sfx } from "./game/sounds";

// Звук разблокируется первым же жестом — в том числе у гостя, пришедшего
// по ссылке-приглашению и не нажимавшего кнопок меню.
const unlockAudio = () => sfx.unlock();
window.addEventListener("pointerdown", unlockAudio, { passive: true });
window.addEventListener("keydown", unlockAudio);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>,
);
