"""Generate target OpenAPI 3.1 contract; independent of implementation coverage."""
from pathlib import Path
import re
import yaml

O = {'openapi':'3.1.0', 'info':{'title':'Startup Team MVP API', 'version':'0.5.0', 'description':'Prototype contract for the selected 12-feature scope; see docs/IMPLEMENTATION_STATUS.md for verification limits.'},
     'servers':[{'url':'/api/v1'}], 'tags':[{'name':x} for x in ['auth','users','startups','vacancies','applications','offers','team','recruiters','tests','notifications','history']],
     'components':{'securitySchemes':{'sessionCookie':{'type':'apiKey','in':'cookie','name':'session'}}, 'schemas':{}}, 'paths':{}}
S=O['components']['schemas']
def obj(props,required=()): return {'type':'object','properties':props,'required':list(required),'additionalProperties':False}
def st(**kw): return {'type':'string',**kw}
def rf(n): return {'$ref':f'#/components/schemas/{n}'}
def ar(schema): return {'type':'array','items':schema}
UUID=st(format='uuid'); TIME=st(format='date-time'); URL=st(format='uri'); BOOL={'type':'boolean'}; INT={'type':'integer'}
S['Error']=obj({'error':obj({'code':st(),'message':st(),'details':{'type':'object','additionalProperties':True},'request_id':UUID},['code','message','details','request_id'])},['error'])
S['User']=obj({'id':UUID,'name':st(),'bio':st(),'skills':ar(st()),'portfolio_url':{'anyOf':[URL,{'type':'null'}]}},['id','name','bio','skills'])
S['TelegramLogin']=obj({'init_data':st(minLength=1,maxLength=16384)},['init_data'])
S['AuthConfig']=obj({'telegram_enabled':BOOL,'demo_enabled':BOOL},['telegram_enabled','demo_enabled'])
S['AuthContext']=obj({'onboarding_required':BOOL},['onboarding_required'])
S['Login']=obj({'email':st(format='email'),'password':st(minLength=1)},['email','password'])
S['UserUpdate']=obj({'name':st(minLength=1,maxLength=120),'bio':st(maxLength=5000),'skills':ar(st()),'portfolio_url':{'anyOf':[URL,{'type':'null'}]}})
S['StartupCreate']=obj({'title':st(minLength=1,maxLength=180),'description':st(),'allow_general_applications':BOOL},['title','description'])
S['StartupUpdate']=obj({'title':st(minLength=1,maxLength=180),'description':st(),'allow_general_applications':BOOL})
S['Startup']=obj({'id':UUID,'owner_id':UUID,'title':st(),'description':st(),'status':st(enum=['active','paused','archived']),'allow_general_applications':BOOL,'revision':INT},['id','owner_id','title','description','status','allow_general_applications','revision'])
S['VacancyCreate']=obj({'title':st(minLength=1,maxLength=180),'description':st(),'requirements':st(),'positions_count':{'type':'integer','minimum':1,'maximum':2147483647},'application_deadline':TIME},['title','description','requirements','positions_count','application_deadline'])
S['VacancySettings']=obj({'positions_count':{'type':'integer','minimum':1,'maximum':2147483647},'application_deadline':TIME})
S['VacancyChange']=obj({'title':st(minLength=1,maxLength=180),'description':st(),'requirements':st(),'change_mode':st(enum=['keep_applications','reset_applications']),'reason':st()},['title','description','requirements','change_mode'])
S['Vacancy']=obj({'id':UUID,'startup_id':UUID,'title':st(),'description':st(),'requirements':st(),'positions_count':INT,'application_deadline':TIME,'status':st(enum=['published','intake_closed','archived']),'current_version':INT,'revision':INT},['id','startup_id','title','description','requirements','positions_count','application_deadline','status','current_version','revision'])
S['VacancyVersion']=obj({'id':UUID,'vacancy_id':UUID,'version':INT,'title':st(),'description':st(),'requirements':st(),'change_mode':st(),'created_at':TIME},['id','vacancy_id','version','title','description','requirements','change_mode','created_at'])
S['Capacity']=obj({'positions_count':INT,'occupied':INT,'reserved':INT,'available':INT},['positions_count','occupied','reserved','available'])
S['ApplicationCreate']=obj({'target_type':st(enum=['vacancy','startup']),'target_id':UUID,'message':st(maxLength=5000)},['target_type','target_id'])
S['Application']=obj({'id':UUID,'startup_id':UUID,'vacancy_id':{'anyOf':[UUID,{'type':'null'}]},'applicant_id':UUID,'attempt_id':UUID,'status':st(enum=['pending','reviewing','offer_pending','rejected','withdrawn','reset','joined','declined','already_joined','closed']),'message':st(),'revision':INT,'created_at':TIME},['id','startup_id','applicant_id','attempt_id','status','message','revision','created_at'])
S['AttemptCreate']=obj({'message':st(maxLength=5000)},[])
S['RejectBody']=obj({'reason':st(maxLength=2000)},[])
S['OfferCreate']=obj({'expires_at':TIME,'message':st(maxLength=5000)},['expires_at'])
S['Offer']=obj({'id':UUID,'startup_id':UUID,'candidate_id':UUID,'vacancy_id':{'anyOf':[UUID,{'type':'null'}]},'status':st(enum=['pending','accepted','declined','revoked','expired']),'expires_at':TIME,'revision':INT},['id','startup_id','candidate_id','status','expires_at','revision'])
S['Member']=obj({'id':UUID,'startup_id':UUID,'user_id':UUID,'joined_at':TIME,'left_at':{'anyOf':[TIME,{'type':'null'}]}},['id','startup_id','user_id','joined_at'])
S['RecruiterInvitationCreate']=obj({'user_id':UUID,'expires_at':TIME},['user_id','expires_at'])
S['RecruiterInvitation']=obj({'id':UUID,'startup_id':UUID,'user_id':UUID,'status':st(enum=['pending','accepted','declined','revoked','expired']),'expires_at':TIME},['id','startup_id','user_id','status','expires_at'])
S['RecruiterGrant']=obj({'id':UUID,'startup_id':UUID,'user_id':UUID,'granted_at':TIME},['id','startup_id','user_id','granted_at'])
S['TestVersionCreate']=obj({'description':st(minLength=1),'submission_deadline':TIME,'change_type':st(enum=['initial','ordinary','critical']),'reason':st()},['description','submission_deadline','change_type'])
S['TestVersion']=obj({'id':UUID,'vacancy_id':UUID,'version':INT,'description':st(),'submission_deadline':TIME,'change_type':st()},['id','vacancy_id','version','description','submission_deadline','change_type'])
S['TestSubmissionCreate']=obj({'test_version_id':UUID,'solution_url':st(format='uri',pattern='^https://')},['test_version_id','solution_url'])
S['TestSubmission']=obj({'id':UUID,'attempt_id':UUID,'test_version_id':UUID,'solution_url':URL,'status':st(enum=['submitted','reviewed','superseded']),'submitted_at':TIME},['id','attempt_id','test_version_id','solution_url','status','submitted_at'])
S['TestReview']=obj({'status':st(const='reviewed')},['status'])
S['Notification']=obj({'id':UUID,'title':st(),'message':st(),'read_at':{'anyOf':[TIME,{'type':'null'}]},'created_at':TIME},['id','title','message','created_at'])
S['Event']=obj({'id':UUID,'event_type':st(),'entity_type':st(),'entity_id':UUID,'created_at':TIME},['id','event_type','entity_type','entity_id','created_at'])
S['Csrf']=obj({'csrf_token':st()},['csrf_token'])
S['ListStartup']=obj({'items':ar(rf('Startup')),'next_cursor':{'anyOf':[st(),{'type':'null'}]}},['items','next_cursor'])
for name in ['Vacancy','Application','Offer','Member','RecruiterInvitation','RecruiterGrant','VacancyVersion','TestVersion','TestSubmission','Notification','Event']:
 S['List'+name]=obj({'items':ar(rf(name)),'next_cursor':{'anyOf':[st(),{'type':'null'}]}},['items','next_cursor'])

