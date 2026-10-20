CREATE OR REPLACE FUNCTION ensure_attempt_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; version_target UUID;
BEGIN
  SELECT vacancy_id INTO target FROM applications WHERE id=NEW.application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt references nonexistent application' USING ERRCODE='23503'; END IF;
  IF NEW.vacancy_version_id IS NULL THEN
    IF target IS NOT NULL THEN RAISE EXCEPTION 'vacancy attempt requires vacancy version' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT vacancy_id INTO version_target FROM vacancy_versions WHERE id=NEW.vacancy_version_id;
    IF version_target IS DISTINCT FROM target THEN
      RAISE EXCEPTION 'application attempt version belongs to a different vacancy' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_attempt_binding ON application_attempts;
CREATE TRIGGER tg_attempt_binding BEFORE INSERT OR UPDATE OF application_id,vacancy_version_id
  ON application_attempts FOR EACH ROW EXECUTE FUNCTION ensure_attempt_binding();

CREATE OR REPLACE FUNCTION ensure_offer_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor UUID; sid UUID; vid UUID; ver UUID;
BEGIN
  SELECT a.applicant_id,a.startup_id,a.vacancy_id,at.vacancy_version_id
    INTO actor,sid,vid,ver
    FROM application_attempts at JOIN applications a ON a.id=at.application_id
    WHERE at.id=NEW.attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'offer attempt does not exist' USING ERRCODE='23503'; END IF;
  IF NEW.candidate_id IS DISTINCT FROM actor
      OR NEW.startup_id IS DISTINCT FROM sid
      OR NEW.vacancy_id IS DISTINCT FROM vid
      OR NEW.vacancy_version_id IS DISTINCT FROM ver THEN
    RAISE EXCEPTION 'offer does not match application attempt' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_offer_binding ON offers;
CREATE TRIGGER tg_offer_binding BEFORE INSERT OR UPDATE OF attempt_id,startup_id,candidate_id,vacancy_id,vacancy_version_id
  ON offers FOR EACH ROW EXECUTE FUNCTION ensure_offer_binding();

CREATE OR REPLACE FUNCTION ensure_member_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid UUID; candidate UUID; state TEXT;
BEGIN
  SELECT startup_id,candidate_id,status INTO sid,candidate,state
  FROM offers WHERE id=NEW.joined_via_offer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'joining offer not found' USING ERRCODE='23503'; END IF;
  IF sid IS DISTINCT FROM NEW.startup_id OR candidate IS DISTINCT FROM NEW.user_id OR state <> 'accepted' THEN
    RAISE EXCEPTION 'membership requires accepted matching offer' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_member_binding ON startup_members;
CREATE TRIGGER tg_member_binding BEFORE INSERT OR UPDATE OF startup_id,user_id,joined_via_offer_id
  ON startup_members FOR EACH ROW EXECUTE FUNCTION ensure_member_binding();

CREATE OR REPLACE FUNCTION ensure_recruiter_grant_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sid UUID; invited UUID; state TEXT;
BEGIN
  SELECT startup_id,user_id,status INTO sid,invited,state
  FROM recruiter_invitations WHERE id=NEW.invitation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'recruiter invitation missing' USING ERRCODE='23503'; END IF;
  IF sid IS DISTINCT FROM NEW.startup_id OR invited IS DISTINCT FROM NEW.user_id OR state <> 'accepted' THEN
    RAISE EXCEPTION 'recruiter grant requires accepted matching invitation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_recruiter_binding ON recruiter_grants;
CREATE TRIGGER tg_recruiter_binding BEFORE INSERT OR UPDATE OF startup_id,user_id,invitation_id
  ON recruiter_grants FOR EACH ROW EXECUTE FUNCTION ensure_recruiter_grant_binding();

CREATE OR REPLACE FUNCTION ensure_test_submission_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attempt_vacancy UUID; task_vacancy UUID;
BEGIN
  SELECT a.vacancy_id INTO attempt_vacancy FROM application_attempts at
    JOIN applications a ON a.id=at.application_id WHERE at.id=NEW.attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'test submission attempt missing' USING ERRCODE='23503'; END IF;
  SELECT vacancy_id INTO task_vacancy FROM test_assignment_versions WHERE id=NEW.test_version_id;
  IF attempt_vacancy IS NULL OR task_vacancy IS DISTINCT FROM attempt_vacancy THEN
    RAISE EXCEPTION 'test version does not match vacancy application' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_test_submission_binding ON test_submissions;
