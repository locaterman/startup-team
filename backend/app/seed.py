"""Create reproducible demo accounts without ever printing their hashes."""
import os
from sqlalchemy import text
from .database import engine
from .security import hash_password
ACCOUNTS=[('ivan@example.test','Ivan Demo','demo-ivan-123'),('maria@example.test','Maria Demo','demo-maria-123'),('alex@example.test','Alex Demo','demo-alex-123')]
if os.getenv('SEED_DEMO_ACCOUNTS','true').lower()!='true':
    print('Demo account seeding disabled')
    raise SystemExit(0)
with engine.begin() as conn:
    for email,name,password in ACCOUNTS:
        if not conn.execute(text('SELECT 1 FROM users WHERE email=:email'),{'email':email}).scalar():
            conn.execute(text('INSERT INTO users(email,name,password_hash) VALUES(:email,:name,:pw)'),{'email':email,'name':name,'pw':hash_password(password)})
print('Demo accounts ready')