def route(method, path, tag, summary, output=None, request=None, auth=True, status=None, headers=True, paged=False):
 op={'operationId':re.sub(r'[^a-zA-Z0-9]+','_',method.lower()+'_'+path.strip('/')).strip('_'), 'tags':[tag], 'summary':summary}
 if auth: op['security']=[{'sessionCookie':[]}]
 if status is None: status='201' if method=='post' and (summary.startswith('Создать') or summary.startswith('Отправить') or summary.startswith('Пригласить')) else '200'
 if request:
  op['requestBody']={'required':True,'content':{'application/json':{'schema':rf(request)}}}
 params=[]
 for par in re.findall(r'\{(\w+)\}',path):params.append({'name':par,'in':'path','required':True,'schema':UUID})
 if paged:params.extend([{'name':'limit','in':'query','schema':{'type':'integer','minimum':1,'maximum':100,'default':20}}, {'name':'cursor','in':'query','schema':st()}])
 if auth and method in ['post','patch','delete'] and headers:
  params.append({'name':'X-CSRF-Token','in':'header','required':True,'schema':st()})
 if auth and method in ['post','patch','delete'] and headers and (request or method in ['post','patch','delete']):
  params.append({'name':'Idempotency-Key','in':'header','required':False,'schema':st(minLength=8,maxLength=120), 'description':'Optional command receipt key. Reuse the same key after a lost response; same actor/key with a different path, body or If-Match returns 409. Successful effects and receipts commit atomically.'})
 if params:op['parameters']=params
 op['responses']={str(status):({'description':'Successful response','content':{'application/json':{'schema':rf(output)}}} if output else {'description':'Success, no response body'})}
 for code in [400,401,403,404,409,422]:
  if auth or code not in [401,403]:op['responses'][str(code)]={'description':'Failure','content':{'application/json':{'schema':rf('Error')}}}
 O['paths'].setdefault(path,{})[method]=op

