"""Add Telegram identities without replacing existing accounts or project data."""
from alembic import op

revision = '0003_telegram_auth'
down_revision = '0002_integrity_history'
branch_labels = None
depends_on = None


def upgrade():
    op.execute('ALTER TABLE users ADD COLUMN telegram_id BIGINT UNIQUE CHECK (telegram_id > 0)')
    op.execute('ALTER TABLE users ADD COLUMN onboarding_completed_at TIMESTAMPTZ DEFAULT now()')
    op.execute('ALTER TABLE users ALTER COLUMN email DROP NOT NULL')
    op.execute('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL')
    op.execute('ALTER TABLE users ADD CONSTRAINT users_password_pair CHECK ((email IS NULL) = (password_hash IS NULL))')
    op.execute('ALTER TABLE users ADD CONSTRAINT users_identity_present CHECK (telegram_id IS NOT NULL OR email IS NOT NULL)')
    op.execute('''CREATE TABLE telegram_auth_exchanges (
        init_data_digest TEXT PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_digest TEXT NOT NULL REFERENCES sessions(token_digest) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )''')
    op.execute('CREATE INDEX ix_telegram_auth_exchanges_expiry ON telegram_auth_exchanges(expires_at)')


def downgrade():
    raise RuntimeError('Forward-only identity migration: restore a verified backup to revert')
