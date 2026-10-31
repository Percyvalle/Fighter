# Fighter как отдельный сервис на VPS

Fighter запускается своим Compose-проектом. Cloudflare Tunnel публикует его по HTTPS без открытого порта 7778 и без изменений в Meteor. Если для Kick выбран релей, Fighter обращается к нему по обычному исходящему HTTPS; это не объединяет контейнеры или данные проектов.

## Первый запуск

1. Скачайте репозиторий на VPS: `git clone https://github.com/Percyvalle/Fighter.git /opt/fight` (если он уже скачан: `cd /opt/fight && git pull --ff-only`).
2. В Cloudflare Zero Trust создайте отдельный туннель для Fighter. В разделе **Networks → Tunnels → ваш туннель → Routes → Add route → Published application** укажите домен `fight.cigilvpn.store` и **Service URL** `http://fight:7778`. В настройках маршрута задайте **HTTP Host Header** `fight.cigilvpn.store`: Fighter проверяет заголовок Host. Скопируйте токен туннеля. Старую A-запись `fight.cigilvpn.store`, направленную на IP сервера, замените маршрутом туннеля; маршрут должен владеть этим именем.
3. Заполните конфигурацию:

   ```bash
   cd /opt/fight
   cp -n deploy/.env.server.example .env
   nano .env
   ```

   Обязательно задайте `FIGHT_ADMIN_PASSWORD` и `CLOUDFLARE_TUNNEL_TOKEN`. Проверьте `PUBLIC_URL`, задайте `KICK_CHANNEL`, а `TWITCH_CHANNEL` — если используете Twitch. Для Kick через ранее поднятый релей оставьте `KICK_TRANSPORT=relay` и `KICK_RELAY_URL=https://relay.cigilvpn.store`. Рабочий `.env` не хранится в Git; его содержимое и токен туннеля не публикуйте.

4. Если нужны прежние очки и привязка релея, перед первым запуском перенесите в Docker volume `fight-data` файлы `points.json`, `points.json.bak`, `.agent.json`. Например, с Windows: `scp -r "C:\Users\goman\Desktop\Fight\data" root@IP_СЕРВЕРА:/root/fight-data`. Затем на VPS:

   ```bash
   cd /opt/fight
   docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml create fight
   docker run --rm -v fight_fight-data:/target -v /root/fight-data:/source:ro alpine sh -c 'cp -a /source/. /target/'
   ```

   Имя `fight_fight-data` предполагает каталог проекта `/opt/fight`; проверьте его через `docker volume ls`, если Compose использует другое имя проекта. При обновлениях volume не удаляйте.

5. Запустите контейнеры Fighter и его туннеля:

   ```bash
   cd /opt/fight
   docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml config --quiet
   docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml up -d --build
   docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml ps
   ```

## Проверка

```bash
curl -i https://fight.cigilvpn.store/healthz
curl -s -o /dev/null -w '%{http_code}\n' https://fight.cigilvpn.store/overlay.html  # 200
curl -i https://fight.cigilvpn.store/api/state  # без пароля 401
cd /opt/fight && docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml logs --tail=80 fight cloudflared
```

Панель: `https://fight.cigilvpn.store/` — браузер запросит `FIGHT_ADMIN_USER` и `FIGHT_ADMIN_PASSWORD`. Оверлей OBS: `https://fight.cigilvpn.store/overlay.html?obs=1`, таблица очков: `https://fight.cigilvpn.store/points.html`; они открываются без пароля. Twitch OAuth callback доступен по `/auth/twitch/callback`.

## Обновление

```bash
cd /opt/fight
git pull --ff-only
docker compose -f docker-compose.yml -f deploy/docker-compose.server.yml up -d --build
```

Релей Meteor обновляется и перезапускается отдельно; для запуска Fighter править его Compose или Caddy не требуется.