# Authentication
route('post','/auth/login','auth','Войти','User','Login',False)
route('post','/auth/telegram','auth','Войти через проверенный Telegram initData','User','TelegramLogin',False)
route('get','/auth/config','auth','Доступные способы входа','AuthConfig',auth=False)
route('get','/auth/context','auth','Первое заполнение профиля','AuthContext')
O['paths']['/auth/telegram']['post']['description']='Validate HMAC and auth_date, create or find a unique Telegram identity, and issue the existing HttpOnly session. Raw Telegram IDs are not accepted. Reusing launch data in another browser returns 409; an existing bound live session may refresh without creating another session. First profile save with an explicit name completes onboarding.'
O['paths']['/auth/telegram']['post']['responses']['503']={'description':'Telegram bot token is not configured','content':{'application/json':{'schema':rf('Error')}}}
O['paths']['/auth/telegram']['post']['responses']['415']={'description':'JSON required','content':{'application/json':{'schema':rf('Error')}}}
route('post','/auth/logout','auth','Выйти',None,None,True,'204')
route('get','/auth/me','auth','Текущий пользователь','User')
route('get','/auth/csrf','auth','CSRF токен','Csrf')
route('get','/users/{user_id}','users','Публичный профиль','User')
route('patch','/users/me','users','Изменить свой профиль','User','UserUpdate')
# Startups
route('get','/startups','startups','Лента стартапов','ListStartup',paged=True)
route('post','/startups','startups','Создать стартап','Startup','StartupCreate')
route('get','/startups/{startup_id}','startups','Просмотр стартапа','Startup')
route('patch','/startups/{startup_id}','startups','Изменить стартап','Startup','StartupUpdate')
for action in ['pause','resume','archive']:route('post',f'/startups/{{startup_id}}/{action}','startups',f'{action} стартап','Startup')
route('delete','/startups/{startup_id}','startups','Удалить стартап без истории',status='204')
# Vacancies
route('get','/vacancies','vacancies','Лента вакансий','ListVacancy',paged=True)
route('get','/vacancies/{vacancy_id}','vacancies','Просмотр вакансии','Vacancy')
route('get','/startups/{startup_id}/vacancies','vacancies','Вакансии стартапа','ListVacancy',paged=True)
route('post','/startups/{startup_id}/vacancies','vacancies','Создать вакансию','Vacancy','VacancyCreate')
route('post','/vacancies/{vacancy_id}/versions','vacancies','Создать версию вакансии','VacancyVersion','VacancyChange')
route('get','/vacancies/{vacancy_id}/versions','vacancies','История версий вакансии','ListVacancyVersion',paged=True)
for action in ['close-intake','reopen-intake','archive']:route('post',f'/vacancies/{{vacancy_id}}/{action}','vacancies',f'{action} вакансию','Vacancy')
route('get','/vacancies/{vacancy_id}/capacity','vacancies','Места в вакансии','Capacity')
route('patch','/vacancies/{vacancy_id}/settings','vacancies','Обновить срок или число мест','Vacancy','VacancySettings')
# Applications
route('post','/applications','applications','Создать отклик','Application','ApplicationCreate')
route('get','/applications/mine','applications','Мои отклики','ListApplication',paged=True)
route('get','/applications/{application_id}','applications','Подробности отклика','Application')
route('get','/startups/{startup_id}/applications','applications','Полученные отклики стартапа','ListApplication',paged=True)
for action in ['withdraw','restore','review']:route('post',f'/applications/{{application_id}}/{action}','applications',f'{action} отклик','Application')
route('post','/applications/{application_id}/reject','applications','Отклонить отклик','Application','RejectBody')
route('post','/applications/{application_id}/attempts','applications','Новая попытка после сброса','Application','AttemptCreate')
route('get','/applications/{application_id}/history','history','История отклика','ListEvent',paged=True)
# Offers
route('post','/applications/{application_id}/offers','offers','Отправить приглашение','Offer','OfferCreate')
route('get','/offers/mine','offers','Мои приглашения','ListOffer',paged=True)
route('get','/offers/{offer_id}','offers','Подробности приглашения','Offer')
for action in ['accept','decline','revoke']:route('post',f'/offers/{{offer_id}}/{action}','offers',f'{action} приглашение','Offer')
# Team and recruiters
route('get','/startups/{startup_id}/members','team','Участники команды','ListMember',paged=True)
route('post','/startups/{startup_id}/members/leave','team','Покинуть стартап',status='204')
route('delete','/startups/{startup_id}/members/{user_id}','team','Исключить участника',status='204')
route('post','/startups/{startup_id}/recruiter-invitations','recruiters','Пригласить рекрутера','RecruiterInvitation','RecruiterInvitationCreate')
route('get','/recruiter-invitations/mine','recruiters','Мои приглашения рекрутером','ListRecruiterInvitation',paged=True)
for action in ['accept','decline']:route('post',f'/recruiter-invitations/{{invitation_id}}/{action}','recruiters',f'{action} рекрутерское приглашение','RecruiterInvitation')
route('post','/recruiter-invitations/{invitation_id}/revoke','recruiters','Отозвать ожидающее приглашение рекрутера','RecruiterInvitation')
route('get','/startups/{startup_id}/recruiters','recruiters','Рекрутеры стартапа','ListRecruiterGrant',paged=True)
route('delete','/startups/{startup_id}/recruiters/{user_id}','recruiters','Отозвать полномочия',status='204')
# Tests
route('get','/vacancies/{vacancy_id}/tests/current','tests','Актуальное тестовое','TestVersion')
route('get','/vacancies/{vacancy_id}/tests/versions','tests','Версии тестового','ListTestVersion',paged=True)
route('post','/vacancies/{vacancy_id}/tests/versions','tests','Создать версию тестового','TestVersion','TestVersionCreate')
route('get','/applications/{application_id}/test-submissions','tests','Решения кандидата','ListTestSubmission',paged=True)
route('post','/applications/{application_id}/test-submissions','tests','Отправить решение','TestSubmission','TestSubmissionCreate')
route('patch','/test-submissions/{submission_id}','tests','Проверить решение','TestSubmission','TestReview')
# Notifications
route('get','/notifications','notifications','Мои уведомления','ListNotification',paged=True)
route('patch','/notifications/{notification_id}/read','notifications','Отметить прочитанным','Notification')
route('get','/startups/{startup_id}/events','history','История событий стартапа','ListEvent',paged=True)

