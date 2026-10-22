"""Minimal first-party auth. Sessions/CSRF are bound to server state."""
import hashlib, secrets, hmac, os
from datetime import datetime, timezone
from fastapi import Request, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.engine import Connection
from .database import db
SECRET=os.getenv('CSRF_SECRET','dev-only-change-me')
COOKIE_SECURE=os.getenv('COOKIE_SECURE','false').lower()=='true'

def hash_password(password: str) -> str:
    salt=secrets.token_bytes(16)
    digest=hashlib.pbkdf2_hmac('sha256',password.encode(),salt,350_000)
    return f'pbkdf2_sha256$350000${salt.hex()}${digest.hex()}'
def verify_password(password: str, stored: str) -> bool:
    if not stored:return False
    try:
        alg, rounds, sh, dh=stored.split('$')
        if alg!='pbkdf2_sha256': return False
        digest=hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(sh),int(rounds))
        return hmac.compare_digest(digest,bytes.fromhex(dh))
    except (ValueError, TypeError):return False

def digest(token: str):return hashlib.sha256(token.encode()).hexdigest()
def csrf(token: str):return hmac.new(SECRET.encode(),token.encode(),hashlib.sha256).hexdigest()

def auth(request: Request,conn:Connection=Depends(db)):
    raw=request.cookies.get('session')
    if not raw:raise HTTPException(401,'AUTH_REQUIRED')
    row=conn.execute(text('''SELECT u.id,u.name,u.email,u.bio,u.skills,u.portfolio_url,u.telegram_id,u.onboarding_completed_at
         FROM sessions s JOIN users u ON s.user_id=u.id
         WHERE s.token_digest=:token AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()'''),{'token':digest(raw)}).mappings().first()
    if not row:raise HTTPException(401,'SESSION_EXPIRED')
    if request.method in ('POST','PATCH','PUT','DELETE'):
        supplied=request.headers.get('X-CSRF-Token','')
        if not hmac.compare_digest(supplied,csrf(raw)):raise HTTPException(403,'INVALID_CSRF')
    return dict(row)

def domain_auth(user=Depends(auth)):
    """Profile completion gates domain writes; auth/profile endpoints stay available."""
    if user['telegram_id'] is not None and user['onboarding_completed_at'] is None:
        raise HTTPException(403,'ONBOARDING_REQUIRED')
    return user

def lock_startup(conn:Connection,startup_id):
    row=conn.execute(text('SELECT id,owner_id,status,allow_general_applications FROM startups WHERE id=:id FOR UPDATE'),{'id':startup_id}).mappings().first()
    if not row:raise HTTPException(404,'STARTUP_NOT_FOUND')
    return dict(row)
def can_manage(conn:Connection,startup, user_id):
    if str(startup['owner_id'])==str(user_id):return True
    return bool(conn.execute(text('SELECT 1 FROM recruiter_grants WHERE startup_id=:s AND user_id=:u AND revoked_at IS NULL'),{'s':startup['id'],'u':user_id}).scalar())
def owner_only(startup,user_id):
    if str(startup['owner_id'])!=str(user_id):raise HTTPException(403,'OWNER_ONLY')
