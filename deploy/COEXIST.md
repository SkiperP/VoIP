# Соседство LiveKit с приложением на badger-budget.ru

## Итог

| Решение | Как |
|---|---|
| Машина и Docker | да |
| 80/443 | не трогать — их держит текущий Caddy на `badger-budget.ru` |
| LiveKit | отдельный compose `name: line` |
| HTTP на домене | `http://call.badger-budget.ru` и `http://badger-budget.ru/call/` |
| Рабочий HTTPS | Cloudflare quick tunnel в том же compose (`https://*.trycloudflare.com/call/`) |
| DNS | `call.badger-budget.ru` и `livekit.badger-budget.ru` (HTTP; TLS до IP с интернета зависает) |
| Медиа | UDP наружу руками, не через Caddy |
| Firewall | 7881/tcp, 7882/udp, 3478/udp |

```
браузер
  │  HTTPS  *.trycloudflare.com/call/ → tunnel → edge → :3080  (UI + token)
  │  WSS    *.trycloudflare.com/lk    → tunnel → edge → :7880  (signaling)
  │  HTTP   call.badger-budget.ru     → Caddy → :3080  (страница без микрофона)
  └── UDP   :7882 и :3478 напрямую на хост
```

TLS на `badger-budget.ru:443` с публичного интернета не открывается: TCP соединяется, Client Hello не доходит до NIC (на самой VPS `curl https://127.0.0.1` работает). Пока хостер это не снимет, звонки — только через туннель. Устойчивый hostname на своём домене: оранжевое облако Cloudflare (Flexible SSL → origin HTTP :80).

В HTTP-блоке apex **нельзя** писать голый `redir https://…` рядом с `handle /call*` — Caddy компилирует `redir` раньше `handle`. Нужно `handle { redir … }`.

---

## 1. DNS

В зоне `badger-budget.ru` два A-записи на **тот же IP**, что и основной сайт:

| Имя | Тип | Значение |
|---|---|---|
| `call` | A | IP сервера |
| `livekit` | A | IP сервера |

Проверка (с ноутбука, не только с VPS):

```bash
getent hosts call.badger-budget.ru livekit.badger-budget.ru badger-budget.ru
```

Все три должны показать один адрес. Пока DNS не указывает сюда, Caddy не получит сертификат — блоки в Caddyfile не добавлять раньше времени.

Если в панели уже есть `*.badger-budget.ru` — отдельные A всё равно не мешают. Если в Caddy уже висит сайт `*.badger-budget.ru`, два конкретных имени выше приоритетнее; старый wildcard не удалять, пока не проверите, что он не единственный обработчик.

---

## 2. Caddy

Нужно: **дописать** два блока в уже живой Caddyfile. Не ставить второй Caddy и не ставить официальный LiveKit-installer.

1. Найти Caddyfile (часто `/etc/caddy/Caddyfile` или рядом с docker-compose текущего приложения).
2. **Не удалять** блок `badger-budget.ru` / `www.badger-budget.ru`.
3. В конец файла вставить содержимое `deploy/Caddyfile.example`.
4. Проверить и перечитать:

```bash
caddy validate --config /etc/caddy/Caddyfile
# или, если Caddy в docker:
# docker exec <caddy-container> caddy validate --config /etc/caddy/Caddyfile

systemctl reload caddy
# если Caddy в docker — recreate/reload того контейнера, который уже слушает 80/443
```

Готовые блоки:

```caddy
call.badger-budget.ru {
	reverse_proxy 127.0.0.1:3080
}

livekit.badger-budget.ru {
	reverse_proxy 127.0.0.1:7880 {
		header_up Host {host}
		header_up X-Forwarded-Proto {scheme}
		flush_interval -1
	}
}
```

Caddy сам возьмёт Let's Encrypt на новые имена (HTTP-01 на уже открытом 80).

После reload: `curl -sI https://call.badger-budget.ru/api/health` начнёт отвечать, когда поднимется compose с UI. До этого Caddy может отдать 502 — это нормально.

Если Caddy крутится в Docker **без** `network_mode: host`, `127.0.0.1` внутри его контейнера — не хост. Тогда в `reverse_proxy` нужен `host.docker.internal` или IP docker-моста, не 127.0.0.1. Если Caddy на хосте (systemd) — оставляйте `127.0.0.1`.

---

## 3. Firewall

Caddy UDP не проксирует. Без этих трёх правил браузер дойдёт по WSS, а звука не будет.

**Не открывать** 3080 и 7880 наружу — они должны остаться на localhost. **Не трогать** 80/443.

### Какой firewall стоит

```bash
command -v ufw && ufw status verbose
command -v firewall-cmd && firewall-cmd --state
iptables -L INPUT -n | head
```

Ещё проверьте панель хостера (Security Group / Firewall в Timeweb, Selectel, Hetzner, AWS): правила ufw на машине не помогут, если UDP режется выше.

### UFW (Ubuntu)

Сначала посмотреть, включён ли:

```bash
ufw status verbose
```

Если `Status: inactive` — не делать `ufw enable`, пока не убедитесь, что 22/tcp и 80,443 уже в правилах. Иначе можно отрезать SSH. Когда UFW уже работает (типично, раз «порты не пускает»):

```bash
ufw allow 7881/tcp comment 'livekit ice-tcp'
ufw allow 7882/udp comment 'livekit media mux'
ufw allow 3478/udp comment 'livekit turn'
ufw reload
ufw status numbered
```

Должны появиться:

```
7881/tcp    ALLOW    Anywhere
7882/udp    ALLOW    Anywhere
3478/udp    ALLOW    Anywhere
```

### firewalld

```bash
firewall-cmd --permanent --add-port=7881/tcp
firewall-cmd --permanent --add-port=7882/udp
firewall-cmd --permanent --add-port=3478/udp
firewall-cmd --reload
firewall-cmd --list-ports
```

### Проверка снаружи

С другой машины (не с VPS):

```bash
nc -vz call.badger-budget.ru 7881
nc -u -vz call.badger-budget.ru 7882
nc -u -vz call.badger-budget.ru 3478
```

TCP 7881 должен соединиться. UDP часто не печатает «succeeded» — отсутствие ICMP unreachable уже хороший знак. Если с ноутбука timeout, а `ufw status` показывает ALLOW — режет облачный firewall, откройте те же три порта там.

---

## 4. Compose и .env

```bash
cp deploy/.env.example deploy/.env
# LIVEKIT_API_SECRET=$(openssl rand -hex 32)
# LIVEKIT_URL=wss://livekit.badger-budget.ru
cd deploy && docker compose up -d --build
```

UI по HTTP: http://call.badger-budget.ru — страница откроется, микрофон нет.

Рабочий HTTPS после `docker compose up -d --build`:

```bash
# подождать ~20 с, пока cloudflared напечатает URL
docker logs line-tunnel-1 2>&1 | grep trycloudflare | tail
# или:
cat runtime/https-url
curl -s http://127.0.0.1:3080/api/health
```

Откройте `https://<из файла>/call/` — две вкладки, один код комнаты.

Compose отдельный (`name: line`). В compose текущего приложения на `badger-budget.ru` сервисы не вписывать.
