# VoIP / Line

Свой UI поверх self-hosted **LiveKit**. Аудиоканал: два человека заходят в одну комнату.

- Архитектура: [ARCHITECTURE.md](./ARCHITECTURE.md)
- Соседство с уже существующим приложением на VPS: [deploy/COEXIST.md](./deploy/COEXIST.md)

## Что это

```
браузер (Line UI) ──HTTPS──► token API :3080
         └──WSS──► LiveKit :7880  ──UDP 7882──► медиа
```

LiveKit не заменяет текущее приложение на сервере. Он садится **отдельным compose** рядом: существующий Caddy получает два новых `server_name`, UDP для медиа открывается в firewall руками.

Пока нет своего DNS — `*.sslip.io`. Итог по соседству: [deploy/COEXIST.md](./deploy/COEXIST.md).

## Локально

Нужны Node 22+ и исходящий HTTPS (скачивается бинарь LiveKit). Docker не обязателен.

```bash
cp deploy/.env.example .env
bash scripts/dev.sh
```

- UI: http://127.0.0.1:5173
- API: http://127.0.0.1:8787/api/health
- LiveKit: ws://127.0.0.1:7880

Откройте две вкладки, один код комнаты, разные имена — должен появиться звук.

## На сервере рядом с другим приложением

Не ставить официальный инсталлятор LiveKit с Caddy на 80/443 — он отберёт порты. Использовать `deploy/docker-compose.yml` и дописать сайты из `deploy/Caddyfile.example` в уже живой Caddy. Firewall UDP — руками. Подробности в [deploy/COEXIST.md](./deploy/COEXIST.md).