CREATE TRIGGER tg_test_submission_binding BEFORE INSERT OR UPDATE OF attempt_id,test_version_id
  ON test_submissions FOR EACH ROW EXECUTE FUNCTION ensure_test_submission_binding();

-- The keys determining the ownership of a record cannot silently change afterwards.
CREATE OR REPLACE FUNCTION reject_binding_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity/ownership columns are immutable' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS tg_application_immutable ON applications;
CREATE TRIGGER tg_application_immutable BEFORE UPDATE OF applicant_id,startup_id,vacancy_id
  ON applications FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();
DROP TRIGGER IF EXISTS tg_attempt_immutable ON application_attempts;
CREATE TRIGGER tg_attempt_immutable BEFORE UPDATE OF application_id,vacancy_version_id
  ON application_attempts FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();
DROP TRIGGER IF EXISTS tg_offer_immutable ON offers;
CREATE TRIGGER tg_offer_immutable BEFORE UPDATE OF attempt_id,startup_id,candidate_id,vacancy_id,vacancy_version_id
  ON offers FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();
DROP TRIGGER IF EXISTS tg_member_immutable ON startup_members;
CREATE TRIGGER tg_member_immutable BEFORE UPDATE OF startup_id,user_id,joined_via_offer_id
  ON startup_members FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();
DROP TRIGGER IF EXISTS tg_recruiter_inv_immutable ON recruiter_invitations;
CREATE TRIGGER tg_recruiter_inv_immutable BEFORE UPDATE OF startup_id,user_id
  ON recruiter_invitations FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();
DROP TRIGGER IF EXISTS tg_recruiter_grant_immutable ON recruiter_grants;
CREATE TRIGGER tg_recruiter_grant_immutable BEFORE UPDATE OF startup_id,user_id,invitation_id
  ON recruiter_grants FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();
DROP TRIGGER IF EXISTS tg_test_assignment_immutable ON test_assignment_versions;
CREATE TRIGGER tg_test_assignment_immutable BEFORE UPDATE OF vacancy_id,version,description,submission_deadline,change_type
  ON test_assignment_versions FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();
DROP TRIGGER IF EXISTS tg_vacancy_version_immutable ON vacancy_versions;
CREATE TRIGGER tg_vacancy_version_immutable BEFORE UPDATE OF vacancy_id,version,title,description,requirements,change_mode
  ON vacancy_versions FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();
DROP TRIGGER IF EXISTS tg_test_submission_immutable ON test_submissions;
CREATE TRIGGER tg_test_submission_immutable BEFORE UPDATE OF attempt_id,test_version_id
  ON test_submissions FOR EACH ROW EXECUTE FUNCTION reject_binding_rewrite();

-- Once an invitation has been accepted its status cannot be undone, otherwise an
-- existing membership could refer to an unaccepted invitation.
CREATE OR REPLACE FUNCTION protect_accepted_offer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='accepted' AND NEW.status<>'accepted' THEN
    RAISE EXCEPTION 'accepted offer is terminal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_offer_accepted ON offers;
CREATE TRIGGER tg_offer_accepted BEFORE UPDATE OF status ON offers
  FOR EACH ROW EXECUTE FUNCTION protect_accepted_offer();
CREATE OR REPLACE FUNCTION protect_accepted_recruiter_invitation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='accepted' AND NEW.status<>'accepted' THEN
    RAISE EXCEPTION 'accepted recruiter invitation is terminal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_recruiter_inv_accepted ON recruiter_invitations;
CREATE TRIGGER tg_recruiter_inv_accepted BEFORE UPDATE OF status ON recruiter_invitations
  FOR EACH ROW EXECUTE FUNCTION protect_accepted_recruiter_invitation();


ALTER TABLE application_attempts ADD COLUMN IF NOT EXISTS rejection_reason TEXT NOT NULL DEFAULT '';
