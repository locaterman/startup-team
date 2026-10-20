"""Destructive against TEST_DATABASE_URL; never point at the demo database.
Run after applying migration on separate startup_test database.
"""
import os, uuid, pytest
pytestmark=pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'), reason='Requires migrated separate PostgreSQL TEST_DATABASE_URL')

@pytest.fixture
def clients():
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine,text
    from app.main import app
    from app.database import db
    from app.security import hash_password
    url=os.environ['TEST_DATABASE_URL']
    if 'startup_test' not in url:
        pytest.fail('Safety: TEST_DATABASE_URL must refer to startup_test database')
    engine=create_engine(url,pool_pre_ping=True)
    with engine.begin() as conn:
        for table in ['idempotency_keys','notifications','events','test_submissions','test_assignment_versions',
             'recruiter_grants','recruiter_invitations','startup_members','offers','application_attempts',
             'applications','vacancy_versions','vacancies','startups','sessions','users']:
            conn.execute(text(f'TRUNCATE TABLE {table} CASCADE'))
        for email,name,pw in [('ivan@example.test','Ivan','pw-ivan'),('maria@example.test','Maria','pw-maria'),('alex@example.test','Alex','pw-alex')]:
            conn.execute(text('INSERT INTO users(email,name,password_hash) VALUES(:e,:n,:h)'),
                  dict(e=email,n=name,h=hash_password(pw)))
    def override():
        with engine.begin() as conn:yield conn
    app.dependency_overrides[db]=override
    users={}
    try:
        for name in ['ivan','maria','alex']:
            client=TestClient(app)
            resp=client.post('/api/v1/auth/login',json={'email':f'{name}@example.test','password':f'pw-{name}'})
            assert resp.status_code==200,resp.text
            token=client.get('/api/v1/auth/csrf').json()['csrf_token']
            users[name]=(client,{'X-CSRF-Token':token})
        yield users
    finally:
        for client,_ in users.values():client.close()
        app.dependency_overrides.clear()
        engine.dispose()

def post(pair,path,body=None):
    client,headers=pair
    return client.post('/api/v1'+path,json=body,headers=headers)

def test_primary_scenario_and_capacity(clients):
    from datetime import datetime,timedelta,timezone
    until=(datetime.now(timezone.utc)+timedelta(days=10)).isoformat()
    p=post(clients['ivan'],'/startups',{'title':'Demo startup','description':'Demo','allow_general_applications':True})
    assert p.status_code==201,p.text
    sid=p.json()['id']
    v=post(clients['ivan'],f'/startups/{sid}/vacancies',{'title':'Python dev','description':'API','requirements':'Python','positions_count':1,'application_deadline':until})
    assert v.status_code==201,v.text
    vid=v.json()['id']
    candidate=post(clients['maria'],'/applications',{'target_type':'vacancy','target_id':vid,'message':'I can help'})
    assert candidate.status_code==201,candidate.text
    aid=candidate.json()['id']
    dupe=post(clients['maria'],'/applications',{'target_type':'vacancy','target_id':vid})
    assert dupe.status_code==409
    denied=clients['alex'][0].get(f'/api/v1/applications/{aid}')
    assert denied.status_code in (403,404)
    review=post(clients['ivan'],f'/applications/{aid}/review')
    assert review.status_code==200 and review.json()['status']=='reviewing'
    offer=post(clients['ivan'],f'/applications/{aid}/offers',{'expires_at':until,'message':'Join us'})
    assert offer.status_code==201,offer.text
    oid=offer.json()['id']
    cap=clients['ivan'][0].get(f'/api/v1/vacancies/{vid}/capacity').json()
    assert cap['reserved']==1 and cap['available']==0
    joined=post(clients['maria'],f'/offers/{oid}/accept')
    assert joined.status_code==200 and joined.json()['status']=='accepted'
    after=clients['ivan'][0].get(f'/api/v1/vacancies/{vid}/capacity').json()
    assert after['occupied']==1 and after['reserved']==0 and after['available']==0
    record=clients['maria'][0].get('/api/v1/applications/mine').json()['items'][0]
    assert record['status']=='joined'
