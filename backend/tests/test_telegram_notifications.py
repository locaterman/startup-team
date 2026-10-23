"""Bot API payload, error isolation and event-driven post-commit delivery."""
import io
import json
import os
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError

import pytest
from app import telegram_notifications as tg


def test_bot_api_sends_private_chat_web_app_button_without_parsing_user_text(monkeypatch):
    seen = []
    class FakeResponse:
        def __enter__(self): return io.BytesIO(b'{"ok":true,"result":{"message_id":12}}')
        def __exit__(self, *args): pass
    def fake_open(request, timeout):
        seen.append((request, timeout))
        return FakeResponse()
    monkeypatch.setattr(tg, 'urlopen', fake_open)
    monkeypatch.setenv('TELEGRAM_MINI_APP_URL', 'https://startup.locatermanhass.ru/')
    assert tg.send_message(1234, tg.message_for('offer.sent', '<project>'), 'dummy-test-only')
    req, timeout = seen[0]
    assert req.full_url.endswith('/sendMessage') and timeout == 4
    body = json.loads(req.data)
    assert body['chat_id'] == 1234
    assert '<project>' in body['text']
    assert body['reply_markup']['inline_keyboard'][0][0]['web_app']['url'].startswith('https://')
    assert 'parse_mode' not in body


def test_blocked_bot_and_invalid_url_never_break_delivery(monkeypatch, caplog):
    def forbidden(req, timeout):
        raise HTTPError(req.full_url, 403, 'Forbidden', {}, io.BytesIO(b''))
    monkeypatch.setattr(tg, 'urlopen', forbidden)
    monkeypatch.setenv('TELEGRAM_MINI_APP_URL', 'http://not-secure.invalid/')
    assert tg.send_message(1234, 'Hello', 'SENSITIVE_TOKEN_SHOULD_NOT_BE_LOGGED') is False
    assert 'SENSITIVE_TOKEN_SHOULD_NOT_BE_LOGGED' not in caplog.text


@pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'), reason='Disposable PostgreSQL required')
def test_five_event_notifications_only_after_commit_and_not_on_replay(clients, monkeypatch):
    from sqlalchemy import create_engine, text
    from app import main
    from db_safety import require_disposable_test_database
    from test_integration_postgres import post

    url = require_disposable_test_database(os.environ['TEST_DATABASE_URL'])
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            ids = dict(conn.execute(text('SELECT email,id FROM users')).all())
            for email, telegram_id in [('ivan@example.test', 111), ('maria@example.test', 222), ('alex@example.test', 333)]:
                conn.execute(text('UPDATE users SET telegram_id=:tg WHERE email=:email'),
                             {'tg': telegram_id, 'email': email})
        sent = []
        def inspect_committed_event(event_id):
            # BackgroundTask must see event, recipient notifications, and
            # idempotency receipt ALREADY COMMITTED in its own connection.
            with engine.connect() as conn:
                event = conn.execute(text('SELECT event_type FROM events WHERE id=:id'),
                                     {'id': event_id}).scalar_one()
                recipients = conn.execute(text('''
                    SELECT u.telegram_id FROM notifications n
                    JOIN users u ON u.id=n.recipient_id
                    WHERE n.event_id=:id ORDER BY u.telegram_id'''), {'id': event_id}).scalars().all()
                assert recipients
                sent.append((event, recipients))
        monkeypatch.setattr(main, 'deliver_telegram_event', inspect_committed_event)

        until = (datetime.now(timezone.utc)+timedelta(days=9)).isoformat()
        startup = post(clients['ivan'], '/startups', {'title':'Notification check'})
        assert startup.status_code == 201, startup.text
        sid = startup.json()['id']
        vacancy = post(clients['ivan'], f'/startups/{sid}/vacancies', {
            'title':'Developer', 'positions_count':2, 'application_deadline':until})
        assert vacancy.status_code == 201, vacancy.text
        vid = vacancy.json()['id']
        payload = {'target_type':'vacancy','target_id':vid}
        client, headers = clients['maria']
        idempotent_headers = {**headers,'Idempotency-Key':'telegram-test-key-01'}
        response = client.post('/api/v1/applications',json=payload,headers=idempotent_headers)
        assert response.status_code == 201, response.text
        appid = response.json()['id']
        assert sent == [('application.created',[111])]
        replay = client.post('/api/v1/applications',json=payload,headers=idempotent_headers)
        assert replay.status_code == 201 and replay.headers['Idempotency-Replayed']=='true'
        assert len(sent) == 1

        offer = post(clients['ivan'],f'/applications/{appid}/offers',{'expires_at':until})
        assert offer.status_code == 201, offer.text
        assert sent[-1] == ('offer.sent',[222])
        joined = post(clients['maria'],f"/offers/{offer.json()['id']}/accept")
        assert joined.status_code == 200, joined.text
        assert sent[-1] == ('offer.accept',[111])

        other = post(clients['alex'],'/applications',payload)
        assert other.status_code == 201, other.text
        rejected = post(clients['ivan'],f"/applications/{other.json()['id']}/reject",{'reason':'No capacity'})
        assert rejected.status_code == 200, rejected.text
        assert sent[-1] == ('application.reject',[333])
        invited = post(clients['ivan'],f'/startups/{sid}/recruiter-invitations',{
            'user_id':str(ids['alex@example.test']), 'expires_at':until})
        assert invited.status_code == 201, invited.text
        assert sent[-1] == ('recruiter.invited',[333])
        assert [x[0] for x in sent]==[
            'application.created','offer.sent','offer.accept','application.created',
            'application.reject','recruiter.invited']
        # Failed duplicate command cannot schedule another delivery.
        assert post(clients['alex'],'/applications',payload).status_code == 409
        assert len(sent) == 6
    finally:
        engine.dispose()
