"""Synthetic, isolated pg_dump/pg_restore acceptance probe.

The module is deliberately *not* an API endpoint. It cannot run against the
application's regular 'startup' database or a non-disposable database name.
It emits only aggregate counts/fingerprints, never real user data.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.database import DATABASE_URL


DISPOSABLE = re.compile(r"startup_test_[a-f0-9]{12}\Z")
REQUIRED_NONEMPTY = {
    "users", "sessions", "startups", "vacancies", "vacancy_versions",
    "applications", "application_attempts", "offers", "startup_members",
    "recruiter_invitations", "recruiter_grants", "test_assignment_versions",
    "test_submissions", "events", "notifications", "idempotency_keys",
    "telegram_auth_exchanges", "alembic_version",
}
REQUIRED_TRIGGERS = {
    "tg_attempt_binding", "tg_offer_binding", "tg_member_binding",
    "tg_recruiter_binding", "tg_test_submission_binding",
    "tg_application_immutable", "tg_offer_accepted",
}


def db_engine(name: str):
    if not DISPOSABLE.fullmatch(name):
        raise ValueError("REFUSED: only startup_test_<12 lowercase hex> is permitted")
    original = make_url(DATABASE_URL)
    if original.database != "startup":
        raise ValueError("REFUSED: probe requires sandbox base DB 'startup'")
    return create_engine(original.set(database=name), pool_pre_ping=True)


def inserted(conn, statement: str, **values):
    return conn.execute(text(statement + " RETURNING id"), values).scalar_one()


def seed(name: str) -> None:
    engine = db_engine(name)
    try:
        now = datetime.now(timezone.utc)
        future = now + timedelta(days=30)
        with engine.begin() as conn:
            owner = inserted(conn,
                "INSERT INTO users(email,password_hash,name,telegram_id) "
                "VALUES('backup-owner@example.test','fixture-not-a-real-hash','Backup Owner',101)",
            )
            member = inserted(conn,
                "INSERT INTO users(email,password_hash,name) "
                "VALUES('backup-member@example.test','fixture-not-a-real-hash','Backup Member')",
            )
            applicant = inserted(conn,
                "INSERT INTO users(email,password_hash,name) "
                "VALUES('backup-applicant@example.test','fixture-not-a-real-hash','Backup Applicant')",
            )
            recruiter = inserted(conn,
                "INSERT INTO users(email,password_hash,name) "
                "VALUES('backup-recruiter@example.test','fixture-not-a-real-hash','Backup Recruiter')",
            )
            project = inserted(conn,
                "INSERT INTO startups(owner_id,title,description) VALUES(:owner,'Backup fixture startup','Synthetic only')",
                owner=owner,
            )
            vacancy = inserted(conn,
                "INSERT INTO vacancies(startup_id,positions_count,application_deadline) "
                "VALUES(:project,2,:future)",
                project=project, future=future,
            )
            version = inserted(conn,
                "INSERT INTO vacancy_versions(vacancy_id,version,title,change_mode,created_by) "
                "VALUES(:vacancy,1,'Backend developer','initial',:owner)",
                vacancy=vacancy, owner=owner,
            )
            task = inserted(conn,
                "INSERT INTO test_assignment_versions(vacancy_id,version,description,submission_deadline,change_type,created_by) "
                "VALUES(:vacancy,1,'Implement safe endpoint',:future,'initial',:owner)",
                vacancy=vacancy, future=future, owner=owner,
            )
            accepted_application = inserted(conn,
                "INSERT INTO applications(applicant_id,startup_id,vacancy_id) "
                "VALUES(:member,:project,:vacancy)",
                member=member, project=project, vacancy=vacancy,
            )
            accepted_attempt = inserted(conn,
                "INSERT INTO application_attempts(application_id,vacancy_version_id,status,message) "
                "VALUES(:application,:version,'joined','Restored membership')",
                application=accepted_application, version=version,
            )
            accepted_offer = inserted(conn,
                "INSERT INTO offers(attempt_id,startup_id,candidate_id,vacancy_id,vacancy_version_id,status,expires_at,created_by) "
                "VALUES(:attempt,:project,:member,:vacancy,:version,'accepted',:future,:owner)",
                attempt=accepted_attempt, project=project, member=member,
                vacancy=vacancy, version=version, future=future, owner=owner,
            )
            inserted(conn,
                "INSERT INTO startup_members(startup_id,user_id,joined_via_offer_id) "
                "VALUES(:project,:member,:offer)",
                project=project, member=member, offer=accepted_offer,
            )
            pending_application = inserted(conn,
                "INSERT INTO applications(applicant_id,startup_id,vacancy_id) "
                "VALUES(:applicant,:project,:vacancy)",
                applicant=applicant, project=project, vacancy=vacancy,
            )
            pending_attempt = inserted(conn,
                "INSERT INTO application_attempts(application_id,vacancy_version_id,status,message) "
                "VALUES(:application,:version,'offer_pending','Application needs review')",
                application=pending_application, version=version,
            )
            inserted(conn,
                "INSERT INTO offers(attempt_id,startup_id,candidate_id,vacancy_id,vacancy_version_id,status,expires_at,created_by) "
                "VALUES(:attempt,:project,:applicant,:vacancy,:version,'pending',:future,:owner)",
                attempt=pending_attempt, project=project, applicant=applicant,
                vacancy=vacancy, version=version, future=future, owner=owner,
            )
            inserted(conn,
                "INSERT INTO test_submissions(attempt_id,test_version_id,solution_url) "
                "VALUES(:attempt,:task,'https://example.test/solution')",
                attempt=pending_attempt, task=task,
            )
            invitation = inserted(conn,
                "INSERT INTO recruiter_invitations(startup_id,user_id,sent_by,status,expires_at) "
                "VALUES(:project,:recruiter,:owner,'accepted',:future)",
                project=project, recruiter=recruiter, owner=owner, future=future,
            )
            inserted(conn,
                "INSERT INTO recruiter_grants(startup_id,user_id,invitation_id) "
                "VALUES(:project,:recruiter,:invitation)",
                project=project, recruiter=recruiter, invitation=invitation,
            )
            event = inserted(conn,
                "INSERT INTO events(startup_id,actor_id,entity_type,entity_id,event_type,metadata) "
                "VALUES(:project,:owner,'offer',:offer,'offer.accept',CAST(:metadata AS jsonb))",
                project=project, owner=owner, offer=accepted_offer,
                metadata=json.dumps({"synthetic": True, "attempts": [1, 2]}),
            )
            inserted(conn,
                "INSERT INTO notifications(recipient_id,event_id,title,message) "
                "VALUES(:member,:event,'Invitation','Synthetic restoration check')",
                member=member, event=event,
            )
            inserted(conn,
                "INSERT INTO idempotency_keys(actor_id,key,request_hash,http_status,response_body) "
                "VALUES(:owner,'backup-fixture-command','synthetic-hash',201,CAST(:body AS jsonb))",
                owner=owner, body=json.dumps({"ok": True, "nested": {"answer": 42}}),
            )
            digest = "fixture-" + uuid4().hex
            inserted(conn,
                "INSERT INTO sessions(user_id,token_digest,csrf_digest,expires_at) "
                "VALUES(:owner,:digest,'fixture-csrf-digest',:future)",
                owner=owner, digest=digest, future=future,
            )
            conn.execute(text(
                "INSERT INTO telegram_auth_exchanges(init_data_digest,user_id,session_digest,expires_at) "
                "VALUES(:init,:owner,:digest,:future)"
            ), {"init": "fixture-" + uuid4().hex, "owner": owner, "digest": digest, "future": future})
        print("Seeded exclusively synthetic users, project, offers, member, recruiter, tests and history.")
    finally:
        engine.dispose()


def canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=True, default=str, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def snapshot(name: str):
    engine = db_engine(name)
    try:
        with engine.connect() as conn:
            tables = conn.execute(text(
                "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
            )).scalars().all()
            missing = REQUIRED_NONEMPTY - set(tables)
            if missing:
                raise AssertionError(f"Missing required domain tables: {sorted(missing)}")
            data = {}
            for table in tables:
                # Table names come exclusively from the server catalog.
                identifier = '"' + table.replace('"', '""') + '"'
                rows = conn.execute(text(f'SELECT * FROM public.{identifier}')).mappings()
                hashes = sorted(hashlib.sha256(canonical(dict(row))).hexdigest() for row in rows)
                data[table] = (len(hashes), hashlib.sha256(canonical(hashes)).hexdigest())
                if table in REQUIRED_NONEMPTY and not hashes:
                    raise AssertionError(f"Empty fixture table: {table}")
            queries = {
                "columns": """SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default
                    FROM information_schema.columns WHERE table_schema='public' ORDER BY 1,2""",
                "indexes": """SELECT tablename,indexname,indexdef FROM pg_indexes
                    WHERE schemaname='public' ORDER BY 1,2""",
                "constraints": """SELECT c.conrelid::regclass::text AS table_name,c.conname,
                    c.contype,pg_get_constraintdef(c.oid) FROM pg_constraint c
                    JOIN pg_namespace n ON n.oid=c.connamespace
                    WHERE n.nspname='public' ORDER BY 1,2""",
                "triggers": """SELECT t.tgrelid::regclass::text AS table_name,t.tgname,
                    pg_get_triggerdef(t.oid) FROM pg_trigger t
                    JOIN pg_class c ON c.oid=t.tgrelid
                    JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1,2""",
                "functions": """SELECT p.proname, pg_get_functiondef(p.oid)
                    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' ORDER BY 1""",
            }
            schema = {}
            for category, sql in queries.items():
                values = [tuple(row) for row in conn.execute(text(sql))]
                schema[category] = (len(values), hashlib.sha256(canonical(values)).hexdigest())
                if not values:
                    raise AssertionError(f"Restorable schema category is empty: {category}")
                if category == "triggers":
                    names = {row[1] for row in values}
                    if not REQUIRED_TRIGGERS <= names:
                        raise AssertionError(f"Missing expected integrity triggers: {sorted(REQUIRED_TRIGGERS - names)}")
            revision = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            if revision != "0003_telegram_auth":
                raise AssertionError(f"Unexpected schema migration revision: {revision}")
            return data, schema
    finally:
        engine.dispose()


