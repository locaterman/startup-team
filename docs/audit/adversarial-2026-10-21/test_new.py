import os,time
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine,text
from datetime import datetime,timedelta,timezone
from test_integration_postgres import clients,post
from test_telegram_auth import signed,TOKEN
from app.main import app

def future():return (datetime.now(timezone.utc)+timedelta(days=2)).isoformat()
def setup(c):
 s=post(c['ivan'],'/startups',{'title':'Audit'}).json()['id']
 v=post(c['ivan'],f'/startups/{s}/vacancies',{'title':'Role','positions_count':1,'application_deadline':future()}).json()['id']
 a=post(c['maria'],'/applications',{'target_type':'vacancy','target_id':v}).json()['id']
 return s,v,a

def test_onboarding_bypass(clients,monkeypatch):
 monkeypatch.setenv('TELEGRAM_BOT_TOKEN',TOKEN)
 with TestClient(app) as c:
  assert c.post('/api/v1/auth/telegram',json={'init_data':signed(stamp=int(time.time()))}).status_code==200
  h={'X-CSRF-Token':c.get('/api/v1/auth/csrf').json()['csrf_token']}
  assert c.get('/api/v1/auth/context').json()['onboarding_required']
  r=c.post('/api/v1/startups',json={'title':'Without onboarding'},headers=h)
  print('ONBOARDING_BYPASS',r.status_code,'onboarding_required',c.get('/api/v1/auth/context').json()['onboarding_required'])
  assert r.status_code==201

def test_withdrawn_critical_old_submission_revives(clients):
 s,v,a=setup(clients)
 def task(kind):return post(clients['ivan'],f'/vacancies/{v}/tests/versions',{'description':kind,'submission_deadline':future(),'change_type':kind}).json()['id']
 t=task('initial')
 sub=post(clients['maria'],f'/applications/{a}/test-submissions',{'test_version_id':t,'solution_url':'https://example.org/old'}).json()['id']
 c,h=clients['ivan'];assert c.patch('/api/v1/test-submissions/'+sub,json={'status':'reviewed'},headers=h).status_code==200
 assert post(clients['maria'],f'/applications/{a}/withdraw').status_code==200
 task('critical')
 assert post(clients['maria'],f'/applications/{a}/restore').status_code==200
 rows=clients['maria'][0].get(f'/api/v1/applications/{a}/test-submissions').json()['items']
 print('WITHDRAWN_CRITICAL_RESTORE',[(x['status'],x['test_version_id']==t) for x in rows])
 assert rows[0]['status']=='reviewed'

def test_repeated_solution_api(clients):
 s,v,a=setup(clients)
 t=post(clients['ivan'],f'/vacancies/{v}/tests/versions',{'description':'Task','submission_deadline':future(),'change_type':'initial'}).json()['id']
 first=post(clients['maria'],f'/applications/{a}/test-submissions',{'test_version_id':t,'solution_url':'https://example.org/one'})
 second=post(clients['maria'],f'/applications/{a}/test-submissions',{'test_version_id':t,'solution_url':'https://example.org/two'})
 print('REPEAT_SOLUTION',first.status_code,second.status_code,second.json()['error']['code'])
 assert second.status_code==409

def test_large_capacity_error(clients):
 s=post(clients['ivan'],'/startups',{'title':'Capacity'}).json()['id']
 c,h=clients['ivan'];bad=TestClient(app,raise_server_exceptions=False);bad.cookies.update(c.cookies)
 r=bad.post(f'/api/v1/startups/{s}/vacancies',json={'title':'Large','positions_count':2147483648,'application_deadline':future()},headers=h)
 print('INT_OVERFLOW',r.status_code,r.text)
 assert r.status_code==500

def test_expired_recruiter_mine_stays_pending(clients):
 s,v,a=setup(clients)
 u=clients['alex'][0].get('/api/v1/auth/me').json()['id']
 inv=post(clients['ivan'],f'/startups/{s}/recruiter-invitations',{'user_id':u,'expires_at':future()}).json()['id']
 e=create_engine(os.environ['TEST_DATABASE_URL'])
 with e.begin() as c:c.execute(text("UPDATE recruiter_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=:i"),{'i':inv})
 e.dispose()
 r=post(clients['alex'],f'/recruiter-invitations/{inv}/accept')
 data=clients['alex'][0].get('/api/v1/recruiter-invitations/mine').json()['items']
 print('EXPIRED_RECRUITER',r.status_code,data[0]['status'])
 assert r.status_code==409 and data[0]['status']=='pending'
