"""Startup Team domain API; command receipts and all domain effects share a transaction."""
import secrets, uuid, os
from datetime import datetime, timezone
from typing import Literal
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field, AnyHttpUrl, TypeAdapter, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.engine import Connection
from .database import db
from .commands import command
from .pagination import paged
from .security import auth, domain_auth, verify_password, digest, csrf, COOKIE_SECURE, lock_startup, can_manage, owner_only
from .telegram_auth import bot_token, demo_login_enabled, validate_init_data

app=FastAPI(title='Startup Team API',version='0.5.0')

def record(r):return jsonable_encoder(dict(r)) if r else None
def items(rows):return {'items':[record(r) for r in rows], 'next_cursor':None}
def run(conn,query,**kw):return conn.execute(text(query),kw)
def err(code,status=409):raise HTTPException(status,code)
def guard(cond,code,status=409):
    if not cond:err(code,status)
def evt(conn,startup,actor,entity_type,entity_id,name,**metadata):
    event_id=run(conn,'''INSERT INTO events (startup_id,actor_id,entity_type,entity_id,event_type,metadata)
        VALUES (:startup,:actor,:typ,:entity,:ev,CAST(:metadata AS jsonb)) RETURNING id''',
        startup=startup,actor=actor,typ=entity_type,entity=entity_id,ev=name,
        metadata=__import__('json').dumps(metadata)).scalar()
    recipients=set()
    candidate=None
    if entity_type=='application':
        candidate=run(conn,'SELECT applicant_id FROM applications WHERE id=:id',id=entity_id).scalar()
    elif entity_type=='offer':
        candidate=run(conn,'SELECT candidate_id FROM offers WHERE id=:id',id=entity_id).scalar()
    elif entity_type=='test_submission':
        candidate=run(conn,'SELECT a.applicant_id FROM applications a JOIN application_attempts at ON at.application_id=a.id JOIN test_submissions t ON t.attempt_id=at.id WHERE t.id=:id',id=entity_id).scalar()
    elif entity_type in ('recruiter_invitation','recruiter_grant','membership'):
        table={'recruiter_invitation':'recruiter_invitations','recruiter_grant':'recruiter_grants','membership':'startup_members'}[entity_type]
        candidate=run(conn,f'SELECT user_id FROM {table} WHERE id=:id',id=entity_id).scalar()
    if candidate:recipients.add(candidate)
    if name in ('application.created','application.resubmitted','application.withdraw','offer.accept','offer.decline','test.submitted','member.left'):
        recipients.update(run(conn,'SELECT owner_id FROM startups WHERE id=:s UNION SELECT user_id FROM recruiter_grants WHERE startup_id=:s AND revoked_at IS NULL',s=startup).scalars())
    if name in ('vacancy.version.created','test.version.created'):
        vacancy_id=entity_id if entity_type=='vacancy' else run(conn,'SELECT vacancy_id FROM test_assignment_versions WHERE id=:id',id=entity_id).scalar()
        recipients.update(run(conn,'''SELECT a.applicant_id FROM applications a JOIN application_attempts at ON at.application_id=a.id AND at.is_current
             WHERE a.vacancy_id=:v AND at.status IN ('pending','reviewing','offer_pending','reset')''',v=vacancy_id).scalars())
    titles={'application.created':'Новый отклик','application.resubmitted':'Повторный отклик','application.review':'Отклик рассматривается','application.reject':'Решение по отклику','offer.sent':'Приглашение в команду','offer.accept':'Приглашение принято','offer.decline':'Отказ от приглашения','offer.revoke':'Приглашение отозвано','offer.expired':'Приглашение истекло','test.submitted':'Новое решение тестового','test.reviewed':'Решение проверено','test.version.created':'Обновлено тестовое задание','vacancy.version.created':'Обновлены условия вакансии','recruiter.invited':'Приглашение рекрутера','recruiter.revoked':'Полномочия рекрутера отозваны','member.removed':'Участие в команде завершено','member.left':'Участник вышел из команды'}
    title=titles.get(name)
    if title:
        project=run(conn,'SELECT title FROM startups WHERE id=:s',s=startup).scalar()
        for recipient in recipients:
            if str(recipient)==str(actor):continue
            run(conn,'INSERT INTO notifications(recipient_id,event_id,title,message) VALUES(:u,:e,:title,:message)',u=recipient,e=event_id,title=title,message=project or 'Startup Team')

def ts(conn):return run(conn,'SELECT clock_timestamp()').scalar()

def is_member(conn,startup_id,user_id):
    return bool(run(conn,'SELECT 1 FROM startup_members WHERE startup_id=:s AND user_id=:u AND left_at IS NULL',s=startup_id,u=user_id).scalar())

def expire_offers(conn,startup_id):
    """Invoked UNDER startup row lock before capacity/offer checks."""
    old=run(conn,'''UPDATE offers SET status='expired', decided_at=clock_timestamp(),revision=revision+1
        WHERE startup_id=:s AND status='pending' AND expires_at<=clock_timestamp()
        RETURNING id,attempt_id,candidate_id''',s=startup_id).mappings().all()
    for offer in old:
        reopen_attempt_after_offer(conn, offer['attempt_id'], startup_id)
        evt(conn,startup_id,None,'offer',offer['id'],'offer.expired')

def refresh_candidate_offers(conn, user_id):
    # All multi-startup refreshes acquire locks in the same UUID order.
    startups=run(conn,"SELECT DISTINCT startup_id FROM offers WHERE candidate_id=:u AND status='pending' ORDER BY startup_id",u=user_id).mappings().all()
    for row in startups:
        lock_startup(conn,row['startup_id'])
        expire_offers(conn,row['startup_id'])

def reopen_attempt_after_offer(conn, attempt_id, startup_id):
    # Offer is no longer pending: continue selection only if vacancy is active.
    row=run(conn,"""SELECT a.vacancy_id,s.status AS startup_status,v.status AS vacancy_status
      FROM application_attempts at JOIN applications a ON a.id=at.application_id
      JOIN startups s ON s.id=a.startup_id
      LEFT JOIN vacancies v ON v.id=a.vacancy_id
      WHERE at.id=:a AND a.startup_id=:s""",a=attempt_id,s=startup_id).mappings().first()
    if not row:return
    unfinished=(row['startup_status']!='archived' and row['vacancy_status']!='archived')
    run(conn,"""UPDATE application_attempts SET status=:next,revision=revision+1,
      updated_at=clock_timestamp() WHERE id=:a AND status='offer_pending' """,
      next='reviewing' if unfinished else 'closed',a=attempt_id)

APPLICATION_SELECT="""SELECT a.id,a.applicant_id,a.startup_id,a.vacancy_id,
    at.id AS attempt_id,at.status,at.message,at.revision,at.created_at,at.vacancy_version_id,
    at.rejection_reason,s.title AS startup_title,u.name AS applicant_name,vv.title AS vacancy_title
    FROM applications a JOIN application_attempts at ON at.application_id=a.id AND at.is_current
    JOIN startups s ON s.id=a.startup_id JOIN users u ON u.id=a.applicant_id
    LEFT JOIN vacancy_versions vv ON vv.id=at.vacancy_version_id """

def application_row(conn,id):
    return run(conn,APPLICATION_SELECT+' WHERE a.id=:id',id=id).mappings().first()

def serialize_application(row):
    return record(row)

@app.exception_handler(HTTPException)
async def api_error(request:Request,exc:HTTPException):
    code=exc.detail if isinstance(exc.detail,str) else 'HTTP_ERROR'
    return JSONResponse(status_code=exc.status_code,content={'error':{'code':code,'message':code.replace('_',' ').capitalize(),'details':{},'request_id':str(uuid.uuid4())}})
@app.exception_handler(RequestValidationError)
async def validation_error(request:Request,exc:RequestValidationError):
    return JSONResponse(status_code=422,content={'error':{'code':'VALIDATION_ERROR','message':'Invalid request','details':{'errors':[{'loc':str(e.get('loc')),'msg':e.get('msg')} for e in exc.errors()]},'request_id':str(uuid.uuid4())}})