def verify(source_name: str, target_name: str) -> None:
    if source_name == target_name:
        raise ValueError("REFUSED: comparison databases must differ")
    original_data, original_schema = snapshot(source_name)
    restored_data, restored_schema = snapshot(target_name)
    if original_data != restored_data:
        for table in sorted(original_data.keys() | restored_data.keys()):
            if original_data.get(table) != restored_data.get(table):
                raise AssertionError(f"Post-restore data mismatch in table: {table}")
    if original_schema != restored_schema:
        for category in sorted(original_schema.keys() | restored_schema.keys()):
            if original_schema.get(category) != restored_schema.get(category):
                raise AssertionError(f"Post-restore schema mismatch in: {category}")
    print(f"RESTORE VERIFIED: {len(original_data)} full tables; "
          f"{sum(count for count, _ in original_data.values())} rows; "
          f"{len(original_schema)} schema categories including triggers and indexes.")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("Usage: backup_restore_probe.py seed <DB> | verify <SOURCE_DB> <RESTORED_DB>")
    if sys.argv[1] == "seed" and len(sys.argv) == 3:
        seed(sys.argv[2])
    elif sys.argv[1] == "verify" and len(sys.argv) == 4:
        verify(sys.argv[2], sys.argv[3])
    else:
        raise SystemExit("Invalid probe operation")
