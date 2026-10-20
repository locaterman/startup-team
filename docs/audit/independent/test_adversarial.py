"""Independent audit probes. Run ONLY in disposable PostgreSQL via run.py.

Defect probes assert the observed defect, not the desired fixed behavior.
"""
import os, sys, time, threading
from pathlib import Path
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
import pytest
from sqlalchemy import create_engine, text
sys.path.insert(0, str(Path('/app/backend/tests')))
from test_integration_postgres import clients, post

pytestmark=pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'),reason='Run only through the disposable independent audit runner')

@pytest.fixture(autouse=True)
def audit_database_only():
    from sqlalchemy.engine import make_url
    url=make_url(os.environ['TEST_DATABASE_URL'])
    if url.database!='startup_test_independent' or not url.drivername.startswith('postgresql'):
        pytest.fail('Independent probes require disposable startup_test_independent, never the demo database')

def future(): return (datetime.now(timezone.utc)+timedelta(days=5)).isoformat()
def sql(q, **kw):
    engine=create_engine(os.environ['TEST_DATABASE_URL'])
    try:
        with engine.begin() as c:
            r=c.execute(text(q),kw)
            return [dict(x) for x in r.mappings()] if r.returns_rows else []
    finally: engine.dispose()
def get(p,path): return p[0].get('/api/v1'+path)
def patch(p,path,body): return p[0].patch('/api/v1'+path,json=body,headers=p[1])
def make(clients, count=2):
    owner, candidate, other=[clients[n] for n in ('ivan','maria','alex')]
    s=post(owner,'/startups',{'title':'Audit','description':'Original terms'}).json()['id']
    v=post(owner,f'/startups/{s}/vacancies',{'title':'Python','description':'Original','requirements':'Python','positions_count':count,'application_deadline':future()}).json()['id']
    a=post(candidate,'/applications',{'target_type':'vacancy','target_id':v,'message':'ORIGINAL LETTER'}).json()['id']
    return owner,candidate,other,s,v,a
def offer(owner,a):
    r=post(owner,f'/applications/{a}/offers',{'expires_at':future(),'message':'PRIVATE OFFER TERMS'})
    assert r.status_code==201,r.text
    return r.json()['id']
def version(owner,v,mode='reset_applications'):
    return post(owner,f'/vacancies/{v}/versions',{'title':'Java','description':'New','requirements':'Java','change_mode':mode})
def task(owner,v,kind='initial'):
    r=post(owner,f'/vacancies/{v}/tests/versions',{'description':kind,'submission_deadline':future(),'change_type':kind})
    assert r.status_code==201,r.text
    return r.json()['id']

def test_A01_offers_mine_shadowed(clients):
    r=get(clients['maria'],'/offers/mine')
    assert r.status_code==422 and 'offer_id' in r.text
    print('A01',r.status_code,r.text)

def test_A02_retry_create_and_reset_are_not_idempotent(clients):
    p=clients['ivan']; p[1]['Idempotency-Key']='same-key-12345'
    body={'title':'same command','description':'same'}
    one=post(p,'/startups',body); two=post(p,'/startups',body)
    assert one.status_code==two.status_code==201 and one.json()['id']!=two.json()['id']
    o,c,_,s,v,a=make(clients)
    assert version(o,v).status_code==201
    assert post(c,f'/applications/{a}/attempts',{'message':'new'}).status_code==201
    assert version(o,v).status_code==201
    assert get(c,f'/applications/{a}').json()['status']=='reset'
    assert len(get(o,f'/vacancies/{v}/versions').json()['items'])==3
    print('A02 duplicate creation; retried reset cancelled a newly submitted attempt')

def test_A03_history_and_terms_inaccessible(clients):
    o,c,_,s,v,a=make(clients)
    old=get(c,f'/applications/{a}').json()['attempt_id']
    version(o,v); post(c,f'/applications/{a}/attempts',{'message':'NEW LETTER'})
    current=get(c,f'/applications/{a}').json()
    history=get(c,f'/applications/{a}/history').json()
    assert 'ORIGINAL LETTER' not in str(current)+str(history)
    assert 'vacancy_version_id' not in current
    assert sql('SELECT message FROM application_attempts WHERE id=:id',id=old)[0]['message']=='ORIGINAL LETTER'
    oid=offer(o,a); payload=get(c,f'/offers/{oid}').json()
    assert 'message' not in payload and 'vacancy_version_id' not in payload and 'attempt_id' not in payload
    assert post(o,f'/offers/{oid}/revoke').status_code==200
    assert post(o,f'/applications/{a}/reject',{'reason':'SPECIFIC REJECTION REASON'}).status_code==200
    assert not sql("SELECT id FROM events WHERE CAST(metadata AS text) LIKE '%SPECIFIC REJECTION REASON%'")
    print('A03 old letter exists only in DB; offer message/version omitted; rejection reason never saved')

