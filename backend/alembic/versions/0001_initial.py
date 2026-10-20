"""Initial schema; contract in db/001_initial.sql."""
from pathlib import Path
import sqlparse
from alembic import op
revision='0001_initial'
down_revision=None
branch_labels=None
depends_on=None

def upgrade():
    path = Path(__file__).with_name('0001_schema.sql')
    content = path.read_text(encoding='utf8')
    for statement in sqlparse.split(content):
        sql=sqlparse.format(statement, strip_comments=True).strip().rstrip(';').strip()
        if sql.upper() in ('BEGIN', 'COMMIT', ''):
            continue
        op.execute(sql)

def downgrade():
    tables = ['idempotency_keys','notifications','events','test_submissions',
      'test_assignment_versions','recruiter_grants','recruiter_invitations',
      'startup_members','offers','application_attempts','applications',
      'vacancy_versions','vacancies','startups','sessions','users']
    for table in tables:
        op.execute(f'DROP TABLE IF EXISTS {table}')