class RequestModel(BaseModel):
    model_config = ConfigDict(extra='forbid')

    @field_validator('name', 'title', mode='before', check_fields=False)
    @classmethod
    def trim_label(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('portfolio_url','solution_url',check_fields=False)
    @classmethod
    def safe_link(cls,value,info):
        if value is None:return value
        parsed=TypeAdapter(AnyHttpUrl).validate_python(value)
        if info.field_name=='solution_url' and parsed.scheme!='https':
            raise ValueError('Solution URL must use HTTPS')
        return str(parsed)

class PatchModel(RequestModel):
    @model_validator(mode='before')
    @classmethod
    def reject_explicit_null(cls, values):
        if isinstance(values, dict):
            for key, value in values.items():
                if key != 'portfolio_url' and value is None:
                    raise ValueError(f'{key} must not be null; omit unchanged fields')
        return values

class Login(RequestModel):email:str=Field(min_length=3,max_length=254,pattern=r'^[^@\s]+@[^@\s]+\.[^@\s]+$');password:str=Field(min_length=1)
class TelegramLogin(RequestModel):init_data:str=Field(min_length=1,max_length=16384)
class StartupCreate(RequestModel):title:str=Field(min_length=1,max_length=180);description:str='';allow_general_applications:bool=True
class StartupUpdate(PatchModel):title:str|None=Field(default=None,min_length=1,max_length=180);description:str|None=None;allow_general_applications:bool|None=None
MAX_POSITIONS = 2147483647  # PostgreSQL INTEGER upper bound; shared by create/settings.
class VacancyCreate(RequestModel):title:str=Field(min_length=1,max_length=180);description:str='';requirements:str='';positions_count:int=Field(ge=1,le=MAX_POSITIONS,strict=True);application_deadline:datetime
class AttemptCreate(RequestModel):message:str=Field('',max_length=5000)
class ApplicationCreate(RequestModel):target_type:Literal['startup','vacancy'];target_id:uuid.UUID;message:str=Field('',max_length=5000)
class RejectBody(RequestModel):reason:str=Field('',max_length=2000)
class OfferCreate(RequestModel):expires_at:datetime;message:str=Field('',max_length=5000)
class UserUpdate(PatchModel):name:str|None=Field(default=None,min_length=1,max_length=120);bio:str|None=Field(default=None,max_length=5000);skills:list[str]|None=None;portfolio_url:str|None=None

@app.get('/healthz')
def health():return {'status':'ok'}

@app.post('/api/v1/auth/login')
def login(body:Login,request:Request,conn:Connection=Depends(db)):
    guard(demo_login_enabled(),'DEMO_LOGIN_DISABLED',403)
    u=run(conn,'SELECT * FROM users WHERE email=:email',email=str(body.email).lower()).mappings().first()
    if not u or not verify_password(body.password,u['password_hash']):err('INVALID_CREDENTIALS',401)
    return issue_session(conn,u,request)[0]

def issue_session(conn,user,request):
    old=request.cookies.get('session')
    if old:run(conn,'UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_digest=:d AND revoked_at IS NULL',d=digest(old))
    token=secrets.token_urlsafe(32)
    run(conn,'''INSERT INTO sessions(user_id,token_digest,csrf_digest,expires_at)
         VALUES(:uid,:digest,:csrf,clock_timestamp()+interval '7 days')''',uid=user['id'],digest=digest(token),csrf=digest(csrf(token)))
    res=JSONResponse(record({k:user[k] for k in ['id','name','bio','skills','portfolio_url']}),headers={'Cache-Control':'no-store'})
    res.set_cookie('session',token,httponly=True,secure=COOKIE_SECURE,samesite='lax',max_age=7*86400,path='/')
    return res,digest(token)

@app.get('/api/v1/auth/config')
def auth_config():
    return JSONResponse({'telegram_enabled':bool(bot_token()),'demo_enabled':demo_login_enabled()},headers={'Cache-Control':'no-store'})

@app.get('/api/v1/auth/context')
def auth_context(user=Depends(auth)):
    return JSONResponse({'onboarding_required':user['telegram_id'] is not None and user['onboarding_completed_at'] is None},headers={'Cache-Control':'no-store'})

@app.post('/api/v1/auth/telegram')
def telegram_login(body:TelegramLogin,request:Request,conn:Connection=Depends(db)):
    guard(request.headers.get('sec-fetch-site')!='cross-site','CROSS_SITE_LOGIN',403)
    guard(request.headers.get('content-type','').split(';')[0].strip()=='application/json','JSON_REQUIRED',415)
    # Old launch data can only restore its already-bound live browser session below.
    identity=validate_init_data(body.init_data,bot_token(),max_age=int(os.getenv('TELEGRAM_AUTH_MAX_AGE_SECONDS','300')),allow_expired=True)
    # Serialize consumption before creating an identity/session. No launch credential is persisted.
    run(conn,'SELECT pg_advisory_xact_lock(hashtext(:key))',key='telegram:'+identity.credential_digest)
    previous=run(conn,'''SELECT e.user_id,e.session_digest,s.revoked_at,s.expires_at
        FROM telegram_auth_exchanges e JOIN sessions s ON s.token_digest=e.session_digest
        WHERE e.init_data_digest=:key''',key=identity.credential_digest).mappings().first()
    if previous:
        raw=request.cookies.get('session')
        guard(raw and secrets.compare_digest(digest(raw),previous['session_digest'])
              and previous['revoked_at'] is None and previous['expires_at']>ts(conn),'TELEGRAM_AUTH_REPLAY',409)
        user=run(conn,'SELECT id,name,bio,skills,portfolio_url FROM users WHERE id=:id',id=previous['user_id']).mappings().one()
        return JSONResponse(record(user),headers={'Cache-Control':'no-store'})
    guard(identity.expires_at>=ts(conn).timestamp(),'TELEGRAM_AUTH_EXPIRED',401)
    # Never link accounts by name, username or client-provided email.
    run(conn,'''INSERT INTO users(telegram_id,name,email,password_hash,onboarding_completed_at)
        VALUES(:tg,:name,NULL,NULL,NULL) ON CONFLICT (telegram_id) DO NOTHING''',tg=identity.telegram_id,name=identity.name)
    user=run(conn,'SELECT id,name,bio,skills,portfolio_url FROM users WHERE telegram_id=:tg',tg=identity.telegram_id).mappings().one()
    response,session_digest=issue_session(conn,user,request)
    run(conn,'''DELETE FROM telegram_auth_exchanges e WHERE e.expires_at<clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.token_digest=e.session_digest
            AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp())''')
    run(conn,'''INSERT INTO telegram_auth_exchanges(init_data_digest,user_id,session_digest,expires_at)
        VALUES(:key,:user,:session,to_timestamp(:expiry))''',key=identity.credential_digest,user=user['id'],session=session_digest,expiry=identity.expires_at)
    return response

@app.post('/api/v1/auth/logout',status_code=204)
def logout(request:Request,conn:Connection=Depends(db),me=Depends(auth)):
    raw=request.cookies.get('session')
    run(conn,'UPDATE sessions SET revoked_at=clock_timestamp() WHERE token_digest=:d',d=digest(raw))
    response=Response(status_code=204)
    response.delete_cookie('session',path='/')
    return response

@app.get('/api/v1/auth/me')
def me(user=Depends(auth)):return record({k:user[k] for k in ['id','name','bio','skills','portfolio_url']})
@app.get('/api/v1/auth/csrf')
def get_csrf(request:Request,user=Depends(auth)):return {'csrf_token':csrf(request.cookies['session'])}
@app.get('/api/v1/users')
@paged
def find_users(query:str,conn:Connection=Depends(db),me=Depends(auth)):
    guard(2<=len(query.strip())<=120,'INVALID_SEARCH',422)
    return items(run(conn,"SELECT id,name,bio,skills,portfolio_url FROM users WHERE position(lower(:q) in lower(name))>0",q=query.strip()).mappings().all())

@app.get('/api/v1/users/{user_id}')
def public_user(user_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    u=run(conn,'SELECT id,name,bio,skills,portfolio_url FROM users WHERE id=:id',id=user_id).mappings().first()
    if not u:err('USER_NOT_FOUND',404)
    return record(u)
@app.patch('/api/v1/users/me')
@command(200)
def update_me(body:UserUpdate,conn:Connection=Depends(db),me=Depends(auth)):
    updates=body.model_dump(exclude_unset=True)
    if not updates:return public_user(me['id'],conn,me)
    if 'name' in updates:guard(bool(updates['name'].strip()),'INVALID_NAME',422)
    # JSONB updated explicitly; all other fields are SQL parameters.
    for field,value in updates.items():
        if field=='skills':
            run(conn,'UPDATE users SET skills=CAST(:v AS jsonb),revision=revision+1 WHERE id=:id',v=__import__('json').dumps(value),id=me['id'])
        else:run(conn,f'UPDATE users SET {field}=:v,revision=revision+1 WHERE id=:id',v=value,id=me['id'])
    if 'name' in updates:
        run(conn,'UPDATE users SET onboarding_completed_at=COALESCE(onboarding_completed_at,clock_timestamp()) WHERE id=:id',id=me['id'])
    return public_user(me['id'],conn,me)

@app.get('/api/v1/startups')
@paged
def list_startups(scope:Literal['public','managed','member']='public',conn:Connection=Depends(db),me=Depends(auth)):
    condition = "s.status='active'" if scope == 'public' else "(s.owner_id=:u OR EXISTS (SELECT 1 FROM recruiter_grants g WHERE g.startup_id=s.id AND g.user_id=:u AND g.revoked_at IS NULL))"
    if scope=='member':condition="EXISTS (SELECT 1 FROM startup_members sm WHERE sm.startup_id=s.id AND sm.user_id=:u AND sm.left_at IS NULL)"
    return items(run(conn,f"SELECT s.id,s.owner_id,s.title,s.description,s.status,s.allow_general_applications,s.revision FROM startups s WHERE {condition} ORDER BY s.created_at DESC,s.id DESC",u=me['id']).mappings().all())
@app.post('/api/v1/startups',status_code=201)
@command(201)
def create_startup(body:StartupCreate,conn:Connection=Depends(db),me=Depends(domain_auth)):
    r=run(conn,'''INSERT INTO startups (owner_id,title,description,allow_general_applications)
          VALUES(:owner,:title,:description,:allow) RETURNING *''',owner=me['id'],title=body.title,description=body.description,allow=body.allow_general_applications).mappings().one()
    evt(conn,r['id'],me['id'],'startup',r['id'],'startup.created')
    return record({k:r[k] for k in ['id','owner_id','title','description','status','allow_general_applications','revision']})
@app.get('/api/v1/startups/{startup_id}')
def get_startup(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    r=run(conn,'SELECT id,owner_id,title,description,status,allow_general_applications,revision FROM startups WHERE id=:id',id=startup_id).mappings().first()
    if not r:err('STARTUP_NOT_FOUND',404)
    return record(r)
@app.patch('/api/v1/startups/{startup_id}')
@command(200)
def update_startup(startup_id:uuid.UUID,body:StartupUpdate,conn:Connection=Depends(db),me=Depends(domain_auth)):
    s=lock_startup(conn,startup_id);owner_only(s,me['id']);guard(s['status']!='archived','STARTUP_ARCHIVED')
    for k,v in body.model_dump(exclude_unset=True).items():
        if k=='title':guard(bool(v and v.strip()),'INVALID_TITLE',422)
        run(conn,f'UPDATE startups SET {k}=:v,revision=revision+1 WHERE id=:s',v=v,s=startup_id)
    evt(conn,startup_id,me['id'],'startup',startup_id,'startup.updated')
    return get_startup(startup_id,conn,me)

def change_startup(startup_id,action,conn,me):
    s=lock_startup(conn,startup_id);owner_only(s,me['id'])
    allowed={'pause':('active','paused'),'resume':('paused','active'),'archive':('active','archived')}
    if action=='archive':guard(s['status'] in ('active','paused'),'INVALID_STATE_TRANSITION')
    else:guard(s['status']==allowed[action][0],'INVALID_STATE_TRANSITION')
    target=allowed[action][1]
    if action=='archive':
        expire_offers(conn,startup_id)
        expire_recruiter_invitations(conn,startup_id)
        run(conn,"UPDATE offers SET status='revoked',decided_at=clock_timestamp(),revision=revision+1 WHERE startup_id=:s AND status='pending'",s=startup_id)
        run(conn,"UPDATE vacancies SET status='archived',archived_at=clock_timestamp(),revision=revision+1 WHERE startup_id=:s AND status!='archived'",s=startup_id)
        run(conn,"UPDATE recruiter_invitations SET status='revoked',decided_at=clock_timestamp() WHERE startup_id=:s AND status='pending'",s=startup_id)
        run(conn,"UPDATE application_attempts SET status='closed',revision=revision+1 WHERE status IN ('pending','reviewing','offer_pending') AND application_id IN (SELECT id FROM applications WHERE startup_id=:s)",s=startup_id)
    run(conn,'UPDATE startups SET status=:target,revision=revision+1 WHERE id=:s',target=target,s=startup_id)
    evt(conn,startup_id,me['id'],'startup',startup_id,'startup.'+action)
    return get_startup(startup_id,conn,me)
@app.post('/api/v1/startups/{startup_id}/pause')
@command(200)
def pause(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):return change_startup(startup_id,'pause',conn,me)
@app.post('/api/v1/startups/{startup_id}/resume')
@command(200)
def resume(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):return change_startup(startup_id,'resume',conn,me)
@app.post('/api/v1/startups/{startup_id}/archive')
@command(200)
def archive(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):return change_startup(startup_id,'archive',conn,me)

@app.get('/api/v1/vacancies')
@paged
def list_vacancies(conn:Connection=Depends(db),me=Depends(auth)):
    rows=run(conn,'''SELECT v.id,v.startup_id,s.owner_id,s.status AS startup_status,v.status,v.application_deadline,v.positions_count,
      v.current_version,v.revision,vv.title,vv.description,vv.requirements FROM vacancies v
      JOIN vacancy_versions vv ON vv.vacancy_id=v.id AND vv.version=v.current_version
      JOIN startups s ON s.id=v.startup_id WHERE v.status='published' AND s.status='active'
      ORDER BY v.created_at DESC''').mappings().all()
    return items(rows)
@app.get('/api/v1/startups/{startup_id}/vacancies')
@paged
def startup_vacancies(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    rows=run(conn,'''SELECT v.id,v.startup_id,s.owner_id,s.status AS startup_status,v.status,v.application_deadline,v.positions_count,
      v.current_version,v.revision,vv.title,vv.description,vv.requirements FROM vacancies v
      JOIN vacancy_versions vv ON vv.vacancy_id=v.id AND vv.version=v.current_version
      JOIN startups s ON s.id=v.startup_id WHERE v.startup_id=:s ORDER BY v.created_at DESC''',s=startup_id).mappings().all()
    return items(rows)
@app.get('/api/v1/vacancies/{vacancy_id}')
def get_vacancy(vacancy_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    r=run(conn,'''SELECT v.id,v.startup_id,s.owner_id,s.status AS startup_status,v.status,v.application_deadline,v.positions_count,v.current_version,v.revision,
           vv.title,vv.description,vv.requirements FROM vacancies v
           JOIN vacancy_versions vv ON vv.vacancy_id=v.id AND vv.version=v.current_version
           JOIN startups s ON s.id=v.startup_id WHERE v.id=:v''',v=vacancy_id).mappings().first()
    if not r:err('VACANCY_NOT_FOUND',404)
    return record(r)
@app.post('/api/v1/startups/{startup_id}/vacancies',status_code=201)
@command(201)
def create_vacancy(startup_id:uuid.UUID,body:VacancyCreate,conn:Connection=Depends(db),me=Depends(domain_auth)):
    s=lock_startup(conn,startup_id)
    guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    guard(s['status']=='active','STARTUP_INACTIVE')
    guard(body.application_deadline.tzinfo is not None and body.application_deadline > ts(conn),'INVALID_DEADLINE',422)
    v=run(conn,'''INSERT INTO vacancies(startup_id,application_deadline,positions_count)
         VALUES(:s,:deadline,:count) RETURNING id''',s=startup_id,deadline=body.application_deadline,count=body.positions_count).scalar()
    run(conn,'''INSERT INTO vacancy_versions(vacancy_id,version,title,description,requirements,change_mode,created_by)
         VALUES(:v,1,:title,:descr,:req,'initial',:actor)''',v=v,title=body.title,descr=body.description,req=body.requirements,actor=me['id'])
    evt(conn,startup_id,me['id'],'vacancy',v,'vacancy.created')
    return get_vacancy(v,conn,me)

@app.post('/api/v1/applications',status_code=201)
@command(201)
def apply(body:ApplicationCreate,conn:Connection=Depends(db),me=Depends(domain_auth)):
    if body.target_type=='vacancy':
        v=run(conn,'SELECT startup_id FROM vacancies WHERE id=:v',v=body.target_id).mappings().first()
        if not v:err('VACANCY_NOT_FOUND',404)
        sid=v['startup_id']
    else:sid=body.target_id
    s=lock_startup(conn,sid)
    guard(s['status']=='active','STARTUP_INACTIVE')
    guard(str(s['owner_id'])!=str(me['id']),'CANNOT_APPLY_OWN_STARTUP',403)
    guard(not is_member(conn,sid,me['id']),'ALREADY_TEAM_MEMBER')
    if body.target_type=='startup':
        guard(s['allow_general_applications'],'GENERAL_APPLICATIONS_DISABLED')
        vacancy_id=None; version_id=None
    else:
        v=run(conn,'SELECT status,application_deadline,current_version FROM vacancies WHERE id=:v',v=body.target_id).mappings().one()
        guard(v['status']=='published' and v['application_deadline']>ts(conn),'APPLICATIONS_CLOSED')
        vacancy_id=body.target_id
        version_id=run(conn,'SELECT id FROM vacancy_versions WHERE vacancy_id=:v AND version=:n',v=vacancy_id,n=v['current_version']).scalar()
    if vacancy_id is None:
        old=run(conn,'SELECT id FROM applications WHERE applicant_id=:u AND startup_id=:s AND vacancy_id IS NULL',u=me['id'],s=sid).scalar()
    else:
        old=run(conn,'SELECT id FROM applications WHERE applicant_id=:u AND vacancy_id=:v',u=me['id'],v=vacancy_id).scalar()
    guard(old is None,'APPLICATION_ALREADY_EXISTS')
    aid=run(conn,'INSERT INTO applications(applicant_id,startup_id,vacancy_id) VALUES(:u,:s,:v) RETURNING id',u=me['id'],s=sid,v=vacancy_id).scalar()
    run(conn,'''INSERT INTO application_attempts(application_id,vacancy_version_id,status,message)
          VALUES(:aid,:version,'pending',:msg)''',aid=aid,version=version_id,msg=body.message)
    evt(conn,sid,me['id'],'application',aid,'application.created')
    return serialize_application(application_row(conn,aid))

@app.get('/api/v1/applications/mine')
@paged
def my_apps(conn:Connection=Depends(db),me=Depends(auth)):
    refresh_candidate_offers(conn,me['id'])
    return items(run(conn,APPLICATION_SELECT+' WHERE a.applicant_id=:u',u=me['id']).mappings().all())
@app.get('/api/v1/startups/{startup_id}/applications')
@paged
def received(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    s=lock_startup(conn,startup_id)
    guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    expire_offers(conn,startup_id)
    return items(run(conn,APPLICATION_SELECT+' WHERE a.startup_id=:s',s=startup_id).mappings().all())
@app.get('/api/v1/applications/{application_id}')
def get_app(application_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    r=application_row(conn,application_id)
    if not r:err('APPLICATION_NOT_FOUND',404)
    if str(r['applicant_id'])!=str(me['id']):
        s=lock_startup(conn,r['startup_id']);guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    lock_startup(conn,r['startup_id'])
    expire_offers(conn,r['startup_id'])
    return serialize_application(application_row(conn,application_id))

def act_on_app(application_id,action,conn,me,reason=''):
    r=application_row(conn,application_id)
    if not r:err('APPLICATION_NOT_FOUND',404)
    s=lock_startup(conn,r['startup_id']);r=application_row(conn,application_id)
    if action in ('review','reject'):
        guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
        guard(str(r['applicant_id'])!=str(me['id']),'SELF_REVIEW_FORBIDDEN',403)
        guard(r['status'] in ('pending','reviewing'),'INVALID_STATE_TRANSITION')
        target='reviewing' if action=='review' else 'rejected'
    else:
        guard(str(r['applicant_id'])==str(me['id']),'PERMISSION_DENIED',403)
        if action=='withdraw':guard(r['status'] in ('pending','reviewing'),'INVALID_STATE_TRANSITION');target='withdrawn'
        else:
            guard(r['status']=='withdrawn','INVALID_STATE_TRANSITION')
            guard(s['status']=='active','STARTUP_INACTIVE')
            if r['vacancy_id']:
                v=run(conn,'SELECT status,application_deadline FROM vacancies WHERE id=:v',v=r['vacancy_id']).mappings().one()
                guard(v['status']=='published' and v['application_deadline']>ts(conn),'APPLICATIONS_CLOSED')
            else:guard(s['allow_general_applications'],'GENERAL_APPLICATIONS_DISABLED')
            # Withdrawn is reversible: reconcile any critical changes made while absent.
            # Keep reviewed_by/reviewed_at and historical attempts unchanged.
            run(conn,'''UPDATE test_submissions sub SET status='superseded'
                FROM test_assignment_versions submitted
                WHERE sub.attempt_id=:attempt AND sub.test_version_id=submitted.id
                AND sub.status IN ('submitted','reviewed') AND EXISTS (
                    SELECT 1 FROM test_assignment_versions newer
                    WHERE newer.vacancy_id=submitted.vacancy_id AND newer.version>submitted.version
                    AND newer.change_type='critical')''',attempt=r['attempt_id'])
            target='pending'
    run(conn,'UPDATE application_attempts SET status=:status,revision=revision+1,updated_at=clock_timestamp() WHERE id=:id',status=target,id=r['attempt_id'])
    if action=='reject':
        run(conn,'UPDATE application_attempts SET rejection_reason=:reason WHERE id=:id',reason=reason,id=r['attempt_id'])
    evt(conn,s['id'],me['id'],'application',application_id,'application.'+action,attempt_id=str(r['attempt_id']),reason=reason)
    return serialize_application(application_row(conn,application_id))
@app.post('/api/v1/applications/{application_id}/review')
@command(200)
def review(application_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):return act_on_app(application_id,'review',conn,me)
@app.post('/api/v1/applications/{application_id}/reject')
@command(200)
def reject(application_id:uuid.UUID,body:RejectBody,conn:Connection=Depends(db),me=Depends(domain_auth)):return act_on_app(application_id,'reject',conn,me,body.reason)
@app.post('/api/v1/applications/{application_id}/withdraw')
@command(200)
def withdraw(application_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):return act_on_app(application_id,'withdraw',conn,me)
@app.post('/api/v1/applications/{application_id}/restore')
@command(200)
def restore(application_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):return act_on_app(application_id,'restore',conn,me)

# --- Invitation / team workflows (startup row is the concurrency gate) ---

def capacity_locked(conn,vacancy_id):
    v=run(conn,'SELECT positions_count,startup_id FROM vacancies WHERE id=:v',v=vacancy_id).mappings().first()
    if not v:err('VACANCY_NOT_FOUND',404)
    occupied=run(conn,'''SELECT count(*) FROM startup_members sm JOIN offers o ON o.id=sm.joined_via_offer_id
            WHERE o.vacancy_id=:v AND sm.left_at IS NULL''',v=vacancy_id).scalar()
    reserved=run(conn,"SELECT count(*) FROM offers WHERE vacancy_id=:v AND status='pending' AND expires_at>clock_timestamp()",v=vacancy_id).scalar()
    return {'positions_count':v['positions_count'],'occupied':occupied,'reserved':reserved,'available':v['positions_count']-occupied-reserved}

@app.get('/api/v1/vacancies/{vacancy_id}/capacity')
def vacancy_capacity(vacancy_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    row=run(conn,'SELECT startup_id FROM vacancies WHERE id=:v',v=vacancy_id).mappings().first()
    if not row:err('VACANCY_NOT_FOUND',404)
    lock_startup(conn,row['startup_id'])
    expire_offers(conn,row['startup_id'])
    return capacity_locked(conn,vacancy_id)

@app.post('/api/v1/applications/{application_id}/offers',status_code=201)
@command(201)
def create_offer(application_id:uuid.UUID,body:OfferCreate,conn:Connection=Depends(db),me=Depends(domain_auth)):
    r=application_row(conn,application_id)
    if not r:err('APPLICATION_NOT_FOUND',404)
    s=lock_startup(conn,r['startup_id']);expire_offers(conn,s['id'])
    r=application_row(conn,application_id)
    guard(s['status']=='active','STARTUP_INACTIVE')
    guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    guard(str(r['applicant_id'])!=str(me['id']),'SELF_REVIEW_FORBIDDEN',403)
    guard(not is_member(conn,s['id'],r['applicant_id']),'ALREADY_TEAM_MEMBER')
    guard(r['status'] in ('pending','reviewing'),'INVALID_STATE_TRANSITION')
    guard(body.expires_at.tzinfo is not None and body.expires_at>ts(conn),'INVALID_EXPIRY',422)
    existing=run(conn,"SELECT 1 FROM offers WHERE startup_id=:s AND candidate_id=:u AND status='pending'",s=s['id'],u=r['applicant_id']).scalar()
    guard(not existing,'PENDING_OFFER_EXISTS')
    if r['vacancy_id']:
        vac=run(conn,'SELECT status FROM vacancies WHERE id=:v',v=r['vacancy_id']).mappings().one()
        guard(vac['status']!='archived','VACANCY_ARCHIVED')
        guard(capacity_locked(conn,r['vacancy_id'])['available']>0,'NO_CAPACITY')
    oid=run(conn,'''INSERT INTO offers(attempt_id,startup_id,candidate_id,vacancy_id,vacancy_version_id,expires_at,message,created_by)
             VALUES(:attempt,:startup,:candidate,:vacancy,:version,:exp,:message,:by) RETURNING id''',
             attempt=r['attempt_id'],startup=s['id'],candidate=r['applicant_id'],vacancy=r['vacancy_id'],version=r['vacancy_version_id'],exp=body.expires_at,message=body.message,by=me['id']).scalar()
    run(conn,"UPDATE application_attempts SET status='offer_pending',revision=revision+1 WHERE id=:id",id=r['attempt_id'])
    evt(conn,s['id'],me['id'],'offer',oid,'offer.sent')
    return get_offer(oid,conn,{'id':r['applicant_id']})

OFFER_SELECT="""SELECT o.id,o.startup_id,o.candidate_id,o.vacancy_id,o.status,o.expires_at,o.revision,
    o.attempt_id,o.vacancy_version_id,o.message,s.title AS startup_title,
    vv.title AS vacancy_title,vv.description AS vacancy_description,vv.requirements AS vacancy_requirements
    FROM offers o JOIN startups s ON s.id=o.startup_id LEFT JOIN vacancy_versions vv ON vv.id=o.vacancy_version_id """

def get_offer(offer_id,conn,me):
    r=run(conn,OFFER_SELECT+' WHERE o.id=:id',id=offer_id).mappings().first()
    if not r:err('OFFER_NOT_FOUND',404)
    s=lock_startup(conn,r['startup_id'])
    if str(r['candidate_id'])!=str(me['id']):guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    expire_offers(conn,r['startup_id'])
    return record(run(conn,OFFER_SELECT+' WHERE o.id=:id',id=offer_id).mappings().one())
@app.get('/api/v1/offers/mine')
@paged
def offers_mine(conn:Connection=Depends(db),me=Depends(auth)):
    refresh_candidate_offers(conn,me['id'])
    rows=run(conn,OFFER_SELECT+' WHERE o.candidate_id=:u',u=me['id']).mappings().all()
    return items(rows)

@app.get('/api/v1/offers/{offer_id}')
def offer_details(offer_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):return get_offer(offer_id,conn,me)

def decide_offer(offer_id, action, conn, me):
    first=run(conn,'SELECT startup_id FROM offers WHERE id=:o',o=offer_id).mappings().first()
    if not first:err('OFFER_NOT_FOUND',404)
    s=lock_startup(conn,first['startup_id'])
    r=run(conn,'SELECT * FROM offers WHERE id=:o',o=offer_id).mappings().one()
    if action=='revoke':
        guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
        guard(str(r['candidate_id'])!=str(me['id']),'SELF_REVIEW_FORBIDDEN',403)
    else:guard(str(r['candidate_id'])==str(me['id']),'PERMISSION_DENIED',403)
    expire_offers(conn,s['id'])
    r=run(conn,'SELECT * FROM offers WHERE id=:o',o=offer_id).mappings().one()
    if r['status']=='expired':
        # The command is refused, but the independent clock transition must commit.
        # No candidate decision or membership has been written on this path.
        return JSONResponse(status_code=409,content={'error':{'code':'OFFER_EXPIRED','message':'Offer expired','details':{},'request_id':str(uuid.uuid4())}})
    guard(r['status']=='pending','INVALID_STATE_TRANSITION')
    if action=='accept':
        guard(s['status']!='archived','STARTUP_ARCHIVED')
        guard(not is_member(conn,s['id'],me['id']),'ALREADY_TEAM_MEMBER')
        if r['expires_at']<=ts(conn):
            expire_offers(conn,s['id'])
            return JSONResponse(status_code=409,content={'error':{'code':'OFFER_EXPIRED','message':'Offer expired','details':{},'request_id':str(uuid.uuid4())}})
        if r['vacancy_id']:
            # Pending invitation already reserves a place: capacity remains consistent.
            cap=capacity_locked(conn,r['vacancy_id'])
            guard(cap['available']>=0,'CAPACITY_INVARIANT_VIOLATED')
        # Database constraint requires the offer to be accepted BEFORE inserting membership.
        # Entire sequence stays atomic: a failed membership insert rolls back the status change.
        run(conn,"UPDATE offers SET status='accepted',decided_at=clock_timestamp(),revision=revision+1 WHERE id=:o",o=offer_id)
        run(conn,"INSERT INTO startup_members(startup_id,user_id,joined_via_offer_id) VALUES(:s,:u,:o)",s=s['id'],u=me['id'],o=offer_id)
        run(conn,"UPDATE application_attempts SET status='joined',revision=revision+1 WHERE id=:a",a=r['attempt_id'])
        # Close competing pending offers and unfinished attempts in this startup.
        competing=run(conn,"SELECT id,attempt_id FROM offers WHERE startup_id=:s AND candidate_id=:u AND status='pending' AND id!=:oid",s=s['id'],u=me['id'],oid=offer_id).mappings().all()
        for other in competing:
            run(conn,"UPDATE offers SET status='revoked',decided_at=clock_timestamp() WHERE id=:o",o=other['id'])
            run(conn,"UPDATE application_attempts SET status='already_joined',revision=revision+1 WHERE id=:a",a=other['attempt_id'])
        run(conn,'''UPDATE application_attempts SET status='already_joined',revision=revision+1
           WHERE is_current AND status IN ('pending','reviewing','withdrawn')
           AND application_id IN (SELECT id FROM applications WHERE startup_id=:s AND applicant_id=:u)
           AND id!=:accepted''',s=s['id'],u=me['id'],accepted=r['attempt_id'])
        status='accepted'
    else:
        status='declined' if action=='decline' else 'revoked'
        if action=='decline':
            run(conn,"UPDATE application_attempts SET status='declined',revision=revision+1 WHERE id=:a",a=r['attempt_id'])
        else:
            reopen_attempt_after_offer(conn,r['attempt_id'],s['id'])
    if action!='accept':
        run(conn,"UPDATE offers SET status=:status,decided_at=clock_timestamp(),revision=revision+1 WHERE id=:o",status=status,o=offer_id)
    evt(conn,s['id'],me['id'],'offer',offer_id,'offer.'+action)
    return get_offer(offer_id,conn,me)
@app.post('/api/v1/offers/{offer_id}/accept')
@command(200)
def accept_offer(offer_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):return decide_offer(offer_id,'accept',conn,me)
@app.post('/api/v1/offers/{offer_id}/decline')
@command(200)
def decline_offer(offer_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):return decide_offer(offer_id,'decline',conn,me)
@app.post('/api/v1/offers/{offer_id}/revoke')
@command(200)
def revoke_offer(offer_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):return decide_offer(offer_id,'revoke',conn,me)

@app.get('/api/v1/startups/{startup_id}/members')
@paged
def members(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    s=lock_startup(conn,startup_id)
    history=can_manage(conn,s,me['id'])
    condition='' if history else ' AND left_at IS NULL'
    rows=run(conn,'SELECT id,startup_id,user_id,joined_at,left_at FROM startup_members WHERE startup_id=:s'+condition+' ORDER BY joined_at,id',s=startup_id).mappings().all()
    return items(rows)
@app.post('/api/v1/startups/{startup_id}/members/leave',status_code=204)
@command(204)
def leave_team(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):
    s=lock_startup(conn,startup_id)
    affected=run(conn,"UPDATE startup_members SET left_at=clock_timestamp(),left_reason='left' WHERE startup_id=:s AND user_id=:u AND left_at IS NULL RETURNING id",s=startup_id,u=me['id']).scalar()
    guard(affected is not None,'NOT_TEAM_MEMBER')
    evt(conn,startup_id,me['id'],'membership',affected,'member.left')
    return None
@app.delete('/api/v1/startups/{startup_id}/members/{user_id}',status_code=204)
@command(204)
def remove_team_member(startup_id:uuid.UUID,user_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):
    s=lock_startup(conn,startup_id);owner_only(s,me['id'])
    affected=run(conn,"UPDATE startup_members SET left_at=clock_timestamp(),left_reason='removed' WHERE startup_id=:s AND user_id=:u AND left_at IS NULL RETURNING id",s=startup_id,u=user_id).scalar()
    guard(affected is not None,'NOT_TEAM_MEMBER')
    evt(conn,startup_id,me['id'],'membership',affected,'member.removed')
    return None

# --- Vacancy changes and resubmission after a reset ---
class VacancyChange(RequestModel):
    title:str=Field(min_length=1,max_length=180)
    description:str=''
    requirements:str=''
    change_mode:Literal['keep_applications','reset_applications']
    reason:str=''
class VacancySettings(PatchModel):
    positions_count:int|None=Field(default=None,ge=1,le=MAX_POSITIONS,strict=True)
    application_deadline:datetime|None=None

@app.get('/api/v1/vacancies/{vacancy_id}/versions')
@paged
def versions(vacancy_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    rows=run(conn,'SELECT id,vacancy_id,version,title,description,requirements,change_mode,created_at FROM vacancy_versions WHERE vacancy_id=:v ORDER BY version DESC',v=vacancy_id).mappings().all()
    return items(rows)
@app.post('/api/v1/vacancies/{vacancy_id}/versions',status_code=201)
@command(201)
def new_version(vacancy_id:uuid.UUID,body:VacancyChange,conn:Connection=Depends(db),me=Depends(domain_auth)):
    v=run(conn,'SELECT startup_id FROM vacancies WHERE id=:v',v=vacancy_id).mappings().first()
    if not v:err('VACANCY_NOT_FOUND',404)
    s=lock_startup(conn,v['startup_id'])
    guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    guard(s['status']!='archived','STARTUP_ARCHIVED')
    v=run(conn,'SELECT current_version,status FROM vacancies WHERE id=:id',id=vacancy_id).mappings().one()
    guard(v['status']!='archived','VACANCY_ARCHIVED')
    version=v['current_version']+1
    r=run(conn,'''INSERT INTO vacancy_versions(vacancy_id,version,title,description,requirements,change_mode,reason,created_by)
            VALUES(:v,:version,:title,:descr,:requirements,:mode,:reason,:actor)
            RETURNING id,vacancy_id,version,title,description,requirements,change_mode,created_at''',
          v=vacancy_id,version=version,title=body.title,descr=body.description,requirements=body.requirements,
          mode=body.change_mode,reason=body.reason,actor=me['id']).mappings().one()
    if body.change_mode=='reset_applications':
        run(conn,'''UPDATE application_attempts SET status='reset',revision=revision+1,updated_at=clock_timestamp()
                WHERE is_current AND status IN ('pending','reviewing','withdrawn')
                AND application_id IN (SELECT id FROM applications WHERE vacancy_id=:v)''',v=vacancy_id)
    run(conn,'UPDATE vacancies SET current_version=:version,revision=revision+1 WHERE id=:v',version=version,v=vacancy_id)
    evt(conn,s['id'],me['id'],'vacancy',vacancy_id,'vacancy.version.created',version=version,change_mode=body.change_mode)
    return record(r)

@app.post('/api/v1/applications/{application_id}/attempts',status_code=201)
@command(201)
def resubmit(application_id:uuid.UUID,body:AttemptCreate,conn:Connection=Depends(db),me=Depends(domain_auth)):
    a=run(conn,'SELECT id,startup_id,applicant_id,vacancy_id FROM applications WHERE id=:id',id=application_id).mappings().first()
    if not a:err('APPLICATION_NOT_FOUND',404)
    s=lock_startup(conn,a['startup_id'])
    guard(str(a['applicant_id'])==str(me['id']),'PERMISSION_DENIED',403)
    guard(s['status']=='active','STARTUP_INACTIVE')
    guard(not is_member(conn,s['id'],me['id']),'ALREADY_TEAM_MEMBER')
    current=application_row(conn,application_id)
    guard(current['status'] in ('reset','joined','already_joined'),'INVALID_STATE_TRANSITION')
    if current['status']=='joined':
        # The earlier accepted offer/membership remains immutable history.
        guard(not run(conn,"""SELECT 1 FROM startup_members WHERE startup_id=:s AND user_id=:u
             AND left_at IS NULL""",s=s['id'],u=me['id']).scalar(),'ALREADY_TEAM_MEMBER')
    if a['vacancy_id']:
        v=run(conn,'SELECT current_version,status,application_deadline FROM vacancies WHERE id=:id',id=a['vacancy_id']).mappings().one()
        guard(v['status']=='published' and v['application_deadline']>ts(conn),'APPLICATIONS_CLOSED')
        latest=run(conn,'SELECT id FROM vacancy_versions WHERE vacancy_id=:v AND version=:version',v=a['vacancy_id'],version=v['current_version']).scalar()
    else:
        guard(s['allow_general_applications'],'GENERAL_APPLICATIONS_DISABLED')
        latest=None
    run(conn,'UPDATE application_attempts SET is_current=FALSE WHERE id=:id',id=current['attempt_id'])
    run(conn,'''INSERT INTO application_attempts(application_id,vacancy_version_id,message,status)
       VALUES(:app,:version,:message,'pending')''',app=application_id,version=latest,message=body.message)
    evt(conn,s['id'],me['id'],'application',application_id,'application.resubmitted')
    return serialize_application(application_row(conn,application_id))

@app.post('/api/v1/vacancies/{vacancy_id}/close-intake')
@app.post('/api/v1/vacancies/{vacancy_id}/reopen-intake')
@app.post('/api/v1/vacancies/{vacancy_id}/archive')
@command(200)
def vacancy_state(vacancy_id:uuid.UUID,request:Request,conn:Connection=Depends(db),me=Depends(domain_auth)):
    r=run(conn,'SELECT startup_id FROM vacancies WHERE id=:v',v=vacancy_id).mappings().first()
    if not r:err('VACANCY_NOT_FOUND',404)
    s=lock_startup(conn,r['startup_id'])
    guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    guard(s['status']!='archived','STARTUP_ARCHIVED')
    action=request.url.path.split('/')[-1]
    v=run(conn,'SELECT status,application_deadline FROM vacancies WHERE id=:v',v=vacancy_id).mappings().one()
    if action=='close-intake':guard(v['status']=='published','INVALID_STATE_TRANSITION');target='intake_closed'
    elif action=='reopen-intake':
        guard(v['status']=='intake_closed','INVALID_STATE_TRANSITION')
        guard(v['application_deadline']>ts(conn),'DEADLINE_EXTENSION_REQUIRED')
        guard(s['status']=='active','STARTUP_INACTIVE')
        target='published'
    else:guard(v['status']!='archived','INVALID_STATE_TRANSITION');target='archived'
    run(conn,'''UPDATE vacancies SET status=:target,revision=revision+1,
      archived_at=CASE WHEN :target='archived' THEN clock_timestamp() ELSE archived_at END
      WHERE id=:v''',target=target,v=vacancy_id)
    evt(conn,s['id'],me['id'],'vacancy',vacancy_id,'vacancy.'+action)
    return get_vacancy(vacancy_id,conn,me)

@app.patch('/api/v1/vacancies/{vacancy_id}/settings')
@command(200)
def vacancy_settings(vacancy_id:uuid.UUID,body:VacancySettings,conn:Connection=Depends(db),me=Depends(domain_auth)):
    v=run(conn,'SELECT startup_id FROM vacancies WHERE id=:v',v=vacancy_id).mappings().first()
    if not v:err('VACANCY_NOT_FOUND',404)
    s=lock_startup(conn,v['startup_id']);expire_offers(conn,s['id'])
    guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    guard(s['status']!='archived','STARTUP_ARCHIVED')
    if body.positions_count is not None:
        cap=capacity_locked(conn,vacancy_id)
        guard(body.positions_count>=cap['occupied']+cap['reserved'],'BELOW_COMMITTED_CAPACITY')
        run(conn,'UPDATE vacancies SET positions_count=:n,revision=revision+1 WHERE id=:v',n=body.positions_count,v=vacancy_id)
    if body.application_deadline is not None:
        guard(body.application_deadline.tzinfo is not None and body.application_deadline>ts(conn),'INVALID_DEADLINE',422)
        run(conn,'UPDATE vacancies SET application_deadline=:deadline,revision=revision+1 WHERE id=:v',deadline=body.application_deadline,v=vacancy_id)
    evt(conn,s['id'],me['id'],'vacancy',vacancy_id,'vacancy.settings.updated')
    return get_vacancy(vacancy_id,conn,me)

# --- External recruiters ---
RECRUITER_INVITATION_SELECT = '''SELECT id,startup_id,user_id,
    CASE WHEN status='pending' AND expires_at<=clock_timestamp() THEN 'expired'
         ELSE status END AS status,expires_at FROM recruiter_invitations'''

def expire_recruiter_invitations(conn,startup_id):
    # Caller holds the startup lock. Reads also project expiry without requiring a write.
    run(conn,"UPDATE recruiter_invitations SET status='expired',decided_at=clock_timestamp() WHERE startup_id=:s AND status='pending' AND expires_at<=clock_timestamp()",s=startup_id)

class RecruiterInvite(RequestModel):user_id:uuid.UUID;expires_at:datetime
@app.post('/api/v1/startups/{startup_id}/recruiter-invitations',status_code=201)
@command(201)
def invite_recruiter(startup_id:uuid.UUID,body:RecruiterInvite,conn:Connection=Depends(db),me=Depends(domain_auth)):
    s=lock_startup(conn,startup_id);owner_only(s,me['id']);guard(s['status']=='active','STARTUP_INACTIVE')
    guard(str(body.user_id)!=str(me['id']),'OWNER_ALREADY_MANAGES')
    guard(body.expires_at.tzinfo is not None and body.expires_at>ts(conn),'INVALID_EXPIRY',422)
    guard(run(conn,'SELECT 1 FROM users WHERE id=:u',u=body.user_id).scalar(),'USER_NOT_FOUND',404)
    expire_recruiter_invitations(conn,startup_id)
    guard(not run(conn,'SELECT 1 FROM recruiter_grants WHERE startup_id=:s AND user_id=:u AND revoked_at IS NULL',s=startup_id,u=body.user_id).scalar(),'ALREADY_RECRUITER')
    guard(not run(conn,"SELECT 1 FROM recruiter_invitations WHERE startup_id=:s AND user_id=:u AND status='pending'",s=startup_id,u=body.user_id).scalar(),'INVITATION_EXISTS')
    row=run(conn,'''INSERT INTO recruiter_invitations(startup_id,user_id,sent_by,expires_at) VALUES(:s,:u,:by,:exp)
         RETURNING id,startup_id,user_id,status,expires_at''',s=startup_id,u=body.user_id,by=me['id'],exp=body.expires_at).mappings().one()
    evt(conn,startup_id,me['id'],'recruiter_invitation',row['id'],'recruiter.invited')
    return record(row)
@app.get('/api/v1/recruiter-invitations/mine')
@paged
def own_recruiter_invitations(conn:Connection=Depends(db),me=Depends(auth)):
    return items(run(conn,RECRUITER_INVITATION_SELECT+' WHERE user_id=:u ORDER BY created_at DESC',u=me['id']).mappings().all())
@app.post('/api/v1/recruiter-invitations/{invitation_id}/accept')
@app.post('/api/v1/recruiter-invitations/{invitation_id}/decline')
@command(200)
def respond_recruiter(invitation_id:uuid.UUID,request:Request,conn:Connection=Depends(db),me=Depends(domain_auth)):
    inv=run(conn,'SELECT startup_id FROM recruiter_invitations WHERE id=:i',i=invitation_id).mappings().first()
    if not inv:err('INVITATION_NOT_FOUND',404)
    s=lock_startup(conn,inv['startup_id'])
    r=run(conn,'SELECT * FROM recruiter_invitations WHERE id=:i',i=invitation_id).mappings().one()
    guard(str(r['user_id'])==str(me['id']),'PERMISSION_DENIED',403)
    guard(r['status']=='pending' and r['expires_at']>ts(conn),'INVITATION_NOT_ACTIVE')
    action=request.url.path.split('/')[-1]
    if action=='accept':
        guard(s['status']=='active','STARTUP_INACTIVE')
        guard(not run(conn,'SELECT 1 FROM recruiter_grants WHERE startup_id=:s AND user_id=:u AND revoked_at IS NULL',s=s['id'],u=me['id']).scalar(),'ALREADY_RECRUITER')
        run(conn,"UPDATE recruiter_invitations SET status='accepted',decided_at=clock_timestamp() WHERE id=:i",i=invitation_id)
        run(conn,'INSERT INTO recruiter_grants(startup_id,user_id,invitation_id) VALUES(:s,:u,:i)',s=s['id'],u=me['id'],i=invitation_id)
    else:
        run(conn,"UPDATE recruiter_invitations SET status='declined',decided_at=clock_timestamp() WHERE id=:i",i=invitation_id)
    evt(conn,s['id'],me['id'],'recruiter_invitation',invitation_id,'recruiter.'+action)
    return record(run(conn,'SELECT id,startup_id,user_id,status,expires_at FROM recruiter_invitations WHERE id=:i',i=invitation_id).mappings().one())
@app.post('/api/v1/recruiter-invitations/{invitation_id}/revoke')
@command(200)
def revoke_recruiter_invitation(invitation_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):
    row=run(conn,'SELECT startup_id FROM recruiter_invitations WHERE id=:i',i=invitation_id).mappings().first()
    if not row:err('INVITATION_NOT_FOUND',404)
    s=lock_startup(conn,row['startup_id']);owner_only(s,me['id'])
    updated=run(conn,"""UPDATE recruiter_invitations
       SET status='revoked',decided_at=clock_timestamp()
       WHERE id=:i AND status='pending' AND expires_at>clock_timestamp()
       RETURNING id,startup_id,user_id,status,expires_at""",i=invitation_id).mappings().first()
    guard(updated is not None,'INVALID_STATE_TRANSITION')
    evt(conn,s['id'],me['id'],'recruiter_invitation',invitation_id,'recruiter.revoke')
    return record(updated)

@app.get('/api/v1/startups/{startup_id}/recruiters')
@paged
def recruiters(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    s=lock_startup(conn,startup_id);guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    return items(run(conn,'SELECT id,startup_id,user_id,granted_at FROM recruiter_grants WHERE startup_id=:s AND revoked_at IS NULL',s=startup_id).mappings().all())
@app.delete('/api/v1/startups/{startup_id}/recruiters/{user_id}',status_code=204)
@command(204)
def remove_recruiter(startup_id:uuid.UUID,user_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):
    s=lock_startup(conn,startup_id);owner_only(s,me['id'])
    r=run(conn,'UPDATE recruiter_grants SET revoked_at=clock_timestamp() WHERE startup_id=:s AND user_id=:u AND revoked_at IS NULL RETURNING id',s=startup_id,u=user_id).scalar()
    guard(r is not None,'RECRUITER_NOT_FOUND',404)
    evt(conn,startup_id,me['id'],'recruiter_grant',r,'recruiter.revoked')
    return None

# --- Tests, histories, notifications, and deletion ---
class TestVersionCreate(RequestModel):
    description:str=Field(min_length=1)
    submission_deadline:datetime
    change_type:Literal['initial','ordinary','critical']
    reason:str=''
class SubmissionCreate(RequestModel):test_version_id:uuid.UUID;solution_url:str=Field(pattern='^https://',min_length=9)
class SubmissionReview(RequestModel):status:Literal['reviewed']

def test_payload(row):
    return record({k:row[k] for k in ['id','vacancy_id','version','description','submission_deadline','change_type']})
@app.get('/api/v1/vacancies/{vacancy_id}/tests/current')
def current_test(vacancy_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    t=run(conn,'''SELECT * FROM test_assignment_versions WHERE vacancy_id=:v ORDER BY version DESC LIMIT 1''',v=vacancy_id).mappings().first()
    if not t:err('TEST_NOT_FOUND',404)
    return test_payload(t)
@app.get('/api/v1/vacancies/{vacancy_id}/tests/versions')
@paged
def list_test_versions(vacancy_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    r=run(conn,'SELECT startup_id FROM vacancies WHERE id=:v',v=vacancy_id).mappings().first()
    if not r:err('VACANCY_NOT_FOUND',404)
    s=lock_startup(conn,r['startup_id'])
    allowed=can_manage(conn,s,me['id']) or bool(run(conn,'SELECT 1 FROM applications WHERE vacancy_id=:v AND applicant_id=:u',v=vacancy_id,u=me['id']).scalar())
    guard(allowed,'PERMISSION_DENIED',403)
    return items([test_payload(t) for t in run(conn,'SELECT * FROM test_assignment_versions WHERE vacancy_id=:v ORDER BY version DESC',v=vacancy_id).mappings().all()])
@app.post('/api/v1/vacancies/{vacancy_id}/tests/versions',status_code=201)
@command(201)
def create_test_version(vacancy_id:uuid.UUID,body:TestVersionCreate,conn:Connection=Depends(db),me=Depends(domain_auth)):
    r=run(conn,'SELECT startup_id FROM vacancies WHERE id=:v',v=vacancy_id).mappings().first()
    if not r:err('VACANCY_NOT_FOUND',404)
    s=lock_startup(conn,r['startup_id'])
    guard(s['status']=='active','STARTUP_INACTIVE')
    guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    guard(body.submission_deadline.tzinfo is not None and body.submission_deadline>ts(conn),'INVALID_DEADLINE',422)
    guard(run(conn,'SELECT status FROM vacancies WHERE id=:v',v=vacancy_id).scalar()!='archived','VACANCY_ARCHIVED')
    n=run(conn,'SELECT COALESCE(MAX(version),0) FROM test_assignment_versions WHERE vacancy_id=:v',v=vacancy_id).scalar()+1
    guard((n==1 and body.change_type=='initial') or (n>1 and body.change_type!='initial'),'INVALID_CHANGE_TYPE',422)
    r=run(conn,'''INSERT INTO test_assignment_versions(vacancy_id,version,description,submission_deadline,change_type,reason,created_by)
             VALUES(:v,:n,:descr,:deadline,:kind,:reason,:by) RETURNING *''',v=vacancy_id,n=n,descr=body.description,deadline=body.submission_deadline,kind=body.change_type,reason=body.reason,by=me['id']).mappings().one()
    if body.change_type=='critical':
        run(conn,'''UPDATE test_submissions SET status='superseded'
          WHERE test_version_id IN(SELECT id FROM test_assignment_versions WHERE vacancy_id=:v AND version<:n)
          AND attempt_id IN (SELECT at.id FROM application_attempts at JOIN applications a ON a.id=at.application_id
          WHERE a.vacancy_id=:v AND at.status IN ('pending','reviewing','offer_pending'))''',v=vacancy_id,n=n)
    evt(conn,s['id'],me['id'],'test_assignment',r['id'],'test.version.created',critical=body.change_type=='critical')
    return test_payload(r)

def check_application_visibility(conn,app_id,actor):
    a=run(conn,'SELECT applicant_id,startup_id FROM applications WHERE id=:id',id=app_id).mappings().first()
    if not a:err('APPLICATION_NOT_FOUND',404)
    if str(a['applicant_id'])!=str(actor['id']):
        s=lock_startup(conn,a['startup_id']);guard(can_manage(conn,s,actor['id']),'PERMISSION_DENIED',403)
    return a
@app.get('/api/v1/applications/{application_id}/test-submissions')
@paged
def list_submissions(application_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    check_application_visibility(conn,application_id,me)
    rows=run(conn,'''SELECT t.id,t.attempt_id,t.test_version_id,t.solution_url,t.status,t.submitted_at
       FROM test_submissions t JOIN application_attempts at ON at.id=t.attempt_id
       WHERE at.application_id=:a ORDER BY t.submitted_at DESC''',a=application_id).mappings().all()
    return items(rows)
@app.post('/api/v1/applications/{application_id}/test-submissions',status_code=201)
@command(201)
def submit_test(application_id:uuid.UUID,body:SubmissionCreate,conn:Connection=Depends(db),me=Depends(domain_auth)):
    a=run(conn,'SELECT * FROM applications WHERE id=:a',a=application_id).mappings().first()
    if not a:err('APPLICATION_NOT_FOUND',404)
    s=lock_startup(conn,a['startup_id'])
    guard(str(a['applicant_id'])==str(me['id']),'PERMISSION_DENIED',403)
    guard(a['vacancy_id'] is not None,'NO_TEST_FOR_GENERAL_APPLICATION')
    current=application_row(conn,application_id)
    guard(current['status'] in ('pending','reviewing','offer_pending'),'APPLICATION_NOT_ACTIVE')
    test=run(conn,'SELECT * FROM test_assignment_versions WHERE id=:v',v=body.test_version_id).mappings().first()
    if not test:err('TEST_NOT_FOUND',404)
    guard(test['vacancy_id']==a['vacancy_id'],'TEST_VERSION_CONFLICT')
    guard(not run(conn,"""SELECT 1 FROM test_assignment_versions
       WHERE vacancy_id=:v AND version>:n AND change_type='critical' """,
       v=a['vacancy_id'],n=test['version']).scalar(),'TEST_VERSION_CONFLICT')
    guard(test['submission_deadline']>ts(conn),'TEST_DEADLINE_PASSED')
    guard(not run(conn,'SELECT 1 FROM test_submissions WHERE attempt_id=:a AND test_version_id=:v',a=current['attempt_id'],v=test['id']).scalar(),'TEST_ALREADY_SUBMITTED')
    row=run(conn,'''INSERT INTO test_submissions(attempt_id,test_version_id,solution_url)
       VALUES(:a,:v,:url) RETURNING id,attempt_id,test_version_id,solution_url,status,submitted_at''',a=current['attempt_id'],v=test['id'],url=body.solution_url).mappings().one()
    evt(conn,s['id'],me['id'],'test_submission',row['id'],'test.submitted')
    return record(row)
@app.patch('/api/v1/test-submissions/{submission_id}')
@command(200)
def review_test(submission_id:uuid.UUID,body:SubmissionReview,conn:Connection=Depends(db),me=Depends(domain_auth)):
    r=run(conn,'''SELECT t.id,t.attempt_id,a.startup_id,a.applicant_id
      FROM test_submissions t JOIN application_attempts at ON at.id=t.attempt_id
      JOIN applications a ON a.id=at.application_id WHERE t.id=:id''',id=submission_id).mappings().first()
    if not r:err('SUBMISSION_NOT_FOUND',404)
    s=lock_startup(conn,r['startup_id'])
    guard(can_manage(conn,s,me['id']) and str(me['id'])!=str(r['applicant_id']),'PERMISSION_DENIED',403)
    changed=run(conn,"UPDATE test_submissions SET status='reviewed',reviewed_by=:user,reviewed_at=clock_timestamp() WHERE id=:id AND status='submitted' RETURNING id",user=me['id'],id=submission_id).scalar()
    guard(changed is not None,'SUBMISSION_NOT_REVIEWABLE')
    evt(conn,s['id'],me['id'],'test_submission',submission_id,'test.reviewed')
    return record(run(conn,'SELECT id,attempt_id,test_version_id,solution_url,status,submitted_at FROM test_submissions WHERE id=:id',id=submission_id).mappings().one())
@app.get('/api/v1/applications/{application_id}/history')
@paged
def app_history(application_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    check_application_visibility(conn,application_id,me)
    return items(run(conn,"""SELECT e.id,e.event_type,e.entity_type,e.entity_id,e.created_at,e.metadata,u.name AS actor_name
      FROM events e LEFT JOIN users u ON u.id=e.actor_id WHERE
      (e.entity_type='application' AND e.entity_id=:a)
      OR (e.entity_type='offer' AND e.entity_id IN(SELECT o.id FROM offers o JOIN application_attempts at ON at.id=o.attempt_id WHERE at.application_id=:a))
      OR (e.entity_type='test_submission' AND e.entity_id IN(SELECT t.id FROM test_submissions t JOIN application_attempts at ON at.id=t.attempt_id WHERE at.application_id=:a))
      OR (e.entity_type='membership' AND e.entity_id IN(SELECT sm.id FROM startup_members sm JOIN offers o ON o.id=sm.joined_via_offer_id JOIN application_attempts at ON at.id=o.attempt_id WHERE at.application_id=:a))
      OR (e.entity_type='vacancy' AND e.entity_id IN(SELECT vacancy_id FROM applications WHERE id=:a))
      OR (e.entity_type='test_assignment' AND e.entity_id IN(SELECT tv.id FROM test_assignment_versions tv JOIN applications a ON a.vacancy_id=tv.vacancy_id WHERE a.id=:a))""",a=application_id).mappings().all())

@app.get('/api/v1/applications/{application_id}/attempts')
@paged
def attempt_history(application_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    check_application_visibility(conn,application_id,me)
    return items(run(conn,"""SELECT at.id,at.application_id,at.status,at.message,at.rejection_reason,
      at.is_current,at.vacancy_version_id,at.created_at,vv.version AS vacancy_version,
      vv.title,vv.description,vv.requirements FROM application_attempts at
      LEFT JOIN vacancy_versions vv ON vv.id=at.vacancy_version_id WHERE at.application_id=:a""",a=application_id).mappings().all())

@app.get('/api/v1/startups/{startup_id}/offers')
@paged
def startup_offers(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    s=lock_startup(conn,startup_id);guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    expire_offers(conn,startup_id)
    return items(run(conn,OFFER_SELECT+' WHERE o.startup_id=:s',s=startup_id).mappings().all())

@app.get('/api/v1/startups/{startup_id}/recruiter-invitations')
@paged
def startup_recruiter_invitations(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    s=lock_startup(conn,startup_id);owner_only(s,me['id'])
    expire_recruiter_invitations(conn,startup_id)
    return items(run(conn,RECRUITER_INVITATION_SELECT+' WHERE startup_id=:s',s=startup_id).mappings().all())

@app.get('/api/v1/startups/{startup_id}/events')
@paged
def startup_events(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(auth)):
    s=lock_startup(conn,startup_id);guard(can_manage(conn,s,me['id']),'PERMISSION_DENIED',403)
    return items(run(conn,'SELECT id,event_type,entity_type,entity_id,created_at FROM events WHERE startup_id=:s ORDER BY created_at DESC',s=startup_id).mappings().all())
@app.get('/api/v1/notifications')
@paged
def notifications(conn:Connection=Depends(db),me=Depends(auth)):
    return items(run(conn,'SELECT id,title,message,read_at,created_at FROM notifications WHERE recipient_id=:u ORDER BY created_at DESC',u=me['id']).mappings().all())
@app.patch('/api/v1/notifications/{notification_id}/read')
@command(200)
def read_notification(notification_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):
    r=run(conn,'UPDATE notifications SET read_at=COALESCE(read_at,clock_timestamp()) WHERE id=:id AND recipient_id=:u RETURNING id,title,message,read_at,created_at',id=notification_id,u=me['id']).mappings().first()
    if not r:err('NOTIFICATION_NOT_FOUND',404)
    return record(r)
@app.delete('/api/v1/startups/{startup_id}',status_code=204)
@command(204)
def delete_empty_startup(startup_id:uuid.UUID,conn:Connection=Depends(db),me=Depends(domain_auth)):
    s=lock_startup(conn,startup_id);owner_only(s,me['id'])
    for table in ['applications','offers','startup_members','recruiter_invitations','recruiter_grants']:
        guard(not run(conn,f'SELECT 1 FROM {table} WHERE startup_id=:s LIMIT 1',s=startup_id).scalar(),'HISTORY_PREVENTS_DELETE')
    guard(not run(conn,'''SELECT 1 FROM test_submissions ts
        JOIN application_attempts a ON a.id=ts.attempt_id JOIN applications ap ON ap.id=a.application_id
        WHERE ap.startup_id=:s LIMIT 1''',s=startup_id).scalar(),'HISTORY_PREVENTS_DELETE')
    # No external interactions: remove owner-generated vacancy/test version history.
    run(conn,'DELETE FROM events WHERE startup_id=:s',s=startup_id)
    run(conn,'DELETE FROM test_assignment_versions WHERE vacancy_id IN (SELECT id FROM vacancies WHERE startup_id=:s)',s=startup_id)
    run(conn,'DELETE FROM vacancy_versions WHERE vacancy_id IN (SELECT id FROM vacancies WHERE startup_id=:s)',s=startup_id)
    run(conn,'DELETE FROM vacancies WHERE startup_id=:s',s=startup_id)
    run(conn,'DELETE FROM startups WHERE id=:s',s=startup_id)
    return None
