"""Acceptance regressions for command replay, history, pages and upgrades."""
import os
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import create_engine,text
from sqlalchemy.engine import make_url
from test_integration_postgres import clients,post
from test_remediation_postgres import setup,invite,get,patch,future,sql

pytestmark=pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'),reason='Disposable PostgreSQL required')

def keyed(pair,path,body,key,revision=None):
    headers={**pair[1],'Idempotency-Key':key}
    if revision:headers['If-Match']=f'"{revision}"'
    return pair[0].post('/api/v1'+path,json=body,headers=headers)

def test_replayed_reset_preserves_new_attempt_and_receipt(clients):
    o,c,_,s,v,a=setup(clients)
    body={'title':'Java','description':'New conditions','change_mode':'reset_applications'}
    first=keyed(o,f'/vacancies/{v}/versions',body,'reset-command-123',1)
    assert first.status_code==201,first.text
    attempt=post(c,f'/applications/{a}/attempts',{'message':'NEW LETTER'})
    assert attempt.status_code==201,attempt.text
    repeat=keyed(o,f'/vacancies/{v}/versions',body,'reset-command-123',1)
    assert repeat.status_code==201 and repeat.json()==first.json()
    assert repeat.headers['Idempotency-Replayed']=='true'
    assert get(c,f'/applications/{a}').json()['status']=='pending'
    assert len(sql('SELECT id FROM vacancy_versions WHERE vacancy_id=:id',id=v))==2
    conflict=keyed(o,f'/vacancies/{v}/versions',{**body,'title':'Other'},'reset-command-123',1)
    assert conflict.status_code==409 and conflict.json()['error']['code']=='IDEMPOTENCY_CONFLICT'
    assert get(c,f'/applications/{a}').json()['message']=='NEW LETTER'

def test_parallel_retries_create_one_project_and_notification(clients):
    o,c,_,s,v,a=setup(clients)
    with ThreadPoolExecutor(2) as pool:
        responses=list(pool.map(lambda _:keyed(o,'/startups',{'title':'One command'},'concurrent-create-123'),range(2)))
    assert all(r.status_code==201 for r in responses)
    assert responses[0].json()['id']==responses[1].json()['id']
    assert len(sql("SELECT id FROM startups WHERE title='One command'"))==1
    body={'expires_at':future(),'message':'Exact offer'}
    first=keyed(o,f'/applications/{a}/offers',body,'offer-command-123')
    second=keyed(o,f'/applications/{a}/offers',body,'offer-command-123')
    assert first.status_code==second.status_code==201 and first.json()==second.json()
    assert len([n for n in get(c,'/notifications').json()['items'] if n['title']=='Приглашение в команду'])==1
    oid=first.json()['id']
    accepted=keyed(c,f'/offers/{oid}/accept',None,'candidate-accept-123')
    replay=keyed(c,f'/offers/{oid}/accept',None,'candidate-accept-123')
    assert accepted.status_code==replay.status_code==200
    assert len(sql('SELECT id FROM startup_members WHERE startup_id=:s',s=s))==1

def test_stale_if_match_conflicts_and_unknown_fields_are_rejected(clients):
    o,c,_,s,v,a=setup(clients)
    headers={**o[1],'If-Match':'"1"'}
    response=o[0].patch(f'/api/v1/startups/{s}',json={'title':'Changed'},headers=headers)
    assert response.status_code==200
    failed=o[0].patch(f'/api/v1/startups/{s}',json={'title':'Stale'},headers=headers)
    assert failed.status_code==409 and failed.json()['error']['code']=='REVISION_CONFLICT'
    assert get(o,f'/startups/{s}').json()['title']=='Changed'
    assert keyed(o,'/startups',{'title':'No effect'},'x').status_code==422
    assert sql("SELECT id FROM startups WHERE title='No effect'")==[]