def test_A04_expiry_rollback_and_stale_reads(clients):
    o,c,_,s,v,a=make(clients); oid=offer(o,a)
    sql("UPDATE offers SET expires_at=clock_timestamp()-interval '1 second' WHERE id=:id",id=oid)
    r=post(c,f'/offers/{oid}/accept')
    assert r.status_code==409
    assert sql('SELECT status FROM offers WHERE id=:id',id=oid)[0]['status']=='pending'
    assert get(c,f'/applications/{a}').json()['status']=='offer_pending'
    # Any unrelated logged-in account can invoke a GET which commits expiry.
    assert get(clients['alex'],f'/vacancies/{v}/capacity').status_code==200
    assert sql('SELECT status FROM offers WHERE id=:id',id=oid)[0]['status']=='expired'
    assert get(c,f'/applications/{a}').json()['status']=='reviewing'
    print('A04 failed acceptance rolled back lazy expiry; unrelated GET committed it')

@pytest.mark.parametrize('body',[{'name':None},{'name':'x'*121},{'bio':None},{'skills':None}])
def test_A05_invalid_profile_is_500(clients,body):
    from fastapi.testclient import TestClient
    from app.main import app
    original=clients['maria']; client=TestClient(app,raise_server_exceptions=False)
    client.cookies.update(original[0].cookies); p=(client,original[1])
    r=patch(p,'/users/me',body)
    assert r.status_code==500,r.text
    print('A05',body,r.status_code,r.text)

def test_A06_pagination_and_optimistic_lock_ignored(clients):
    p=clients['ivan']
    for i in range(3): post(p,'/startups',{'title':str(i)})
    r=get(p,'/startups?limit=1&cursor=invalid').json()
    assert len(r['items'])==3 and r['next_cursor'] is None
    sid=r['items'][0]['id']; p[1]['If-Match']='"0"'
    r=patch(p,f'/startups/{sid}',{'title':'stale writer','unknown_property':123})
    assert r.status_code==200
    sql("INSERT INTO startups(owner_id,title) SELECT :u,'bulk '||n FROM generate_series(1,101) AS n",u=get(p,'/auth/me').json()['id'])
    page=get(p,'/startups').json()
    assert len(page['items'])==100 and page['next_cursor'] is None
    assert sid not in {row['id'] for row in page['items']}
    print('A06 limit/cursor/If-Match/unknown fields ignored; 104 startups -> only 100 reachable in feed')

def test_A07_critical_review_lies_and_offer_pending_cannot_submit(clients):
    o,c,_,s,v,a=make(clients); t=task(o,v)
    r=post(c,f'/applications/{a}/test-submissions',{'test_version_id':t,'solution_url':'https://example.test/old'})
    sub=r.json()['id']; task(o,v,'critical')
    r=patch(o,f'/test-submissions/{sub}',{'status':'reviewed'})
    assert r.status_code==200 and r.json()['status']=='superseded'
    assert sql("SELECT id FROM events WHERE entity_id=:s AND event_type='test.reviewed'",s=sub)
    oid=offer(o,a); latest=task(o,v,'critical')
    r=post(c,f'/applications/{a}/test-submissions',{'test_version_id':latest,'solution_url':'https://example.test/new'})
    assert r.status_code==409 and 'APPLICATION_NOT_ACTIVE' in r.text
    print('A07 review emitted success event without change; pending-offer candidate cannot submit critical replacement')

def test_A08_public_former_membership_history(clients):
    o,c,other,s,v,a=make(clients); oid=offer(o,a)
    post(c,f'/offers/{oid}/accept'); post(c,f'/startups/{s}/members/leave')
    r=get(other,f'/startups/{s}/members')
    assert r.status_code==200 and r.json()['items'][0]['left_at'] is not None
    print('A08 unrelated account sees membership id/user/join and departure timestamps')

