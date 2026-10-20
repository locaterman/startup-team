from alembic import context
from sqlalchemy import create_engine, pool
import os
config = context.config
url = os.environ.get('DATABASE_URL', config.get_main_option('sqlalchemy.url'))
def run_migrations_online():
    connectable = create_engine(url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()
run_migrations_online()
