import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import QRCode from "qrcode";
import type { OnlineRoomApi } from "../hooks/useOnlineRoom";
import type { GameVariant } from "../game/types";
import { VARIANT_LABELS } from "../game/types";
import { Avatar } from "./Avatar";

interface Props {
  room: OnlineRoomApi;
  inviteUrl: string;
  onExit: () => void;
}

const TURN_OPTIONS = [0, 15, 30, 45, 60] as const;

export function OnlineLobbyScreen({ room, inviteUrl, onExit }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(inviteUrl, {
      width: 320,
      margin: 1,
      color: { dark: "#211611", light: "#f1e4cf" },
      errorCorrectionLevel: "M",
    }).then((value) => active && setQrDataUrl(value));
    return () => {
      active = false;
    };
  }, [inviteUrl]);

  const copy = async (value: string, kind: "code" | "link") => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1800);
  };

  const share = async () => {
    if (navigator.share) {
      await navigator.share({
        title: "Бар лжецов — приглашение",
        text: `Заходи за мой стол. Код комнаты: ${room.roomCode}`,
        url: inviteUrl,
      });
      return;
    }
    await copy(inviteUrl, "link");
  };

  const updateVariant = (variant: GameVariant) =>
    room.updateSettings({ ...room.settings, variant });
  const updateTimer = (turnSeconds: (typeof TURN_OPTIONS)[number]) =>
    room.updateSettings({ ...room.settings, turnSeconds });

  const canStart =
    room.isHost &&
    room.players.filter((player) => player.connected).length >= 2 &&
    room.connectionStatus === "connected";

  return (
    <main className="online-lobby">
      <div className="online-lobby__ambient" aria-hidden="true" />
      <motion.section
        className="online-lobby__shell"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <header className="online-lobby__header">
          <button type="button" className="btn btn--ghost" onClick={onExit}>
            ← Главное меню
          </button>
          <div>
            <span className="online-lobby__eyebrow">Закрытый стол · до 4 игроков</span>
            <h1>{room.isHost ? "Ваш стол готов" : "Вы в комнате"}</h1>
          </div>
          <span className={`connection-badge is-${room.connectionStatus}`}>
            <i aria-hidden="true" />
            {room.connectionStatus === "connected"
              ? "В сети"
              : room.connectionStatus === "reconnecting"
                ? "Восстанавливаем связь"
                : room.connectionStatus === "connecting"
                  ? "Подключаемся"
                  : "Нет соединения"}
          </span>
        </header>

        {room.error && (
          <div className="online-lobby__error" role="alert">
            <span>{room.error}</span>
            {room.connectionStatus === "disconnected" && (
              <button type="button" className="btn" onClick={room.retry}>
                Подключиться снова
              </button>
            )}
          </div>
        )}

        <div className="online-lobby__grid">
          <section className="invite-panel" aria-labelledby="invite-title">
            <div className="invite-panel__copy">
              <span className="online-lobby__eyebrow">Пригласите друзей</span>
              <h2 id="invite-title">Ссылка, QR или код</h2>
              <p>Каждый способ ведёт в эту комнату. Свободно ещё {Math.max(0, 4 - room.players.length)} места.</p>

              <button
                type="button"
                className="room-code"
                onClick={() => copy(room.roomCode, "code")}
                aria-label="Скопировать код комнаты"
              >
                <span>Код комнаты</span>
                <strong>{room.roomCode}</strong>
                <small>{copied === "code" ? "Скопировано" : "Нажмите, чтобы скопировать"}</small>
              </button>

              <div className="invite-panel__actions">
                <button type="button" className="btn btn--primary" onClick={share}>
                  Поделиться ссылкой
                </button>
                <button type="button" className="btn" onClick={() => copy(inviteUrl, "link")}>
                  {copied === "link" ? "Ссылка скопирована" : "Копировать ссылку"}
                </button>
              </div>
            </div>
            <div className="invite-panel__qr">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt={`QR-код приглашения в комнату ${room.roomCode}`} />
              ) : (
                <div className="invite-panel__qr-loader" aria-label="Создаём QR-код" />
              )}
              <span>Наведите камеру телефона</span>
            </div>
          </section>

          <section className="lobby-players" aria-labelledby="players-title">
            <div className="lobby-section-title">
              <div>
                <span className="online-lobby__eyebrow">Участники</span>
                <h2 id="players-title">За столом {room.players.length}/4</h2>
              </div>
              <span>Для старта нужно двое</span>
            </div>

            <div className="lobby-players__grid">
              {[0, 1, 2, 3].map((index) => {
                const player = room.players[index];
                if (!player) {
                  return (
                    <div className="lobby-player is-empty" key={index}>
                      <span className="lobby-player__empty-icon">+</span>
                      <b>Свободное место</b>
                      <small>Ожидаем игрока</small>
                    </div>
                  );
                }
                return (
                  <motion.article
                    layout
                    className={`lobby-player ${!player.connected ? "is-offline" : ""}`}
                    key={player.id}
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                  >
                    <Avatar characterId={player.characterId ?? "foxy"} size={72} />
                    <div>
                      <b>{player.name}</b>
                      <small>{player.isHost ? "Владелец стола" : player.connected ? "Готов к игре" : "Переподключается"}</small>
                    </div>
                    {player.isHost && <span className="host-mark" title="Владелец комнаты">♛</span>}
                    {room.isHost && !player.isHost && (
                      <button
                        type="button"
                        className="lobby-player__kick"
                        onClick={() => room.kickPlayer(player.id)}
                        aria-label={`Исключить игрока ${player.name}`}
                      >
                        ×
                      </button>
                    )}
                  </motion.article>
                );
              })}
            </div>
          </section>

          <section className="lobby-settings" aria-labelledby="settings-title">
            <div className="lobby-section-title">
              <div>
                <span className="online-lobby__eyebrow">Правила партии</span>
                <h2 id="settings-title">Настройки стола</h2>
              </div>
              {!room.isHost && <span>Меняет владелец</span>}
            </div>

            <div className="lobby-settings__row">
              <fieldset disabled={!room.isHost}>
                <legend>Тип игры</legend>
                <div className="segmented-control">
                  {(["classic", "devil"] as GameVariant[]).map((variant) => (
                    <button
                      type="button"
                      key={variant}
                      aria-pressed={room.settings.variant === variant}
                      className={room.settings.variant === variant ? "is-active" : ""}
                      onClick={() => updateVariant(variant)}
                    >
                      {VARIANT_LABELS[variant]}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset disabled={!room.isHost}>
                <legend>Время на ход</legend>
                <div className="segmented-control segmented-control--timer">
                  {TURN_OPTIONS.map((seconds) => (
                    <button
                      type="button"
                      key={seconds}
                      aria-pressed={room.settings.turnSeconds === seconds}
                      className={room.settings.turnSeconds === seconds ? "is-active" : ""}
                      onClick={() => updateTimer(seconds)}
                    >
                      {seconds === 0 ? "Без таймера" : `${seconds} с`}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
          </section>
        </div>

        <footer className="online-lobby__footer">
          <p>
            {room.isHost
              ? canStart
                ? "Все готовы. Начинайте, когда захотите."
                : "Пригласите хотя бы одного друга."
              : "Игра начнётся, когда владелец стола нажмёт «Начать»."}
          </p>
          {room.isHost && (
            <button
              type="button"
              className="btn btn--primary btn--big"
              disabled={!canStart}
              onClick={room.startGame}
            >
              Начать игру
            </button>
          )}
        </footer>
      </motion.section>
    </main>
  );
}
