# Fighter на VPS рядом с релеем

Fighter запускается из собственного `docker-compose.yml` и хранит данные в собственном volume `fight-data`. С релеем он общается только по HTTPS. Единственная общая инфраструктура на одном IP — Caddy и сеть `fight-proxy`: порт 443 может занимать лишь один прокси.

## Первый запуск

1. Направьте DNS-запись `fight.cigilvpn.store` на IP VPS. В Cloudflare для прямого HTTPS через Caddy выберите DNS only.
2. На VPS обновите оба репозитория:

   ```bash
   cd /opt/meteor && git pull --ff-only
   cd /opt/fight && git pull --ff-only
   ```

3. У релея должен быть заполнен `/opt/meteor/deploy/.env` с `RELAY_DOMAIN`, `ACME_EMAIL` и ключами Kick. Добавьте туда `FIGHT_DOMAIN=fight.cigilvpn.store` и имя пользователя `FIGHT_ADMIN_USER=streamer`. Создайте хеш пароля командой `docker run --rm -it caddy:2-alpine caddy hash-password` (команда запросит пароль интерактивно). Скопируйте выведенный хеш в `.env` как `FIGHT_ADMIN_PASSWORD_HASH='хеш_из_команды'`: одинарные кавычки сохраняют символы `$` для Compose. Существующий `.env` не перезаписывайте. Обновите Caddy и создайте сеть для отдельного контейнера Fighter:

   ```bash
   cd /opt/meteor/deploy
   docker compose -f docker-compose.direct.yml config --quiet
   docker compose -f docker-compose.direct.yml up -d
   docker network inspect fight-proxy
   ```

4. Создайте конфигурацию Fighter. Рабочий `.env` не хранится в Git:

   ```bash
   cd /opt/fight
   cp -n deploy/.env.server.example .env
   nano .env
   ```

   Заполните `KICK_CHANNEL`; `TWITCH_CHANNEL` задайте, если используете Twitch. Проверьте `PUBLIC_URL` и `KICK_RELAY_URL`. Не публикуйте `.env` и не вставляйте его содержимое в сообщения.

5. Если на старом хосте уже есть очки или привязка релея, до первого запуска перенесите их в volume `fight-data`. Важны `points.json`, `points.json.bak`, `.agent.json`; сам `.env` и конфигурацию также сохраните отдельно. Например, с Windows отправьте папку на VPS: `scp -r "C:\Users\goman\Desktop\Fight\data" root@IP_СЕРВЕРА:/root/fight-data`. На VPS после заполнения `.env` создайте контейнер и скопируйте файлы:

   ```bash
   cd /opt/fight
   docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml create fight
   docker run --rm -v fight_fight-data:/target -v /root/fight-data:/source:ro alpine sh -c 'cp -a /source/. /target/'
   ```

   Имя `fight_fight-data` предполагает каталог проекта `/opt/fight`; если Compose использует другое имя проекта, уточните его через `docker volume ls`. Не удаляйте volume при обновлениях.

6. Запустите Fighter отдельно от Meteor:

   ```bash
   cd /opt/fight
   docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml config --quiet
   docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml up -d --build
   docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml ps
   ```

   Дополнительный Compose-файл подключает Fighter к `fight-proxy`. Порт 7778 наружу не публикуется.

## Проверка и управление

```bash
curl -i https://fight.cigilvpn.store/healthz
curl -s -o /dev/null -w '%{http_code}\n' https://fight.cigilvpn.store/overlay.html  # ожидается 200
curl -i https://fight.cigilvpn.store/api/state  # без пароля ожидается 401
cd /opt/fight && docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml logs --tail=80 fight
```

Панель откройте по адресу `https://fight.cigilvpn.store/` и введите имя и пароль, заданные для Caddy. В OBS используйте `https://fight.cigilvpn.store/overlay.html?obs=1`; таблица очков — `https://fight.cigilvpn.store/points.html`. Страницы и потоки OBS открываются без пароля. Если Twitch требует OAuth, начните авторизацию в панели; callback `/auth/twitch/callback` разрешён Caddy.

В панели Fighter подключите Kick. Для записи в чат авторизоваться должен владелец канала; привязка только по имени канала даёт чтение. Релей покажет подключённого агента на `https://relay.cigilvpn.store/status`.

## Обновление

```bash
cd /opt/fight
git pull --ff-only
docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml up -d --build
```

Если поменялись файлы Caddy или прямого Compose в Meteor, отдельно выполните `git pull --ff-only` в `/opt/meteor` и `docker compose -f docker-compose.direct.yml up -d` в `/opt/meteor/deploy`.
