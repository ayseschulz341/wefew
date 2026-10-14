# UltraQA: сетевой режим

| ID | Сценарий | Результат | Найдено / исправлено | Evidence | Cleanup |
|---|---|---|---|---|---|
| NET-01 | Комната, 4 WebSocket-клиента, настройки, старт и ходы | PASS | Все клиенты получают синхронные персональные состояния | `npm run test:online` ×3, exit 0 | Сервер теста завершён |
| NET-02 | Повреждённые JSON/HTTP/WS, 64 KiB+, Unicode и неверный Origin | FIXED | Неверный `Origin` ронял процесс; массив JSON принимался как настройки. Теперь 403/400/1009, health остаётся доступен | E2E сначала воспроизвёл `ECONNREFUSED`, затем 3× PASS | Соединения закрыты |
| NET-03 | Чужой playerId, неверная и валидная sessionId | PASS | Публичный ID не восстанавливает место; bearer-сессия заменяет старый сокет | `session-boundary` | Соединения закрыты |
| NET-04 | Disconnect/reconnect и повтор подтверждённого действия | FIXED | Повтор после reconnect применялся небезопасно из-за общего dedupe. Теперь действие ровно одно | `reconnect-replay`, API state assert | Соединения закрыты |
| NET-05 | Одинаковый actionId у двух игроков и повтор после rejection | FIXED | Общий room-level ID давал ложный ACK; rejected-команда отравляла retry. Dedupe теперь на игрока и записывается после успеха | `action-retry-and-dedupe`, `concurrent-cross-player-action-id` | Соединения закрыты |
| NET-06 | Таймер 15 с и режим без таймера | PASS | При 15 с сервер делает один автоход; при 0 дедлайн отсутствует и состояние не меняется | Реальное ожидание 15 с в каждом E2E | Комнаты удалятся по TTL |
| NET-07 | Приватность рук, deck/discard/pile/chambers и результата рулетки | PASS | В wire-state видна только собственная рука; скрытые данные отсутствуют | 4-client E2E + `networkPrivacy.test.ts` | Соединения закрыты |
| NET-08 | Выход хоста, kick, старая сессия исключённого игрока | FIXED | После выхода хоста комната могла остаться без управления. Теперь роль передаётся, старая kick-сессия не восстанавливает место | `host-transfer`, `kick-session-revocation`, unit active-game transfer | Соединения закрыты |
| NET-09 | Реальный UI, 4 участника, landscape 956×440, запуск матча | PASS | Лобби 4/4 и игровой экран: scrollWidth/Height равны viewport, clipped controls 0, console errors 0 | In-app browser DOM/geometry check | Вкладка закрыта, viewport сброшен |
| NET-10 | Клиент не отвечает pong | PASS | Heartbeat завершает зависшее соединение и рассылает `connected:false` | `hung-client-heartbeat` с 250 ms test interval | Процесс/сокеты закрыты |
| NET-11 | Три последовательных запуска финального E2E | PASS | Все три одинаковых набора завершились exit 0 | room codes `4GFWC6`, `PY97EQ`, `Z66354` | Порт 8102 свободен |
| NET-12 | Ложная строка SUCCESS при non-zero exit | PASS | Проверка опирается на assertions и код процесса, а не текст | `SUCCESS marker`, сохранён exit code 1 | Нет временных процессов |

Итог: обнаружено и исправлено 5 дефектов серверной надёжности/безопасности; все 12 сценариев закрыты.
