"""Desired behavior after independent review. Only run on a disposable DB."""
import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from test_integration_postgres import clients, post

pytestmark = pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'), reason='Requires disposable PostgreSQL')

def future():
    return (datetime.now(timezone.utc)+timedelta(days=5)).isoformat()

def get(pair, path):
    return pair[0].get('/api/v1'+path)

def patch(pair, path, body):
    return pair[0].patch('/api/v1'+path,json=body,headers=pair[1])

def sql(query, **params):
    from sqlalchemy.engine import make_url
    url=make_url(os.environ['TEST_DATABASE_URL'])
    assert url.drivername.startswith('postgresql') and url.database.startswith('startup_test_')
    engine=create_engine(url)
    try:
        with engine.begin() as conn:
            result=conn.execute(text(query),params)
            return [dict(r) for r in result.mappings()] if result.returns_rows else []
    finally:
        engine.dispose()

def setup(clients):
    owner,candidate,other=[clients[n] for n in ('ivan','maria','alex')]
    response=post(owner,'/startups',{'title':'Review regression'})
    assert response.status_code==201,response.text
    sid=response.json()['id']
    response=post(owner,f'/startups/{sid}/vacancies',{'title':'Developer','positions_count':1,'application_deadline':future()})
    assert response.status_code==201,response.text
    vid=response.json()['id']
    response=post(candidate,'/applications',{'target_type':'vacancy','target_id':vid,'message':'I can help'})
    assert response.status_code==201,response.text
    return owner,candidate,other,sid,vid,response.json()['id']

def invite(owner,aid):
    response=post(owner,f'/applications/{aid}/offers',{'expires_at':future()})
    assert response.status_code==201,response.text
    return response.json()['id']

def test_cabinet_lists_and_candidate_result(clients):
    o,c,_,s,v,a=setup(clients)
    assert get(o,f'/startups/{s}/applications').json()['items'][0]['id']==a
    oid=invite(o,a)
    listing=get(c,'/offers/mine')
    assert listing.status_code==200,listing.text
    assert listing.json()['items'][0]['id']==oid
    assert post(c,f'/offers/{oid}/accept').status_code==200
    assert get(c,'/applications/mine').json()['items'][0]['status']=='joined'

def test_general_application_and_duplicate(clients):
    o,c,_,s,v,a=setup(clients)
    body={'target_type':'startup','target_id':s}
    response=post(c,'/applications',body)
    assert response.status_code==201,response.text
    assert response.json()['vacancy_id'] is None
    duplicate=post(c,'/applications',body)
    assert duplicate.status_code==409
    assert duplicate.json()['error']['code']=='APPLICATION_ALREADY_EXISTS'

@pytest.mark.parametrize('candidate_action',['accept','decline'])
def test_recruiter_cannot_revoke_own_offer_but_can_decide_as_candidate(clients,candidate_action):
    o,c,_,s,v,a=setup(clients);oid=invite(o,a)
    uid=get(c,'/auth/me').json()['id']
    invitation=post(o,f'/startups/{s}/recruiter-invitations',{'user_id':uid,'expires_at':future()})
    assert invitation.status_code==201,invitation.text
    assert post(c,f"/recruiter-invitations/{invitation.json()['id']}/accept").status_code==200
    forbidden=post(c,f'/offers/{oid}/revoke')
    assert forbidden.status_code==403
    assert forbidden.json()['error']['code']=='SELF_REVIEW_FORBIDDEN'
    assert get(c,f'/offers/{oid}').json()['status']=='pending'
    assert get(c,f'/applications/{a}').json()['status']=='offer_pending'
    response=post(c,f'/offers/{oid}/{candidate_action}')
    assert response.status_code==200,response.text

@pytest.mark.parametrize('body',[
    {'name':None},{'name':'x'*121},{'name':'   '},{'bio':None},{'skills':None},{'unknown':'field'}])
def test_invalid_profile_is_validation_error_without_changes(clients,body):
    c=clients['maria'];before=get(c,'/auth/me').json()
    response=patch(c,'/users/me',body)
    assert response.status_code==422,response.text
    assert response.json()['error']['code']=='VALIDATION_ERROR'
    assert get(c,'/auth/me').json()==before
    assert patch(c,'/users/me',{'name':'Updated','bio':'Valid','skills':['Python'],'portfolio_url':None}).status_code==200

@pytest.mark.parametrize('body',[{'title':None},{'title':' '},{'description':None},{'allow_general_applications':None},{'unknown':1}])
def test_invalid_startup_patch_does_not_reach_sql(clients,body):
    o,c,_,s,v,a=setup(clients);before=get(o,f'/startups/{s}').json()
    response=patch(o,f'/startups/{s}',body)
    assert response.status_code==422,response.text
    assert get(o,f'/startups/{s}').json()==before

