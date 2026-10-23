"""Best-effort Bot API delivery of already committed in-app notifications.

No outbound request runs inside a business transaction, and no token or chat ID
is logged. Telegram delivery is deliberately non-durable in this MVP.
"""
import json
import logging
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from sqlalchemy import text
from .database import engine
from .telegram_auth import bot_token

log = logging.getLogger(__name__)
MINI_APP_URL = 'https://startup.locatermanhass.ru/'
MESSAGE_TEMPLATES = {
    'application.created': '📩 Новый отклик в проект «{project}». Посмотрите заявку в приложении.',
    'application.reject': '📋 Ваш отклик в проект «{project}» отклонён. Подробности — в приложении.',
    'offer.sent': '🎉 Вас пригласили в команду проекта «{project}»! Откройте приложение, чтобы ответить.',
    'offer.accept': '✅ Кандидат принял приглашение в проект «{project}». Команда обновлена.',
    'recruiter.invited': '🤝 Вас пригласили стать рекрутером проекта «{project}». Ответьте в приложении.',
}


def message_for(event_type: str, startup_title: str) -> str:
    return MESSAGE_TEMPLATES[event_type].format(project=(startup_title or 'стартап')[:160])


def mini_app_url() -> str | None:
    url = os.getenv('TELEGRAM_MINI_APP_URL', MINI_APP_URL)
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
        log.warning('Invalid TELEGRAM_MINI_APP_URL; omitting Mini App button')
        return None
    return url


def send_message(chat_id: int, body: str, token: str) -> bool:
    """Telegram may reject a message if the user never started/blocked the bot."""
    payload = {'chat_id': chat_id, 'text': body[:4096]}
    if link := mini_app_url():
        payload['reply_markup'] = {'inline_keyboard': [
            [{'text': 'Открыть приложение', 'web_app': {'url': link}}]
        ]}
    request = Request(
        f'https://api.telegram.org/bot{token}/sendMessage',
        data=json.dumps(payload, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urlopen(request, timeout=4) as response:
            result = json.load(response)
        if not isinstance(result, dict) or result.get('ok') is not True:
            log.warning('Telegram Bot API rejected notification')
            return False
        return True
    except HTTPError as exc:
        # HTTPError includes the bot token in its URL: NEVER log it.
        log.warning('Telegram Bot API rejected notification (HTTP %s)', exc.code)
        return False
    except (URLError, TimeoutError, OSError, ValueError) as exc:
        # Exception text can also include a token-bearing URL.
        log.warning('Telegram Bot API unavailable (%s)', type(exc).__name__)
        return False


def deliver_telegram_event(event_id: str) -> None:
    """Invoked by FastAPI BackgroundTasks AFTER a successful DB transaction."""
    token = bot_token()
    if not token:
        return
    try:
        with engine.connect() as conn:
            rows = conn.execute(text("""
                SELECT e.event_type, s.title AS startup_title, u.telegram_id
                  FROM notifications n
                  JOIN events e ON e.id=n.event_id
                  JOIN users u ON u.id=n.recipient_id
                  LEFT JOIN startups s ON s.id=e.startup_id
                 WHERE n.event_id=:event
                   AND e.event_type IN (
                     'application.created','application.reject','offer.sent',
                     'offer.accept','recruiter.invited'
                   )
                   AND u.telegram_id IS NOT NULL
                 ORDER BY n.id
            """), {'event': event_id}).mappings().all()
    except Exception:
        log.warning('Could not read committed Telegram notification recipients')
        return
    for row in rows:
        try:
            send_message(row['telegram_id'],
                         message_for(row['event_type'], row['startup_title']), token)
        except Exception:
            log.warning('Unexpected error in Telegram notification task')