O['paths']['/startups']['get']['parameters'].append({'name':'scope','in':'query','schema':{'type':'string','enum':['public','managed'],'default':'public'},'description':'public: active feed; managed: own startups and current recruiter grants, including paused/archived.'})
O['paths']['/startups/{startup_id}/members']['get']['description']='Current members are visible to authenticated users. Only owner/active recruiter may read departed membership history. No email or departure reason is exposed.'
O['paths']['/offers/{offer_id}/revoke']['post']['description']='Only owner/active recruiter; a recruiter cannot revoke an offer concerning their own candidacy. Candidate accept/decline remain available.'
O['paths']['/test-submissions/{submission_id}']['patch']['description']='Only submitted solutions may be reviewed. Superseded or already reviewed submissions return 409 without producing a review event.'

# Contextual RBAC applies in addition to the cookie authentication check.
READ_RULES={
  ('get','/applications/{application_id}'):'Applicant or startup owner/active recruiter only. A team member without recruiter privileges is NOT allowed.',
  ('get','/startups/{startup_id}/applications'):'Startup owner or active recruiter only; a normal team member has no access.',
  ('get','/applications/{application_id}/history'):'Applicant or startup owner/active recruiter only; private application events only.',
  ('get','/applications/{application_id}/test-submissions'):'Applicant or startup owner/active recruiter only.',
  ('get','/startups/{startup_id}/events'):'Startup owner or active recruiter only; no access for unrelated accounts or members without recruiter grants.',
  ('get','/vacancies/{vacancy_id}/tests/versions'):'Owner/active recruiter of parent startup, or candidate who has applied to this vacancy.',
  ('get','/offers/{offer_id}'):'Offer candidate or owner/active recruiter of the parent startup.',
}
for (method,path), rule in READ_RULES.items():
 O['paths'][path][method]['description']=rule
