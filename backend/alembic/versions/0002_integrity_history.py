"""Upgrade pre-trigger installations without replacing or deleting their data."""
from pathlib import Path
from alembic import op
from sqlalchemy import text
import sqlparse
revision='0002_integrity_history'
down_revision='0001_initial'
branch_labels=None
depends_on=None


def upgrade():
    conn=op.get_bind()
    # Refuse inconsistent legacy rows instead of deleting them or concealing them.
    checks={
        'application vacancy/startup':"SELECT 1 FROM applications a JOIN vacancies v ON v.id=a.vacancy_id WHERE v.startup_id<>a.startup_id",
        'attempt vacancy version':"SELECT 1 FROM application_attempts at JOIN applications a ON a.id=at.application_id LEFT JOIN vacancy_versions vv ON vv.id=at.vacancy_version_id WHERE a.vacancy_id IS DISTINCT FROM vv.vacancy_id",
        'offer identity':"SELECT 1 FROM offers o JOIN application_attempts at ON at.id=o.attempt_id JOIN applications a ON a.id=at.application_id WHERE o.startup_id IS DISTINCT FROM a.startup_id OR o.candidate_id IS DISTINCT FROM a.applicant_id OR o.vacancy_id IS DISTINCT FROM a.vacancy_id OR o.vacancy_version_id IS DISTINCT FROM at.vacancy_version_id",
        'membership identity':"SELECT 1 FROM startup_members sm JOIN offers o ON o.id=sm.joined_via_offer_id WHERE sm.startup_id<>o.startup_id OR sm.user_id<>o.candidate_id OR o.status<>'accepted'",
        'recruiter identity':"SELECT 1 FROM recruiter_grants g JOIN recruiter_invitations i ON i.id=g.invitation_id WHERE g.startup_id<>i.startup_id OR g.user_id<>i.user_id OR i.status<>'accepted'",
        'submission vacancy':"SELECT 1 FROM test_submissions t JOIN application_attempts at ON at.id=t.attempt_id JOIN applications a ON a.id=at.application_id JOIN test_assignment_versions tv ON tv.id=t.test_version_id WHERE a.vacancy_id IS NULL OR a.vacancy_id<>tv.vacancy_id",
        'capacity':"SELECT 1 FROM vacancies v WHERE v.positions_count < (SELECT count(*) FROM startup_members sm JOIN offers o ON o.id=sm.joined_via_offer_id WHERE o.vacancy_id=v.id AND sm.left_at IS NULL)+(SELECT count(*) FROM offers o WHERE o.vacancy_id=v.id AND o.status='pending' AND o.expires_at>clock_timestamp())",
    }
    # Locks prevent writers from changing validated rows until all triggers exist.
    conn.execute(text('LOCK TABLE applications,application_attempts,offers,startup_members,recruiter_grants,recruiter_invitations,test_submissions,vacancies,vacancy_versions,test_assignment_versions IN SHARE ROW EXCLUSIVE MODE'))
    for label,query in checks.items():
        if conn.execute(text(query+' LIMIT 1')).first():
            raise RuntimeError('Migration refused inconsistent legacy data: '+label+'; restore/repair a copy before upgrading')
    for statement in sqlparse.split(Path(__file__).with_name('0002_integrity.sql').read_text()):
        if statement.strip():op.execute(statement)


def downgrade():
    raise RuntimeError('Forward-only integrity migration: restore a verified backup to revert')
