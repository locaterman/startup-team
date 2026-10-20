"""Actor-bound command receipts committed in the same transaction as the effect."""
import functools
import hashlib
import inspect
import json
import re

from fastapi import HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import text


def command(status=200):
    def decorate(fn):
        signature=inspect.signature(fn)
        has_request='request' in signature.parameters
        @functools.wraps(fn)
        def execute(*args, **kwargs):
            request=kwargs['request'] if has_request else kwargs.pop('command_request')
            conn, actor=kwargs['conn'], kwargs['me']['id']
            key=request.headers.get('Idempotency-Key')
            fingerprint=None
            if key is not None:
                if not re.fullmatch(r'[A-Za-z0-9._:-]{8,120}',key):
                    raise HTTPException(422,'INVALID_IDEMPOTENCY_KEY')
                payload={k:(v.model_dump(mode='json') if isinstance(v,BaseModel) else v)
                         for k,v in kwargs.items() if k not in ('request','conn','me')}
                fingerprint=hashlib.sha256(json.dumps(jsonable_encoder({
                    'method':request.method,'path':request.url.path,'body':payload,
                    'if_match':request.headers.get('If-Match')}),sort_keys=True,separators=(',',':')).encode()).hexdigest()
                # Stable across processes; acquire before any domain lock.
                lock=int.from_bytes(hashlib.sha256(f'{actor}:{key}'.encode()).digest()[:8],signed=True)
                conn.execute(text('SELECT pg_advisory_xact_lock(:key)'),{'key':lock})
                receipt=conn.execute(text('SELECT request_hash,http_status,response_body FROM idempotency_keys WHERE actor_id=:actor AND key=:key'),{'actor':actor,'key':key}).mappings().first()
                if receipt:
                    if receipt['request_hash']!=fingerprint:raise HTTPException(409,'IDEMPOTENCY_CONFLICT')
                    return Response(status_code=204) if receipt['http_status']==204 else JSONResponse(status_code=receipt['http_status'],content=receipt['response_body'],headers={'Idempotency-Replayed':'true'})
            match=request.headers.get('If-Match')
            if match is not None:
                check_revision(conn,kwargs,match)
            result=fn(*args,**kwargs)
            code=result.status_code if isinstance(result,Response) else status
            if key is not None and code<400:
                body=json.loads(result.body) if isinstance(result,JSONResponse) and result.body else jsonable_encoder(result)
                if code==204:body=None
                conn.execute(text('INSERT INTO idempotency_keys(actor_id,key,request_hash,http_status,response_body) VALUES(:a,:k,:h,:s,CAST(:b AS jsonb))'),{'a':actor,'k':key,'h':fingerprint,'s':code,'b':json.dumps(body)})
            return result
        if not has_request:
            execute.__signature__=signature.replace(parameters=[*signature.parameters.values(),inspect.Parameter('command_request',inspect.Parameter.KEYWORD_ONLY,annotation=Request)])
        return execute
    return decorate


def check_revision(conn,values,header):
    from .security import lock_startup, can_manage
    if not re.fullmatch(r'"[1-9][0-9]*"',header):raise HTTPException(422,'INVALID_IF_MATCH')
    expected=int(header.strip('"'))
    if 'vacancy_id' in values:
        query='SELECT revision,startup_id FROM vacancies WHERE id=:id';identifier=values['vacancy_id']
    elif 'application_id' in values:
        query='SELECT at.revision,a.startup_id,a.applicant_id AS candidate_id FROM applications a JOIN application_attempts at ON at.application_id=a.id AND at.is_current WHERE a.id=:id';identifier=values['application_id']
    elif 'offer_id' in values:
        query='SELECT revision,startup_id,candidate_id FROM offers WHERE id=:id';identifier=values['offer_id']
    elif 'startup_id' in values:
        query='SELECT revision,id AS startup_id FROM startups WHERE id=:id';identifier=values['startup_id']
    else:raise HTTPException(422,'IF_MATCH_NOT_SUPPORTED')
    row=conn.execute(text(query),{'id':identifier}).mappings().first()
    if not row:raise HTTPException(404,'RESOURCE_NOT_FOUND')
    startup=lock_startup(conn,row['startup_id'])
    if 'candidate_id' in row and str(row['candidate_id'])!=str(values['me']['id']) and not can_manage(conn,startup,values['me']['id']):raise HTTPException(403,'PERMISSION_DENIED')
    row=conn.execute(text(query),{'id':identifier}).mappings().one()
    if row['revision']!=expected:raise HTTPException(409,'REVISION_CONFLICT')