def test_history_recovers_both_letters_offer_conditions_and_reason(clients):
    o,c,x,s,v,a=setup(clients)
    oid=invite(o,a)
    assert post(o,f'/offers/{oid}/revoke').status_code==200
    assert post(o,f'/vacancies/{v}/versions',{'title':'New title','description':'Different','change_mode':'reset_applications'}).status_code==201
    assert post(c,f'/applications/{a}/attempts',{'message':'Second letter'}).status_code==201
    assert post(o,f'/applications/{a}/reject',{'reason':'Specific reason'}).status_code==200
    attempts=get(c,f'/applications/{a}/attempts').json()['items']
    assert {r['message'] for r in attempts}=={'I can help','Second letter'}
    old=next(r for r in attempts if not r['is_current']);new=next(r for r in attempts if r['is_current'])
    assert old['title']=='Developer' and new['title']=='New title'
    assert new['rejection_reason']=='Specific reason'
    offer=get(c,f'/offers/{oid}').json()
    assert offer['vacancy_title']=='Developer' and offer['vacancy_version_id']==old['vacancy_version_id']
    history=get(c,f'/applications/{a}/history').json()['items']
    assert {'offer.sent','offer.revoke','application.reject'}<={e['event_type'] for e in history}
    assert any(e['metadata'].get('reason')=='Specific reason' for e in history)
    assert get(x,f'/applications/{a}/attempts').status_code==403
    assert get(x,f'/startups/{s}/offers').status_code==403


def collect(pair,path,limit):
    result=[];cursor=None
    while True:
        response=get(pair,path+('?' if '?' not in path else '&')+f'limit={limit}'+('&cursor='+cursor if cursor else ''))
        assert response.status_code==200,response.text
        page=response.json();assert len(page['items'])<=limit
        result.extend(page['items']);cursor=page['next_cursor']
        if not cursor:return result


def test_pages_reach_104_rows_equal_timestamps_and_bind_cursors(clients):
    o,c,_,s,v,a=setup(clients)
    uid=get(o,'/auth/me').json()['id']
    sql("INSERT INTO startups(owner_id,title,created_at) SELECT :u,'Page '||n,'2026-01-01'::timestamptz FROM generate_series(1,103) n",u=uid)
    pages=collect(o,'/startups',7)
    assert len(pages)==104 and len({r['id'] for r in pages})==104
    managed=collect(o,'/startups?scope=managed',17)
    assert {r['id'] for r in pages}=={r['id'] for r in managed}
    cursor=get(o,'/startups?limit=1').json()['next_cursor']
    assert cursor
    assert get(c,'/startups?cursor='+cursor).status_code==422
    assert get(o,'/startups?scope=managed&cursor='+cursor).status_code==422
    assert get(o,'/vacancies?cursor='+cursor).status_code==422
    for suffix in ('limit=0','limit=101','limit=bad','cursor=invalid'):
        assert get(o,'/startups?'+suffix).status_code==422
    # UUID keyset position remains meaningful if the boundary row disappears.
    first=get(o,'/startups?limit=1').json()
    sql('DELETE FROM startups WHERE id=:id',id=first['items'][0]['id']) if first['items'][0]['id']!=s else None
    assert get(o,'/startups?limit=1&cursor='+first['next_cursor']).status_code==200


def test_departed_candidate_can_apply_to_other_previous_role(clients):
    o,c,_,s,v,a=setup(clients)
    second=post(o,f'/startups/{s}/vacancies',{'title':'Other role','positions_count':1,'application_deadline':future()}).json()['id']
    other=post(c,'/applications',{'target_type':'vacancy','target_id':second}).json()['id']
    oid=invite(o,a);assert post(c,f'/offers/{oid}/accept').status_code==200
    assert post(c,f'/startups/{s}/members/leave').status_code==204
    assert post(c,f'/applications/{other}/attempts',{'message':'Returning'}).status_code==201
    assert {r['status'] for r in get(c,f'/applications/{other}/attempts').json()['items']}=={'already_joined','pending'}