def test_A09_db_capacity_and_parent_mutation_bypass(clients):
    o,c,other,s,v,a=make(clients,1); oid=offer(o,a)
    b=post(other,'/applications',{'target_type':'vacancy','target_id':v}).json()['id']
    bt=get(other,f'/applications/{b}').json()['attempt_id']; owner=get(o,'/auth/me').json()['id']; otherid=get(other,'/auth/me').json()['id']
    sql('''INSERT INTO offers(attempt_id,startup_id,candidate_id,vacancy_id,vacancy_version_id,expires_at,created_by)
      SELECT :at,:s,:u,:v,vacancy_version_id,now()+interval '1 day',:o FROM application_attempts WHERE id=:at''',at=bt,s=s,u=otherid,v=v,o=owner)
    assert get(o,f'/vacancies/{v}/capacity').json()['available']==-1
    s2=post(o,'/startups',{'title':'Other'}).json()['id']
    sql('UPDATE vacancies SET startup_id=:s WHERE id=:v',s=s2,v=v) if False else None
    # A version's reason and attribution are not included in immutable triggers.
    sql("UPDATE vacancy_versions SET reason='rewritten',created_by=:u WHERE vacancy_id=:v",u=otherid,v=v)
    assert sql('SELECT reason FROM vacancy_versions WHERE vacancy_id=:v',v=v)[0]['reason']=='rewritten'
    print('A09 direct SQL overbooks capacity; historical version reason/author mutable (no demonstrated API bypass)')

def test_A10_reapplication_to_competing_attempt_dead_end(clients):
    o,c,_,s,v,a=make(clients)
    other_v=post(o,f'/startups/{s}/vacancies',{'title':'Other role','positions_count':1,'application_deadline':future()}).json()['id']
    general=post(c,'/applications',{'target_type':'vacancy','target_id':other_v}).json()['id']
    oid=offer(o,a); post(c,f'/offers/{oid}/accept'); post(c,f'/startups/{s}/members/leave')
    assert get(c,f'/applications/{general}').json()['status']=='already_joined'
    r=post(c,f'/applications/{general}/attempts',{'message':'returning'})
    assert r.status_code==409
    print('A10 competing already_joined application cannot reapply after departure (product rule ambiguity)')

def test_A11_general_application_500(clients):
    from fastapi.testclient import TestClient
    from app.main import app
    o,c,_,s,v,a=make(clients)
    client=TestClient(app,raise_server_exceptions=False);client.cookies.update(c[0].cookies)
    r=post((client,c[1]),'/applications',{'target_type':'startup','target_id':s,'message':'hello'})
    assert r.status_code==500,r.text
    assert not sql('SELECT id FROM applications WHERE startup_id=:s AND vacancy_id IS NULL',s=s)
    print('A11 general startup application ->',r.status_code,r.text,'no application committed')

def test_A12_read_contract_and_notifications(clients):
    o,c,_,s,v,a=make(clients);t=task(o,v)
    listing=get(c,f'/vacancies/{v}/tests/versions').json()['items'][0]
    extra=set(listing)-{'id','vacancy_id','version','description','submission_deadline','change_type'}
    assert {'reason','created_by','created_at'}<=extra
    offer(o,a)
    assert get(c,'/notifications').json()['items']==[]
    print('A12 test list violates additionalProperties=false:',sorted(extra),'; no notification after offer')

def test_A13_recruiter_can_revoke_own_offer(clients):
    o,c,_,s,v,a=make(clients);oid=offer(o,a)
    uid=get(c,'/auth/me').json()['id']
    inv=post(o,f'/startups/{s}/recruiter-invitations',{'user_id':uid,'expires_at':future()}).json()['id']
    assert post(c,f'/recruiter-invitations/{inv}/accept').status_code==200
    r=post(c,f'/offers/{oid}/revoke')
    assert r.status_code==200 and r.json()['status']=='revoked'
    assert get(c,f'/applications/{a}').json()['status']=='reviewing'
    print('A13 candidate + recruiter revokes own offer as manager, returns own application to reviewing instead of terminal declined')

def test_A14_own_publications_disappear_from_cabinet_source(clients):
    o,c,_,s,v,a=make(clients)
    assert post(o,f'/startups/{s}/pause').status_code==200
    assert s not in {row['id'] for row in get(o,'/startups').json()['items']}
    assert get(o,f'/startups/{s}').json()['status']=='paused'
    assert post(o,f'/startups/{s}/archive').status_code==200
    assert s not in {row['id'] for row in get(o,'/startups').json()['items']}
    print('A14 owner cabinet derives own list from feed; paused/archived project exists but absent from feed')

