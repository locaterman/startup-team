"""Real PostgreSQL identity/session boundaries, on the existing disposable fixture."""
import os
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine,text
from app.main import app
from test_integration_postgres import clients
from test_telegram_auth import signed,TOKEN

pytestmark=pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'),reason='Disposable PostgreSQL required')


def launch(**kwargs):return signed(stamp=int(time.time()),**kwargs)
def login(client,raw):return client.post('/api/v1/auth/telegram',json={'init_data':raw})


def test_first_login_profile_repeat_and_private_identity(clients,monkeypatch):
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN',TOKEN)
    with TestClient(app) as client:
        raw=launch();first=login(client,raw)
        assert first.status_code==200,first.text
        person=first.json();assert set(person)=={'id','name','bio','skills','portfolio_url'}
        assert 'httponly' in first.headers['set-cookie'].lower()
        assert 'samesite=lax' in first.headers['set-cookie'].lower()
        assert first.headers['cache-control']=='no-store'
        assert client.get('/api/v1/auth/context').json()=={'onboarding_required':True}
        csrf=client.get('/api/v1/auth/csrf').json()['csrf_token']
        assert client.patch('/api/v1/users/me',json={'name':'Имя участника'}).status_code==403
        saved=client.patch('/api/v1/users/me',json={'name':'Имя участника','skills':['Python']},headers={'X-CSRF-Token':csrf})
        assert saved.status_code==200
        assert client.get('/api/v1/auth/context').json()=={'onboarding_required':False}
        again=login(client,'&'.join(reversed(raw.split('&'))))
        assert again.status_code==200 and again.json()['name']=='Имя участника'
        assert 'set-cookie' not in again.headers
        # A new legitimate launch finds the same account and preserves the edited profile.
        fresh=launch(query_id='another-launch')
        assert login(client,fresh).json()['id']==person['id']
        assert client.get('/api/v1/auth/me').json()['name']=='Имя участника'
        public=client.get('/api/v1/users/'+person['id']).json()
        assert 'telegram_id' not in public and 'email' not in public
        assert client.get('/api/v1/auth/csrf').json()['csrf_token']!=csrf


def test_consumed_data_cannot_open_another_session_or_restore_logout(clients,monkeypatch):
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN',TOKEN)
    with TestClient(app) as first,TestClient(app) as other:
        raw=launch();assert login(first,raw).status_code==200
        assert login(other,raw).status_code==409
        assert other.get('/api/v1/auth/me').status_code==401
        csrf=first.get('/api/v1/auth/csrf').json()['csrf_token']
        assert first.post('/api/v1/auth/logout',headers={'X-CSRF-Token':csrf}).status_code==204
        assert login(first,raw).status_code==409
        assert first.get('/api/v1/auth/me').status_code==401


def test_forgery_old_launch_cross_site_and_bad_content_do_not_create_users(clients,monkeypatch):
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN',TOKEN)
    with TestClient(app) as client:
        raw=launch()
        assert login(client,raw.replace('9000000001','9000000002')).status_code==401
        assert login(client,signed(stamp=int(time.time())-600)).status_code==401
        assert client.post('/api/v1/auth/telegram',json={'init_data':raw},headers={'Sec-Fetch-Site':'cross-site'}).status_code==403
        # FastAPI versions may reject a missing JSON content type before the route.
        assert client.post('/api/v1/auth/telegram',content='{"init_data":"x"}').status_code in (415,422)
        assert client.post('/api/v1/auth/telegram',json={'telegram_id':9000000001}).status_code==422
        assert client.get('/api/v1/auth/me').status_code==401
    engine=create_engine(os.environ['TEST_DATABASE_URL'])
    try:
        with engine.connect() as conn:assert conn.execute(text('SELECT count(*) FROM users WHERE telegram_id IS NOT NULL')).scalar()==0
    finally:engine.dispose()


def test_account_name_never_links_to_demo_and_parallel_launches_are_unique(clients,monkeypatch):
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN',TOKEN)
    legacy=clients['ivan'][0].get('/api/v1/auth/me').json()['id']
    def attempt(number):
        with TestClient(app) as client:
            response=login(client,launch(user={'id':9000000001,'first_name':'Ivan'},query_id='launch-'+str(number)))
            assert response.status_code==200,response.text
            return response.json()['id']
    with ThreadPoolExecutor(2) as pool:ids=list(pool.map(attempt,[1,2]))
    assert ids[0]==ids[1] and ids[0]!=legacy
    assert clients['ivan'][0].get('/api/v1/auth/me').json()['id']==legacy


def test_expired_launch_may_only_refresh_its_existing_live_browser_session(clients,monkeypatch):
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN',TOKEN)
    monkeypatch.setenv('TELEGRAM_AUTH_MAX_AGE_SECONDS','3600')
    with TestClient(app) as bound,TestClient(app) as stranger:
        raw=signed(stamp=int(time.time())-600)
        assert login(bound,raw).status_code==200
        monkeypatch.setenv('TELEGRAM_AUTH_MAX_AGE_SECONDS','300')
        assert login(bound,raw).status_code==200
        assert login(stranger,raw).status_code==409
        assert login(stranger,signed(stamp=int(time.time())-600,query_id='unused')).status_code==401
        # A different user's fresh login must not collect a still-live session binding.
        assert login(stranger,launch(user={'id':9000000002,'first_name':'Other'})).status_code==200
        assert login(bound,raw).status_code==200


def test_unconfigured_bot_and_disabled_demo_are_explicit(clients,monkeypatch):
    monkeypatch.delenv('TELEGRAM_BOT_TOKEN_FILE',raising=False)
    monkeypatch.delenv('TELEGRAM_BOT_TOKEN',raising=False)
    monkeypatch.setenv('ALLOW_DEMO_LOGIN','false')
    with TestClient(app) as client:
        assert client.get('/api/v1/auth/config').json()=={'telegram_enabled':False,'demo_enabled':False}
        assert login(client,launch()).status_code==503
        assert client.post('/api/v1/auth/login',json={'email':'ivan@example.test','password':'pw-ivan'}).status_code==403