O['paths']['/applications/{application_id}/test-submissions']['post']['description']='Explicit test_version_id is required. Server never silently binds submission to another version. Newer critical version causes TEST_VERSION_CONFLICT. Active attempts include offer_pending: a candidate with a pending offer may submit a replacement solution.'
O['paths']['/vacancies/{vacancy_id}/settings']['patch']['description']='positions_count may not be reduced below occupied plus unexpired reserved seats, evaluated inside startup-locked transaction.'
O['paths']['/recruiter-invitations/{invitation_id}/revoke']['post']['description']='Only startup owner; only pending invitation can be revoked. Pause allows revocation; archive revokes pending invitations.'

S['UserUpdate']['properties']['portfolio_url']['anyOf'][0]={**URL,'pattern':'^https?://'}
S['StartupCreate']['required']=['title']
S['VacancyCreate']['required']=['title','positions_count','application_deadline']
S['VacancyChange']['required']=['title','change_mode']
S['Vacancy']['properties'].update({'owner_id':UUID,'startup_status':st()})

# Implemented additions: history snapshots and discovery are explicit API resources.
nullable_text={'anyOf':[st(),{'type':'null'}]}
nullable_uuid={'anyOf':[UUID,{'type':'null'}]}
S['Application']['properties'].update({'vacancy_version_id':nullable_uuid,'rejection_reason':st(),'startup_title':st(),'applicant_name':st(),'vacancy_title':nullable_text})
S['Offer']['properties'].update({'attempt_id':UUID,'vacancy_version_id':nullable_uuid,'message':st(),'startup_title':st(),'vacancy_title':nullable_text,'vacancy_description':nullable_text,'vacancy_requirements':nullable_text})
S['Event']['properties'].update({'metadata':{'type':'object','additionalProperties':True},'actor_name':nullable_text})
S['Attempt']=obj({'id':UUID,'application_id':UUID,'status':st(),'message':st(),'rejection_reason':st(),'is_current':BOOL,'vacancy_version_id':nullable_uuid,'created_at':TIME,'vacancy_version':{'anyOf':[INT,{'type':'null'}]},'title':nullable_text,'description':nullable_text,'requirements':nullable_text},['id','application_id','status','message','rejection_reason','is_current','created_at'])
for name in ['Attempt','User']:
 S['List'+name]=obj({'items':ar(rf(name)),'next_cursor':{'anyOf':[st(),{'type':'null'}]}},['items','next_cursor'])
