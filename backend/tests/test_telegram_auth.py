"""Offline cryptographic cases; no real bot, account, network or token required."""
import hashlib
import hmac
import json
from urllib.parse import urlencode

import pytest
from fastapi import HTTPException
from app.telegram_auth import validate_init_data

TOKEN = '123456:offline-test-token-not-a-real-credential'
STAMP = 1800000000


def signed(user=None, stamp=STAMP, **extra):
    fields = {'auth_date':str(stamp), 'user':json.dumps(
        {'id':9000000001,'first_name':'Анна','last_name':'Тест + & ='} if user is None else user,
        ensure_ascii=False, separators=(',', ':')), 'query_id':'offline-launch', **extra}
    # Telegram's specified HMAC protocol. No validation implementation is called.
    secret = hmac.digest(b'WebAppData', TOKEN.encode(), 'sha256')
    fields['hash'] = hmac.new(secret, '\n'.join(k+'='+fields[k] for k in sorted(fields)).encode(), hashlib.sha256).hexdigest()
    return urlencode(fields)


def test_unicode_signature_and_canonical_replay_identity():
    raw=signed(signature='signed-extra-field')
    identity=validate_init_data(raw,TOKEN,current_time=STAMP+1)
    assert identity.telegram_id==9000000001 and identity.name=='Анна Тест + & ='
    reordered='&'.join(reversed(raw.split('&')))
    assert validate_init_data(reordered,TOKEN,current_time=STAMP+1)==identity


@pytest.mark.parametrize('change', [
    lambda raw:raw.replace('9000000001','9000000002'),
    lambda raw:raw+'&auth_date=1800000000',
    lambda raw:raw+'&user=%7B%7D',
    lambda raw:raw.replace('hash=','hash=zz'),
    lambda raw:raw.replace('user=','user=%FF'),
    lambda raw:raw+'&broken=%ZZ',
    lambda raw:raw.split('&hash=')[0],
    lambda raw:'',
    lambda raw:'a='+('x'*17000),
])
def test_untrusted_payloads_fail_closed(change):
    with pytest.raises(HTTPException) as err:
        validate_init_data(change(signed()),TOKEN,current_time=STAMP+1)
    assert err.value.status_code==401


@pytest.mark.parametrize('user', [
    {'id':True,'first_name':'Name'}, {'id':-1,'first_name':'Name'},
    {'id':'9000000001','first_name':'Name'}, {'id':1.5,'first_name':'Name'},
    {'id':2**52,'first_name':'Name'}, {'id':1,'first_name':' '},
    {'id':1,'first_name':'Name','is_bot':True}, [],
])
def test_signed_but_invalid_identity_rejected(user):
    with pytest.raises(HTTPException):validate_init_data(signed(user),TOKEN,current_time=STAMP+1)


def test_wrong_token_expiry_future_and_no_configuration():
    for token,timestamp,code in [(TOKEN+'wrong',STAMP+1,401),(TOKEN,STAMP+301,401),
                                  (TOKEN,STAMP-31,401),('',STAMP+1,503)]:
        with pytest.raises(HTTPException) as err:validate_init_data(signed(),token,current_time=timestamp)
        assert err.value.status_code==code
    assert validate_init_data(signed(),TOKEN,current_time=STAMP+300).telegram_id==9000000001
