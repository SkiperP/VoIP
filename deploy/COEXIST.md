# Соседство LiveKit с уже существующим приложением

## Итог (зафиксировано)

| Решение | Как |
|---|---|
| Машина и Docker | да, переиспользуем |
| Порты 80/443 | нет, их уже держит текущее приложение через Caddy |
| Порты LiveKit на хосте | свободны |
| Firewall | UDP/ICE **ещё не пускает** — открыть руками |
| Свой домен + DNS | пока нет |
| Временные имена | **sslip.io** |
| Как ставить | **отдельный compose** рядом, не в чужой стек |
| HTTP(S) | новые `server_name` в **существующем Caddy**, не второй Caddy |
| Медиа | UDP наружу руками, Caddy это не проксирует |

LiveKit — отдельный процесс. Он не встраивается в текущее приложение и не занимает 80/443.

```
браузер
  │  HTTPS  call.<ip>.sslip.io      → Caddy → 127.0.0.1:3080  (UI + token)
  │  WSS    livekit.<ip>.sslip.io   → Caddy → 127.0.0.1:7880  (signaling)
  └── UDP   :7882 и :3478 напрямую на хост (firewall), не через Caddy
```

## Порты

| Порт | Куда публиковать | Кто открывает наружу |
|---|---|---|
| TCP 3080 | только `127.0.0.1` | Caddy |
| TCP 7880 | только `127.0.0.1` | Caddy |
| TCP 7881 | `0.0.0.0` | firewall |
| UDP 7882 | `0.0.0.0` | firewall, руками |
| UDP 3478 | `0.0.0.0` | firewall, руками |
| TCP 80/443 | не трогать | уже Caddy текущего приложения |

Проверка, что на хосте свободно:

```bash
ss -lntu | grep -E '7880|7881|7882|3478|3080'
```

## Firewall (обязательный шаг, сейчас закрыто)

Caddy UDP не возит. Без этих правил будет «подключились, тишина».

UFW:

```bash
ufw allow 7881/tcp comment 'livekit ice-tcp'
ufw allow 7882/udp comment 'livekit media mux'
ufw allow 3478/udp comment 'livekit turn'
ufw reload
ufw status numbered
```

firewalld:

```bash
firewall-cmd --permanent --add-port=7881/tcp
firewall-cmd --permanent --add-port=7882/udp
firewall-cmd --permanent --add-port=3478/udp
firewall-cmd --reload
```

Проверка снаружи (не с самого VPS): `nc -u -vz <ip> 7882` и TCP 7881. Если пакет не доходит — смотреть ещё облачный SG/security group, не только ufw.

## sslip.io (пока нет своего DNS)

Пусть публичный IPv4 сервера будет `203.0.113.10` — подставьте свой:

| Роль | Имя |
|---|---|
| UI + token | `call.203.0.113.10.sslip.io` |
| LiveKit signaling | `livekit.203.0.113.10.sslip.io` |

Проверка: `getent hosts call.203.0.113.10.sslip.io` должен вернуть тот же IP.

Caddy, который уже слушает 80/443, сам возьмёт Let's Encrypt на новые имена. Второй Caddy и официальный LiveKit-installer с Caddy на 443 — нельзя.

Когда появится свой домен: те же два `server_name`, только `call.example.com` / `livekit.example.com`, и `LIVEKIT_URL=wss://livekit.example.com`.

## Постановка

1. Клонировать репо на VPS (или скопировать `deploy/` + `apps/`).
2. `cp deploy/.env.example deploy/.env`
3. `openssl rand -hex 32` → `LIVEKIT_API_SECRET` (не короче 32 символов).
4. В `.env`: `LIVEKIT_URL=wss://livekit.<ваш-ip>.sslip.io`
5. Дописать блоки из `Caddyfile.example` в **существующий** Caddyfile, подставить IP. Перезагрузить Caddy (`systemctl reload caddy` или как у вас принято). Старые сайты не удалять.
6. Открыть UDP/ICE в firewall (команды выше).
7. `cd deploy && docker compose up -d --build`
8. UI: `https://call.<ip>.sslip.io` — две вкладки, один код комнаты.

Compose **отдельный** (`name: line`). В чужой docker-compose текущего приложения сервисы не вписывать.

`network_mode: host` не используем: на общей машине он сажает порты LiveKit прямо на хост и легче пересечься с уже живым стеком.

## Чего по-прежнему нельзя

- Проксировать UDP 7882/3478 через Caddy.
- Занимать 80/443 вторым веб-сервером.
- Считать sslip.io постоянным продакшеном: это временные имена до своего DNS.

Пользователей текущего приложения в token API пока не подключаем: endpoint открытый, для проверки канала. Дальше — проверять их сессию и только потом подписывать LiveKit JWT.