@pytest.mark.parametrize('invalid',[False,True])
def test_incremental_upgrade_retains_data_or_refuses_corruption(invalid):
    source=make_url(os.environ['TEST_DATABASE_URL']);assert source.database.startswith('startup_test_')
    admin=create_engine(source,isolation_level='AUTOCOMMIT');name='startup_test_upgrade_'+uuid.uuid4().hex[:12]
    with admin.connect() as conn:conn.execute(text('CREATE DATABASE '+name))
    target=source.set(database=name);env={**os.environ,'DATABASE_URL':target.render_as_string(hide_password=False)}
    def migrate(revision):return subprocess.run([sys.executable,'-m','alembic','-c','/app/backend/alembic.ini','upgrade',revision],env=env,capture_output=True,text=True)
    engine=create_engine(target)
    try:
        initial=migrate('0001_initial');assert initial.returncode==0,initial.stderr
        with engine.begin() as conn:
            for row in conn.execute(text("SELECT t.tgname,c.relname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public'")):
                conn.execute(text(f'DROP TRIGGER "{row.tgname}" ON "{row.relname}"'))
            owner=conn.execute(text("INSERT INTO users(email,password_hash,name) VALUES('legacy@example.test','h','Legacy') RETURNING id")).scalar()
            sid=conn.execute(text("INSERT INTO startups(owner_id,title) VALUES(:o,'Retained project') RETURNING id"),{'o':owner}).scalar()
            aid=conn.execute(text('INSERT INTO applications(applicant_id,startup_id) VALUES(:u,:s) RETURNING id'),{'u':owner,'s':sid}).scalar()
            conn.execute(text('INSERT INTO application_attempts(application_id,message) VALUES(:a,\'Retained letter\')'),{'a':aid})
            if invalid:
                v=conn.execute(text("INSERT INTO vacancies(startup_id,positions_count,application_deadline) VALUES(:s,1,now()+interval '1 day') RETURNING id"),{'s':sid}).scalar()
                conn.execute(text('UPDATE applications SET vacancy_id=:v WHERE id=:a'),{'v':v,'a':aid})
        upgrade=migrate('head')
        with engine.connect() as conn:
            assert conn.execute(text('SELECT message FROM application_attempts')).scalar()=='Retained letter'
            if invalid:
                assert upgrade.returncode!=0 and 'Migration refused inconsistent legacy data' in upgrade.stderr
                assert conn.execute(text('SELECT version_num FROM alembic_version')).scalar()=='0001_initial'
            else:
                assert upgrade.returncode==0,upgrade.stderr
                assert conn.execute(text('SELECT version_num FROM alembic_version')).scalar()=='0003_telegram_auth'
                assert conn.execute(text('SELECT rejection_reason FROM application_attempts')).scalar()==''
                assert conn.execute(text("SELECT count(*) FROM pg_trigger WHERE tgname='tg_attempt_binding'")).scalar()==1
    finally:
        engine.dispose()
        with admin.connect() as conn:conn.execute(text('DROP DATABASE '+name+' WITH (FORCE)'))
        admin.dispose()

def test_representative_responses_conform_to_target_schema(clients):
    from pathlib import Path
    import yaml
    from jsonschema import Draft202012Validator,FormatChecker
    spec=yaml.safe_load((Path(__file__).parents[2]/'contracts/openapi.yaml').read_text())
    o,c,x,s,v,a=setup(clients);oid=invite(o,a)
    task=post(o,f'/vacancies/{v}/tests/versions',{'description':'Task','submission_deadline':future(),'change_type':'initial'})
    assert task.status_code==201
    tid=task.json()['id']
    assert post(c,f'/applications/{a}/test-submissions',{'test_version_id':tid,'solution_url':'https://example.test/answer'}).status_code==201
    cases=[(o,'/auth/me','User'),(o,'/startups','ListStartup'),(o,f'/startups/{s}','Startup'),
      (o,'/vacancies','ListVacancy'),(o,f'/vacancies/{v}','Vacancy'),(o,f'/startups/{s}/vacancies','ListVacancy'),
      (c,'/applications/mine','ListApplication'),(c,f'/applications/{a}','Application'),(o,f'/startups/{s}/applications','ListApplication'),
      (c,'/offers/mine','ListOffer'),(c,f'/offers/{oid}','Offer'),(o,f'/startups/{s}/offers','ListOffer'),
      (o,f'/vacancies/{v}/versions','ListVacancyVersion'),(o,f'/vacancies/{v}/tests/current','TestVersion'),(c,f'/vacancies/{v}/tests/versions','ListTestVersion'),
      (c,f'/applications/{a}/test-submissions','ListTestSubmission'),(c,f'/applications/{a}/attempts','ListAttempt'),(c,f'/applications/{a}/history','ListEvent'),
      (o,f'/startups/{s}/events','ListEvent'),(c,'/notifications','ListNotification'),(o,'/users?query=Maria','ListUser')]
    for actor,path,name in cases:
        response=get(actor,path);assert response.status_code==200,(path,response.text)
        schema={'$ref':'#/components/schemas/'+name,'components':spec['components']}
        Draft202012Validator(schema,format_checker=FormatChecker()).validate(response.json())
    response=patch(c,'/users/me',{'name':None})
    assert response.status_code==422
    Draft202012Validator({'$ref':'#/components/schemas/Error','components':spec['components']}).validate(response.json())

