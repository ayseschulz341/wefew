import { motion } from "framer-motion";

interface Props {
  resumed?: boolean;
}

export function OrientationGate({ resumed = false }: Props) {
  return (
    <motion.div
      className="orientation-gate"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="orientation-title"
      aria-describedby="orientation-description"
    >
      <div className="orientation-gate__glow" aria-hidden="true" />
      <motion.div
        className="orientation-gate__device"
        initial={{ rotate: 0, scale: 0.86 }}
        animate={{ rotate: [0, 0, -90, -90], scale: [0.86, 1, 1, 0.96] }}
        transition={{ duration: 2.6, times: [0, 0.22, 0.62, 1], repeat: Infinity, repeatDelay: 0.55 }}
        aria-hidden="true"
      >
        <span className="orientation-gate__speaker" />
        <span className="orientation-gate__table">
          <i />
          <i />
          <i />
        </span>
      </motion.div>
      <motion.span
        className="orientation-gate__arc"
        animate={{ rotate: [0, -18, 0], opacity: [0.42, 1, 0.42] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        aria-hidden="true"
      >
        ↻
      </motion.span>

      <p className="orientation-gate__eyebrow">Бар открывается</p>
      <h1 id="orientation-title">
        {resumed ? "Верните горизонтальный режим" : "Переверните телефон горизонтально"}
      </h1>
      <p id="orientation-description">
        {resumed
          ? "Партия поставлена на паузу. Она продолжится автоматически после поворота."
          : "Игра начнётся автоматически, когда стол поместится на экране."}
      </p>
      <div className="orientation-gate__status" aria-hidden="true">
        <span /> Ожидаем поворота
      </div>
    </motion.div>
  );
}
