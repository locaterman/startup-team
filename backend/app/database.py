import os
from sqlalchemy import create_engine
from sqlalchemy.engine import Connection
from typing import Generator
DATABASE_URL=os.getenv('DATABASE_URL','postgresql+psycopg://startup:startup@localhost:5432/startup')
engine=create_engine(DATABASE_URL, pool_pre_ping=True)
def db() -> Generator[Connection,None,None]:
    with engine.begin() as conn:
        yield conn