def test_upgrade_from_observed_existing_schema():
    from pathlib import Path
    import sqlparse
    dump=Path(__file__).parent/'fixtures'/'observed_0001.sql'
    if not dump.exists():pytest.skip('Observed schema-only fixture is not supplied')
    source=make_url(os.environ['TEST_DATABASE_URL']);assert source.database.startswith('startup_test_')
    admin=create_engine(source,isolation_level='AUTOCOMMIT');name='startup_test_observed_'+uuid.uuid4().hex[:12]
    with admin.connect() as conn:conn.execute(text('CREATE DATABASE '+name))
    target=source.set(database=name);engine=create_engine(target)
    try:
        content='\n'.join(line for line in dump.read_text().splitlines() if not line.startswith('\\'))
        with engine.begin() as conn:
            for statement in sqlparse.split(content):
                if statement.strip():conn.exec_driver_sql(statement)
            conn.execute(text('SET search_path TO public'))
            conn.execute(text("INSERT INTO alembic_version(version_num) VALUES('0001_initial')"))
            user=conn.execute(text("INSERT INTO users(email,password_hash,name) VALUES('observed@example.test','h','Observed') RETURNING id")).scalar()
            conn.execute(text("INSERT INTO startups(owner_id,title) VALUES(:u,'Retained on actual schema')"),{'u':user})
        result=subprocess.run([sys.executable,'-m','alembic','-c','/app/backend/alembic.ini','upgrade','head'],env={**os.environ,'DATABASE_URL':target.render_as_string(hide_password=False)},capture_output=True,text=True)
        assert result.returncode==0,result.stderr
        with engine.connect() as conn:
            assert conn.execute(text('SELECT title FROM startups')).scalar()=='Retained on actual schema'
            assert conn.execute(text('SELECT version_num FROM alembic_version')).scalar()=='0003_telegram_auth'
            assert conn.execute(text("SELECT count(*) FROM information_schema.columns WHERE table_name='application_attempts' AND column_name='rejection_reason'")).scalar()==1
    finally:
        engine.dispose()
        with admin.connect() as conn:conn.execute(text('DROP DATABASE '+name+' WITH (FORCE)'))
        admin.dispose()

def test_links_reject_executable_or_invalid_urls(clients):
    o,c,_,s,v,a=setup(clients)
    for value in ('javascript:alert(1)','file:///etc/passwd','https://'):
        assert patch(c,'/users/me',{'portfolio_url':value}).status_code==422
    task=post(o,f'/vacancies/{v}/tests/versions',{'description':'Task','submission_deadline':future(),'change_type':'initial'}).json()['id']
    for value in ('https://?','http://example.org/answer'):
        assert post(c,f'/applications/{a}/test-submissions',{'test_version_id':task,'solution_url':value}).status_code==422
    assert patch(c,'/users/me',{'portfolio_url':'https://example.org/portfolio'}).status_code==200