@pytest.mark.parametrize('condition',['paused','vacancy_archived','intake_expired'])
def test_independent_deadlines_and_historic_join(clients,condition):
    o,c,other,s,v,a=make(clients);oid=offer(o,a)
    if condition=='paused':post(o,f'/startups/{s}/pause')
    elif condition=='vacancy_archived':post(o,f'/vacancies/{v}/archive')
    else:sql("UPDATE vacancies SET application_deadline=clock_timestamp()-interval '1 second' WHERE id=:v",v=v)
    assert post(other,'/applications',{'target_type':'vacancy','target_id':v}).status_code==409
    assert post(c,f'/offers/{oid}/accept').status_code==200
    if condition=='paused':post(o,f'/startups/{s}/resume')
    assert post(c,f'/startups/{s}/members/leave').status_code==204
    if condition=='paused':
        old=get(c,f'/applications/{a}').json()['attempt_id']
        assert post(c,f'/applications/{a}/attempts',{'message':'returning'}).status_code==201
        assert sql('SELECT status FROM application_attempts WHERE id=:id',id=old)[0]['status']=='joined'
    print('TIME',condition,'blocks new applications but allows existing offer acceptance; joined history preserved')

def test_authorization_matrix_and_sessions(clients):
    from fastapi.testclient import TestClient
    from app.main import app
    o,c,x,s,v,a=make(clients);t=task(o,v)
    sub=post(c,f'/applications/{a}/test-submissions',{'test_version_id':t,'solution_url':'https://example.test/solution'}).json()['id']
    oid=offer(o,a)
    private=[f'/applications/{a}',f'/applications/{a}/history',f'/applications/{a}/test-submissions',f'/offers/{oid}',f'/startups/{s}/applications',f'/startups/{s}/events',f'/startups/{s}/recruiters',f'/vacancies/{v}/tests/versions']
    assert all(get(x,p).status_code==403 for p in private)
    assert all(get((TestClient(app),{}),p).status_code==401 for p in private)
    assert x[0].post('/api/v1/startups',json={'title':'csrf missing'}).status_code==403
    assert post(o,'/applications',{'target_type':'vacancy','target_id':v}).status_code==403
    uid=get(x,'/auth/me').json()['id']
    inv=post(o,f'/startups/{s}/recruiter-invitations',{'user_id':uid,'expires_at':future()}).json()['id']
    assert post(x,f'/recruiter-invitations/{inv}/accept').status_code==200
    assert all(get(x,p).status_code==200 for p in private)
    own=post(x,'/applications',{'target_type':'vacancy','target_id':v}).json()['id']
    assert post(x,f'/applications/{own}/review').status_code==403
    assert post(x,f'/applications/{own}/offers',{'expires_at':future()}).status_code==403
    assert o[0].delete('/api/v1'+f'/startups/{s}/recruiters/{uid}',headers=o[1]).status_code==204
    # Revoked recruiter is still an applicant and retains access to public task versions.
    assert all(get(x,p).status_code==403 for p in private[:-1])
    assert get(x,private[-1]).status_code==200
    post(c,f'/offers/{oid}/accept')
    boid=offer(o,own)
    assert get(c,f'/applications/{own}').status_code==403
    assert get(c,f'/offers/{boid}').status_code==403
    post(c,f'/startups/{s}/members/leave')
    assert get(c,f'/applications/{own}').status_code==403
    saved=dict(x[0].cookies)
    assert post(x,'/auth/logout').status_code==204
    x[0].cookies.update(saved)
    assert get(x,'/auth/me').status_code==401
    sql("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=:u",u=get(c,'/auth/me').json()['id'])
    assert get(c,'/auth/me').status_code==401
    print('RBAC unauth/outsider/candidate/member/former/recruiter/revoked/owner checked; CSRF/logout/expiry enforced')

def wait_for_waiters(n):
    until=time.monotonic()+5
    while time.monotonic()<until:
        rows=sql("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")
        if len(rows)>=n:return
        time.sleep(.02)
    raise AssertionError(f'Expected {n} independent blocked transactions')