def test_members_history_only_for_managers(clients):
    o,c,x,s,v,a=setup(clients);oid=invite(o,a)
    assert post(c,f'/offers/{oid}/accept').status_code==200
    public=get(x,f'/startups/{s}/members').json()['items']
    assert len(public)==1 and public[0]['left_at'] is None
    assert 'email' not in public[0] and 'left_reason' not in public[0]
    assert post(c,f'/startups/{s}/members/leave').status_code==204
    assert get(x,f'/startups/{s}/members').json()['items']==[]
    assert get(c,f'/startups/{s}/members').json()['items']==[]
    assert get(o,f'/startups/{s}/members').json()['items'][0]['left_at'] is not None

@pytest.mark.parametrize('reader',['late_accept','detail','offers_list','applications_list'])
def test_expiry_materializes_without_capacity_request(clients,reader):
    o,c,_,s,v,a=setup(clients);oid=invite(o,a)
    sql("UPDATE offers SET expires_at=clock_timestamp()-interval '1 second' WHERE id=:id",id=oid)
    if reader=='late_accept':
        response=post(c,f'/offers/{oid}/accept')
        assert response.status_code==409
        assert response.json()['error']['code']=='OFFER_EXPIRED'
    elif reader=='detail':
        assert get(c,f'/offers/{oid}').json()['status']=='expired'
    elif reader=='offers_list':
        assert get(c,'/offers/mine').json()['items'][0]['status']=='expired'
    else:
        assert get(c,'/applications/mine').json()['items'][0]['status']=='reviewing'
    assert sql('SELECT status FROM offers WHERE id=:id',id=oid)[0]['status']=='expired'
    assert sql('SELECT status FROM application_attempts WHERE application_id=:id',id=a)[0]['status']=='reviewing'
    assert sql('SELECT id FROM startup_members WHERE startup_id=:id',id=s)==[]
    assert len(sql("SELECT id FROM events WHERE entity_id=:id AND event_type='offer.expired'",id=oid))==1

def test_critical_resubmission_with_pending_offer_and_review_events(clients):
    o,c,_,s,v,a=setup(clients)
    def task(kind):
        response=post(o,f'/vacancies/{v}/tests/versions',{'description':kind,'submission_deadline':future(),'change_type':kind})
        assert response.status_code==201,response.text
        return response.json()['id']
    old=task('initial')
    sub=post(c,f'/applications/{a}/test-submissions',{'test_version_id':old,'solution_url':'https://example.org/old'})
    assert sub.status_code==201,sub.text
    oldsub=sub.json()['id'];oid=invite(o,a);latest=task('critical')
    invalid=patch(o,f'/test-submissions/{oldsub}',{'status':'reviewed'})
    assert invalid.status_code==409
    assert sql("SELECT id FROM events WHERE entity_id=:id AND event_type='test.reviewed'",id=oldsub)==[]
    sub=post(c,f'/applications/{a}/test-submissions',{'test_version_id':latest,'solution_url':'https://example.org/new'})
    assert sub.status_code==201,sub.text
    sid=sub.json()['id']
    assert patch(o,f'/test-submissions/{sid}',{'status':'reviewed'}).status_code==200
    assert patch(o,f'/test-submissions/{sid}',{'status':'reviewed'}).status_code==409
    assert len(sql("SELECT id FROM events WHERE entity_id=:id AND event_type='test.reviewed'",id=sid))==1
    versions=get(c,f'/vacancies/{v}/tests/versions').json()['items']
    assert all(set(row)=={'id','vacancy_id','version','description','submission_deadline','change_type'} for row in versions)
    assert post(c,f'/offers/{oid}/accept').status_code==200

def test_managed_startups_include_closed_and_current_grants(clients):
    o,c,x,s,v,a=setup(clients)
    uid=get(x,'/auth/me').json()['id']
    inv=post(o,f'/startups/{s}/recruiter-invitations',{'user_id':uid,'expires_at':future()}).json()['id']
    assert post(x,f'/recruiter-invitations/{inv}/accept').status_code==200
    assert post(o,f'/startups/{s}/pause').status_code==200
    assert get(o,'/startups').json()['items']==[]
    assert get(o,'/startups?scope=managed').json()['items'][0]['id']==s
    assert get(x,'/startups?scope=managed').json()['items'][0]['id']==s
    assert get(c,'/startups?scope=managed').json()['items']==[]
    assert post(o,f'/startups/{s}/archive').status_code==200
    assert get(o,'/startups?scope=managed').json()['items'][0]['status']=='archived'
    assert o[0].delete(f'/api/v1/startups/{s}/recruiters/{uid}',headers=o[1]).status_code==204
    assert get(x,'/startups?scope=managed').json()['items']==[]
