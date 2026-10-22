"""Validate raw Mini App initData. Never trust client-supplied Telegram IDs.

Protocol: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
No token, raw launch credentials, or Telegram JSON is stored or logged here.
"""
import hashlib
import hmac
import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qsl

from fastapi import HTTPException


def bot_token() -> str:
    filename = os.getenv('TELEGRAM_BOT_TOKEN_FILE', '')
    if filename:
        try:
            return Path(filename).read_text().strip()
        except OSError:
            return ''
    return os.getenv('TELEGRAM_BOT_TOKEN', '').strip()


def demo_login_enabled() -> bool:
    return os.getenv('ALLOW_DEMO_LOGIN', 'true').lower() == 'true'


@dataclass(frozen=True)
class Identity:
    telegram_id: int
    name: str
    auth_date: int
    expires_at: int
    credential_digest: str


def invalid():
    raise HTTPException(401, 'INVALID_TELEGRAM_AUTH')


def unique_json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON field')
        result[key] = value
    return result


def validate_init_data(raw: str, token: str, *, current_time: float | None = None,
                       max_age: int = 300, allow_expired: bool = False) -> Identity:
    if not token:
        raise HTTPException(503, 'TELEGRAM_AUTH_UNAVAILABLE')
    if not 30 <= max_age <= 3600:
        raise RuntimeError('TELEGRAM_AUTH_MAX_AGE_SECONDS must be between 30 and 3600')
    if not isinstance(raw, str) or not raw or len(raw) > 16384 or re.search(r'%(?![0-9a-fA-F]{2})', raw):
        invalid()
    try:
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True,
                          encoding='utf-8', errors='strict', max_num_fields=64)
    except (ValueError, UnicodeError):
        invalid()
    data = dict(pairs)
    if len(data) != len(pairs) or any(not re.fullmatch(r'[A-Za-z0-9_]+', key) for key in data):
        invalid()
    supplied = data.pop('hash', '')
    if not re.fullmatch(r'[0-9a-fA-F]{64}', supplied):
        invalid()
    check_string = '\n'.join(f'{key}={data[key]}' for key in sorted(data))
    secret = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, bytes.fromhex(supplied)):
        invalid()
    try:
        if not re.fullmatch(r'[0-9]{1,12}', data.get('auth_date', '')):
            invalid()
        auth_date = int(data['auth_date'])
        user = json.loads(data['user'], object_pairs_hook=unique_json_object)
        if not isinstance(user, dict):
            invalid()
        user_id = user.get('id')
        if type(user_id) is not int or not 0 < user_id < 2**52 or user.get('is_bot', False) is not False:
            invalid()
        first, last = user.get('first_name'), user.get('last_name', '')
        if not isinstance(first, str) or not first.strip() or not isinstance(last, str):
            invalid()
    except (KeyError, ValueError, TypeError):
        invalid()
    timestamp = time.time() if current_time is None else current_time
    if auth_date > timestamp + 30:
        invalid()
    if timestamp > auth_date + max_age and not allow_expired:
        raise HTTPException(401, 'TELEGRAM_AUTH_EXPIRED')
    # Canonical digest also catches a replay with reordered query parameters.
    credential_digest = hashlib.sha256(expected).hexdigest()
    return Identity(user_id, (' '.join((first.strip(), last.strip()))).strip()[:120],
                    auth_date, auth_date + max_age, credential_digest)