@pytest.mark.parametrize('kind',['last_seat','accept_revoke','accept_archive','expiry','lower_invite','leave_invite','version_apply','reset_resubmit','revoke_edit','critical_submit'])
@pytest.mark.parametrize('reverse',[False,True])
def test_controlled_concurrency(clients,kind,reverse):
    o,c,other,s,v,a=make(clients,1 if kind in ('last_seat','lower_invite','leave_invite') else 2)
    oid=None; extra=None
    if kind in ('accept_revoke','accept_archive','expiry','leave_invite'):
        oid=offer(o,a)
    if kind in ('last_seat','lower_invite','leave_invite'):
        extra=post(other,'/applications',{'target_type':'vacancy','target_id':v}).json()['id']
    if kind=='lower_invite': patch(o,f'/vacancies/{v}/settings',{'positions_count':2})
    if kind=='lower_invite': offer(o,a)
    if kind=='leave_invite': post(c,f'/offers/{oid}/accept')
    if kind=='reset_resubmit': version(o,v)
    if kind=='revoke_edit':
        uid=get(other,'/auth/me').json()['id']
        inv=post(o,f'/startups/{s}/recruiter-invitations',{'user_id':uid,'expires_at':future()}).json()['id']
        post(other,f'/recruiter-invitations/{inv}/accept')
    if kind=='critical_submit': t=task(o,v)
    commands={
      'last_seat':(lambda:post(o,f'/applications/{a}/offers',{'expires_at':future()}),lambda:post(o,f'/applications/{extra}/offers',{'expires_at':future()})),
      'accept_revoke':(lambda:post(c,f'/offers/{oid}/accept'),lambda:post(o,f'/offers/{oid}/revoke')),
      'accept_archive':(lambda:post(c,f'/offers/{oid}/accept'),lambda:post(o,f'/startups/{s}/archive')),
      'expiry':(lambda:post(c,f'/offers/{oid}/accept'),lambda:get(o,f'/vacancies/{v}/capacity')),
      'lower_invite':(lambda:patch(o,f'/vacancies/{v}/settings',{'positions_count':1}),lambda:post(o,f'/applications/{extra}/offers',{'expires_at':future()})),
      'leave_invite':(lambda:post(c,f'/startups/{s}/members/leave'),lambda:post(o,f'/applications/{extra}/offers',{'expires_at':future()})),
      'version_apply':(lambda:version(o,v),lambda:post(other,'/applications',{'target_type':'vacancy','target_id':v})),
      'reset_resubmit':(lambda:version(o,v),lambda:post(c,f'/applications/{a}/attempts',{'message':'new'})),
      'revoke_edit':(lambda:o[0].delete('/api/v1'+f'/startups/{s}/recruiters/{uid}',headers=o[1]),lambda:version(other,v)),
      'critical_submit':(lambda:post(o,f'/vacancies/{v}/tests/versions',{'description':'new','submission_deadline':future(),'change_type':'critical'}),lambda:post(c,f'/applications/{a}/test-submissions',{'test_version_id':t,'solution_url':'https://example.test/solution'})),
    }
    first,second=commands[kind]
    if reverse:first,second=second,first
    engine=create_engine(os.environ['TEST_DATABASE_URL'])
    with ThreadPoolExecutor(2) as pool:
        with engine.connect() as gate:
            tx=gate.begin();gate.execute(text('SELECT id FROM startups WHERE id=:s FOR UPDATE'),{'s':s})
            try:
                f1=pool.submit(first);wait_for_waiters(1)
                f2=pool.submit(second);wait_for_waiters(2)
                if kind=='expiry':gate.execute(text("UPDATE offers SET expires_at=clock_timestamp()-interval '1 second' WHERE id=:o"),{'o':oid})
            finally:tx.commit()
        r1,r2=f1.result(10),f2.result(10)
    engine.dispose()
    cap=get(o,f'/vacancies/{v}/capacity').json()
    assert cap['available']>=0,cap
    state=sql('''SELECT o.status AS offer,at.status AS attempt,
      (SELECT count(*) FROM startup_members sm WHERE sm.joined_via_offer_id=o.id AND sm.left_at IS NULL) AS active_members
      FROM offers o JOIN application_attempts at ON at.id=o.attempt_id WHERE o.startup_id=:s''',s=s)
    for row in state:
        if row['offer']=='pending':assert row['attempt']=='offer_pending'
        if row['active_members']:assert row['offer']=='accepted' and row['attempt']=='joined'
    if kind=='revoke_edit' and not reverse:assert r2.status_code==403
    if kind=='critical_submit':
        subs=sql('SELECT status FROM test_submissions')
        assert all(x['status']=='superseded' for x in subs)
    if kind=='version_apply':
        current=sql('''SELECT at.status,vv.version FROM application_attempts at JOIN applications ap ON ap.id=at.application_id
          JOIN vacancy_versions vv ON vv.id=at.vacancy_version_id WHERE ap.applicant_id=:u AND ap.vacancy_id=:v''',u=get(other,'/auth/me').json()['id'],v=v)[0]
        assert current==({'status':'reset','version':1} if reverse else {'status':'pending','version':2})
    if kind=='reset_resubmit':
        assert get(c,f'/applications/{a}').json()['status']==('reset' if reverse else 'pending')
    print('RACE',kind,'reverse=',reverse,'HTTP=',r1.status_code,r2.status_code,'capacity=',cap,'offers=',state)