route('get','/users','users','Поиск участника по имени','ListUser',paged=True)
O['paths']['/users']['get']['parameters'].append({'name':'query','in':'query','required':True,'schema':st(minLength=2,maxLength=120)})
route('get','/applications/{application_id}/attempts','applications','Исторические попытки и условия','ListAttempt',paged=True)
O['paths']['/applications/{application_id}/attempts']['get']['description']='Applicant or current owner/recruiter only; historical messages and exact vacancy conditions are preserved.'
route('get','/startups/{startup_id}/offers','offers','Приглашения стартапа','ListOffer',paged=True)
O['paths']['/startups/{startup_id}/offers']['get']['description']='Current owner/recruiter only.'
route('get','/startups/{startup_id}/recruiter-invitations','recruiters','Приглашения рекрутеров стартапа','ListRecruiterInvitation',paged=True)
O['paths']['/startups/{startup_id}/recruiter-invitations']['get']['description']='Startup owner only.'
for param in O['paths']['/startups']['get']['parameters']:
 if param['name']=='scope':param['schema']['enum'].append('member')
for path,methods in O['paths'].items():
 for method,operation in methods.items():
  if method in ('post','patch','delete') and path not in ('/auth/login','/auth/telegram','/auth/logout','/users/me'):
   operation['description']=operation.get('description','')+' Telegram users must complete their profile first (PATCH /users/me with an explicit name); otherwise 403 ONBOARDING_REQUIRED. Auth/profile endpoints and reads remain available; demo accounts are unaffected.'
  if method=='get' and path in ('/recruiter-invitations/mine','/startups/{startup_id}/recruiter-invitations'):
   operation['description']=operation.get('description','')+' Pending invitations whose expires_at has passed are returned as expired using database time, independent of owner reads or rejected accept commands.'
  if method=='get' and any(p.get('name')=='cursor' for p in operation.get('parameters',[])):
   operation['description']=operation.get('description','')+' Pages use UUID ascending order, signed cursors bound to actor/path/filters, limit 1..100 (default 20). Invalid or mismatched cursors return 422; new rows before the cursor appear on refresh.'
  if method in ('post','patch','delete') and any(x in path for x in ('{startup_id}','{vacancy_id}','{application_id}','{offer_id}')):
   operation.setdefault('parameters',[]).append({'name':'If-Match','in':'header','required':False,'schema':st(pattern='^"[1-9][0-9]*"$'),'description':'Quoted resource revision; stale state returns 409 REVISION_CONFLICT. Replay of an existing command receipt precedes this check.'})
  if '200' in operation['responses'] or '201' in operation['responses']:
   if method in ('post','patch','delete'):
    for code in ('200','201','204'):
     if code in operation['responses']:operation['responses'][code].setdefault('headers',{})['Idempotency-Replayed']={'schema':st(),'description':'true for replay of an actor-bound stored command result'}

out=Path(__file__).resolve().parent.parent/'contracts'/'openapi.yaml' 
out.write_text(yaml.safe_dump(O,sort_keys=False,allow_unicode=True,width=120),encoding='utf-8')
print(f'{out}: {len(O["paths"])} paths, {sum(map(len,O["paths"].values()))} operations, {len(S)} schemas')
