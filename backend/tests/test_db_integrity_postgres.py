"""Adversarial DB tests. Requires migrated, disposable startup_test PostgreSQL database.
Set TEST_DATABASE_URL; skipped otherwise. Not evidence of successful runtime until executed.
"""
import os
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError, DBAPIError
from db_safety import require_disposable_test_database

pytestmark = pytest.mark.skipif(
    not os.environ.get('TEST_DATABASE_URL'),
    reason='Requires migrated, disposable PostgreSQL TEST_DATABASE_URL',
)

@pytest.fixture
def conn():
    url = os.environ['TEST_DATABASE_URL']
    try:
        require_disposable_test_database(url)
    except ValueError as exc:
        pytest.fail(str(exc), pytrace=False)
    engine = create_engine(url, pool_pre_ping=True)
    with engine.begin() as c:
        c.execute(text('''TRUNCATE idempotency_keys,notifications,events,test_submissions,
          test_assignment_versions,recruiter_grants,recruiter_invitations,
          startup_members,offers,application_attempts,applications,
          vacancy_versions,vacancies,startups,sessions,users CASCADE'''))
        yield c
    engine.dispose()


def insert(c, sql, **kwargs):
    return c.execute(text(sql), kwargs).scalar_one()


def must_fail(c, sql, **kwargs):
    with pytest.raises((IntegrityError, DBAPIError)):
        with c.begin_nested():
            c.execute(text(sql), kwargs)


def test_cross_startup_and_person_links_cannot_be_corrupted(conn):
    c=conn
    alice=insert(c,"INSERT INTO users(email,password_hash,name) VALUES('a@demo.test','h','A') RETURNING id")
    bob=insert(c,"INSERT INTO users(email,password_hash,name) VALUES('b@demo.test','h','B') RETURNING id")
    carol=insert(c,"INSERT INTO users(email,password_hash,name) VALUES('c@demo.test','h','C') RETURNING id")
    one=insert(c,"INSERT INTO startups(owner_id,title) VALUES(:o,'One') RETURNING id",o=alice)
    two=insert(c,"INSERT INTO startups(owner_id,title) VALUES(:o,'Two') RETURNING id",o=alice)
    v1=insert(c,"INSERT INTO vacancies(startup_id,positions_count,application_deadline) VALUES(:s,2,now()+interval '10 days') RETURNING id",s=one)
    v2=insert(c,"INSERT INTO vacancies(startup_id,positions_count,application_deadline) VALUES(:s,2,now()+interval '10 days') RETURNING id",s=two)
    vv1=insert(c,"INSERT INTO vacancy_versions(vacancy_id,version,title,change_mode,created_by) VALUES(:v,1,'One Dev','initial',:owner) RETURNING id",v=v1,owner=alice)
    vv2=insert(c,"INSERT INTO vacancy_versions(vacancy_id,version,title,change_mode,created_by) VALUES(:v,1,'Two Dev','initial',:owner) RETURNING id",v=v2,owner=alice)
    app=insert(c,"INSERT INTO applications(applicant_id,startup_id,vacancy_id) VALUES(:u,:s,:v) RETURNING id",u=bob,s=one,v=v1)
    must_fail(c,'INSERT INTO application_attempts(application_id,vacancy_version_id) VALUES(:a,:wrong)',a=app,wrong=vv2)
    attempt=insert(c,'INSERT INTO application_attempts(application_id,vacancy_version_id) VALUES(:a,:ver) RETURNING id',a=app,ver=vv1)
    must_fail(c,"INSERT INTO offers(attempt_id,startup_id,candidate_id,vacancy_id,vacancy_version_id,expires_at,created_by) VALUES(:a,:s,:candidate,:v,:ver,now()+interval '7 days',:owner)",a=attempt,s=one,candidate=carol,v=v1,ver=vv1,owner=alice)
    must_fail(c,"INSERT INTO offers(attempt_id,startup_id,candidate_id,vacancy_id,vacancy_version_id,expires_at,created_by) VALUES(:a,:s,:candidate,:v,:ver,now()+interval '7 days',:owner)",a=attempt,s=two,candidate=bob,v=v2,ver=vv2,owner=alice)
    offer=insert(c,"INSERT INTO offers(attempt_id,startup_id,candidate_id,vacancy_id,vacancy_version_id,expires_at,created_by) VALUES(:a,:s,:candidate,:v,:ver,now()+interval '7 days',:owner) RETURNING id",a=attempt,s=one,candidate=bob,v=v1,ver=vv1,owner=alice)
    must_fail(c,'INSERT INTO startup_members(startup_id,user_id,joined_via_offer_id) VALUES(:s,:u,:o)',s=one,u=bob,o=offer) # pending offer
    c.execute(text("UPDATE offers SET status='accepted' WHERE id=:o"),{'o':offer})
    must_fail(c,'INSERT INTO startup_members(startup_id,user_id,joined_via_offer_id) VALUES(:s,:u,:o)',s=one,u=carol,o=offer)
    must_fail(c,'INSERT INTO startup_members(startup_id,user_id,joined_via_offer_id) VALUES(:s,:u,:o)',s=two,u=bob,o=offer)
    c.execute(text('INSERT INTO startup_members(startup_id,user_id,joined_via_offer_id) VALUES(:s,:u,:o)'),{'s':one,'u':bob,'o':offer})
    must_fail(c,"UPDATE offers SET status='revoked' WHERE id=:o",o=offer)
    invitation=insert(c,"INSERT INTO recruiter_invitations(startup_id,user_id,sent_by,expires_at) VALUES(:s,:u,:by,now()+interval '7 days') RETURNING id",s=one,u=carol,by=alice)
    must_fail(c,'INSERT INTO recruiter_grants(startup_id,user_id,invitation_id) VALUES(:s,:u,:inv)',s=one,u=carol,inv=invitation) # pending
    c.execute(text("UPDATE recruiter_invitations SET status='accepted' WHERE id=:i"),{'i':invitation})
    must_fail(c,'INSERT INTO recruiter_grants(startup_id,user_id,invitation_id) VALUES(:s,:u,:inv)',s=one,u=bob,inv=invitation)
    must_fail(c,'INSERT INTO recruiter_grants(startup_id,user_id,invitation_id) VALUES(:s,:u,:inv)',s=two,u=carol,inv=invitation)
    c.execute(text('INSERT INTO recruiter_grants(startup_id,user_id,invitation_id) VALUES(:s,:u,:inv)'),{'s':one,'u':carol,'inv':invitation})
    task1=insert(c,"INSERT INTO test_assignment_versions(vacancy_id,version,description,submission_deadline,change_type,created_by) VALUES(:v,1,'Task One',now()+interval '10 days','initial',:owner) RETURNING id",v=v1,owner=alice)
    task2=insert(c,"INSERT INTO test_assignment_versions(vacancy_id,version,description,submission_deadline,change_type,created_by) VALUES(:v,1,'Task Two',now()+interval '10 days','initial',:owner) RETURNING id",v=v2,owner=alice)
    must_fail(c,"INSERT INTO test_submissions(attempt_id,test_version_id,solution_url) VALUES(:a,:v,'https://example.org/answer')",a=attempt,v=task2)
    c.execute(text("INSERT INTO test_submissions(attempt_id,test_version_id,solution_url) VALUES(:a,:v,'https://example.org/answer')"),{'a':attempt,'v':task1})
    must_fail(c,'UPDATE applications SET vacancy_id=:wrong WHERE id=:a',wrong=v2,a=app)
