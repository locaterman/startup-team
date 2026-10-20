"""Bounded response pages with actor/query-bound signed keyset cursors.

The prototype materializes authorized list queries before paging. No records are
silently truncated; SQL-side keyset selection is a future scale optimization.
"""
import base64
import functools
import hashlib
import hmac
import inspect
import json
from fastapi import HTTPException, Request
from .security import SECRET


def paged(fn):
    signature=inspect.signature(fn)
    @functools.wraps(fn)
    def execute(*args,**kwargs):
        request=kwargs.pop('page_request')
        try:
            limit=int(request.query_params.get('limit','20'))
            if not 1<=limit<=100:raise ValueError()
        except ValueError:raise HTTPException(422,'INVALID_PAGE_LIMIT')
        binding=json.dumps([str(kwargs['me']['id']),request.url.path,sorted((k,v) for k,v in request.query_params.multi_items() if k not in ('limit','cursor'))],sort_keys=True)
        cursor=request.query_params.get('cursor');last=None
        if cursor:
            try:
                raw,signature_hex=cursor.split('.')
                if not hmac.compare_digest(signature_hex,hmac.new(SECRET.encode(),raw.encode(),hashlib.sha256).hexdigest()):raise ValueError()
                payload=json.loads(base64.urlsafe_b64decode(raw+'='*(-len(raw)%4)))
                if payload['binding']!=binding:raise ValueError()
                last=payload['last']
                if not isinstance(last,str):raise ValueError()
            except (ValueError,KeyError,TypeError,UnicodeDecodeError):raise HTTPException(422,'INVALID_CURSOR')
        result=fn(*args,**kwargs)
        rows=sorted(result['items'],key=lambda r:str(r['id']))
        if last is not None:rows=[r for r in rows if str(r['id'])>last]
        page=rows[:limit];next_cursor=None
        if len(rows)>limit:
            raw=base64.urlsafe_b64encode(json.dumps({'binding':binding,'last':str(page[-1]['id'])},separators=(',',':')).encode()).decode().rstrip('=')
            next_cursor=raw+'.'+hmac.new(SECRET.encode(),raw.encode(),hashlib.sha256).hexdigest()
        return {'items':page,'next_cursor':next_cursor}
    execute.__signature__=signature.replace(parameters=[*signature.parameters.values(),inspect.Parameter('page_request',inspect.Parameter.KEYWORD_ONLY,annotation=Request)])
    return execute
