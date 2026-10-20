--
-- PostgreSQL database dump
--

\restrict hMNfXlrjeSRW1S7IYF5h0cnsd8CXk5O1m1MYII0qEAardUlQsqq4lyAJZ2h6RXE

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: ensure_attempt_binding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_attempt_binding() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: ensure_member_binding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_member_binding() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: ensure_offer_binding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_offer_binding() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: ensure_recruiter_grant_binding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_recruiter_grant_binding() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: ensure_test_submission_binding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_test_submission_binding() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: protect_accepted_offer(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_accepted_offer() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status='accepted' AND NEW.status<>'accepted' THEN
    RAISE EXCEPTION 'accepted offer is terminal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: protect_accepted_recruiter_invitation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_accepted_recruiter_invitation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status='accepted' AND NEW.status<>'accepted' THEN
    RAISE EXCEPTION 'accepted recruiter invitation is terminal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;


--
-- Name: reject_binding_rewrite(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_binding_rewrite() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  RAISE EXCEPTION 'identity/ownership columns are immutable' USING ERRCODE='23514';
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alembic_version (
    version_num character varying(32) NOT NULL
);


--
-- Name: application_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    vacancy_version_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    is_current boolean DEFAULT true NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT application_attempts_revision_check CHECK ((revision > 0)),
    CONSTRAINT application_attempts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewing'::text, 'offer_pending'::text, 'rejected'::text, 'withdrawn'::text, 'reset'::text, 'joined'::text, 'declined'::text, 'already_joined'::text, 'closed'::text])))
);


--
-- Name: applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    applicant_id uuid NOT NULL,
    startup_id uuid NOT NULL,
    vacancy_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    startup_id uuid,
    actor_id uuid,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    event_type text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.idempotency_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    actor_id uuid NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    http_status integer NOT NULL,
    response_body jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    recipient_id uuid NOT NULL,
    event_id uuid,
    title text NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone
);


--
-- Name: offers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attempt_id uuid NOT NULL,
    startup_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    vacancy_id uuid,
    vacancy_version_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT ck_offer_vacancy_version CHECK ((((vacancy_id IS NULL) AND (vacancy_version_id IS NULL)) OR ((vacancy_id IS NOT NULL) AND (vacancy_version_id IS NOT NULL)))),
    CONSTRAINT offers_revision_check CHECK ((revision > 0)),
    CONSTRAINT offers_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'revoked'::text, 'expired'::text])))
);


--
-- Name: recruiter_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recruiter_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    startup_id uuid NOT NULL,
    user_id uuid NOT NULL,
    invitation_id uuid NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: recruiter_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.recruiter_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    startup_id uuid NOT NULL,
    user_id uuid NOT NULL,
    sent_by uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    decided_at timestamp with time zone,
    CONSTRAINT recruiter_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'revoked'::text, 'expired'::text])))
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_digest text NOT NULL,
    csrf_digest text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: startup_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.startup_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    startup_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_via_offer_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    left_at timestamp with time zone,
    left_reason text,
    CONSTRAINT startup_members_check CHECK (((left_at IS NULL) OR (left_at >= joined_at)))
);


--
-- Name: startups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.startups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    allow_general_applications boolean DEFAULT true NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT startups_revision_check CHECK ((revision > 0)),
    CONSTRAINT startups_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'archived'::text]))),
    CONSTRAINT startups_title_check CHECK (((length(TRIM(BOTH FROM title)) >= 1) AND (length(TRIM(BOTH FROM title)) <= 180)))
);


--
-- Name: test_assignment_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_assignment_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vacancy_id uuid NOT NULL,
    version integer NOT NULL,
    description text NOT NULL,
    submission_deadline timestamp with time zone NOT NULL,
    change_type text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT test_assignment_versions_change_type_check CHECK ((change_type = ANY (ARRAY['initial'::text, 'ordinary'::text, 'critical'::text]))),
    CONSTRAINT test_assignment_versions_version_check CHECK ((version > 0))
);


--
-- Name: test_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attempt_id uuid NOT NULL,
    test_version_id uuid NOT NULL,
    solution_url text NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    CONSTRAINT test_submissions_solution_url_check CHECK ((solution_url ~ '^https://'::text)),
    CONSTRAINT test_submissions_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'reviewed'::text, 'superseded'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    bio text DEFAULT ''::text NOT NULL,
    skills jsonb DEFAULT '[]'::jsonb NOT NULL,
    portfolio_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    CONSTRAINT users_name_check CHECK (((length(TRIM(BOTH FROM name)) >= 1) AND (length(TRIM(BOTH FROM name)) <= 120))),
    CONSTRAINT users_revision_check CHECK ((revision > 0)),
    CONSTRAINT users_skills_check CHECK ((jsonb_typeof(skills) = 'array'::text))
);


--
-- Name: vacancies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacancies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    startup_id uuid NOT NULL,
    status text DEFAULT 'published'::text NOT NULL,
    application_deadline timestamp with time zone NOT NULL,
    positions_count integer NOT NULL,
    current_version integer DEFAULT 1 NOT NULL,
    revision integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    archived_at timestamp with time zone,
    CONSTRAINT vacancies_current_version_check CHECK ((current_version > 0)),
    CONSTRAINT vacancies_positions_count_check CHECK ((positions_count > 0)),
    CONSTRAINT vacancies_revision_check CHECK ((revision > 0)),
    CONSTRAINT vacancies_status_check CHECK ((status = ANY (ARRAY['published'::text, 'intake_closed'::text, 'archived'::text])))
);


--
-- Name: vacancy_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacancy_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vacancy_id uuid NOT NULL,
    version integer NOT NULL,
    title text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    requirements text DEFAULT ''::text NOT NULL,
    change_mode text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vacancy_versions_change_mode_check CHECK ((change_mode = ANY (ARRAY['initial'::text, 'keep_applications'::text, 'reset_applications'::text]))),
    CONSTRAINT vacancy_versions_title_check CHECK (((length(TRIM(BOTH FROM title)) >= 1) AND (length(TRIM(BOTH FROM title)) <= 180))),
    CONSTRAINT vacancy_versions_version_check CHECK ((version > 0))
);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: application_attempts application_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_attempts
    ADD CONSTRAINT application_attempts_pkey PRIMARY KEY (id);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_actor_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_actor_id_key_key UNIQUE (actor_id, key);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: offers offers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_pkey PRIMARY KEY (id);


--
-- Name: recruiter_grants recruiter_grants_invitation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruiter_grants
    ADD CONSTRAINT recruiter_grants_invitation_id_key UNIQUE (invitation_id);


--
-- Name: recruiter_grants recruiter_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruiter_grants
    ADD CONSTRAINT recruiter_grants_pkey PRIMARY KEY (id);


--
-- Name: recruiter_invitations recruiter_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruiter_invitations
    ADD CONSTRAINT recruiter_invitations_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_digest_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_token_digest_key UNIQUE (token_digest);


--
-- Name: startup_members startup_members_joined_via_offer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.startup_members
    ADD CONSTRAINT startup_members_joined_via_offer_id_key UNIQUE (joined_via_offer_id);


--
-- Name: startup_members startup_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.startup_members
    ADD CONSTRAINT startup_members_pkey PRIMARY KEY (id);


--
-- Name: startups startups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.startups
    ADD CONSTRAINT startups_pkey PRIMARY KEY (id);


--
-- Name: test_assignment_versions test_assignment_versions_id_vacancy_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_assignment_versions
    ADD CONSTRAINT test_assignment_versions_id_vacancy_id_key UNIQUE (id, vacancy_id);


--
-- Name: test_assignment_versions test_assignment_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_assignment_versions
    ADD CONSTRAINT test_assignment_versions_pkey PRIMARY KEY (id);


--
-- Name: test_assignment_versions test_assignment_versions_vacancy_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_assignment_versions
    ADD CONSTRAINT test_assignment_versions_vacancy_id_version_key UNIQUE (vacancy_id, version);


--
-- Name: test_submissions test_submissions_attempt_id_test_version_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_submissions
    ADD CONSTRAINT test_submissions_attempt_id_test_version_id_key UNIQUE (attempt_id, test_version_id);


--
-- Name: test_submissions test_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_submissions
    ADD CONSTRAINT test_submissions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: vacancies vacancies_id_startup_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancies
    ADD CONSTRAINT vacancies_id_startup_id_key UNIQUE (id, startup_id);


--
-- Name: vacancies vacancies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancies
    ADD CONSTRAINT vacancies_pkey PRIMARY KEY (id);


--
-- Name: vacancy_versions vacancy_versions_id_vacancy_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_versions
    ADD CONSTRAINT vacancy_versions_id_vacancy_id_key UNIQUE (id, vacancy_id);


--
-- Name: vacancy_versions vacancy_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_versions
    ADD CONSTRAINT vacancy_versions_pkey PRIMARY KEY (id);


--
-- Name: vacancy_versions vacancy_versions_vacancy_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_versions
    ADD CONSTRAINT vacancy_versions_vacancy_id_version_key UNIQUE (vacancy_id, version);


--
-- Name: ix_applications_startup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_applications_startup ON public.applications USING btree (startup_id);


--
-- Name: ix_attempts_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_attempts_application ON public.application_attempts USING btree (application_id, created_at DESC);


--
-- Name: ix_events_startup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_events_startup ON public.events USING btree (startup_id, created_at DESC);


--
-- Name: ix_notifications_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_notifications_recipient ON public.notifications USING btree (recipient_id, created_at DESC);


--
-- Name: ix_offers_capacity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_offers_capacity ON public.offers USING btree (vacancy_id, status, expires_at);


--
-- Name: ix_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_sessions_user ON public.sessions USING btree (user_id);


--
-- Name: ix_startups_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_startups_active ON public.startups USING btree (created_at DESC) WHERE (status = 'active'::text);


--
-- Name: ix_vacancies_startup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_vacancies_startup ON public.vacancies USING btree (startup_id, created_at DESC);


--
-- Name: uq_active_member; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_active_member ON public.startup_members USING btree (startup_id, user_id) WHERE (left_at IS NULL);


--
-- Name: uq_active_recruiter; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_active_recruiter ON public.recruiter_grants USING btree (startup_id, user_id) WHERE (revoked_at IS NULL);


--
-- Name: uq_current_attempt; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_current_attempt ON public.application_attempts USING btree (application_id) WHERE is_current;


--
-- Name: uq_general_application; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_general_application ON public.applications USING btree (startup_id, applicant_id) WHERE (vacancy_id IS NULL);


--
-- Name: uq_pending_offer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pending_offer ON public.offers USING btree (startup_id, candidate_id) WHERE (status = 'pending'::text);


--
-- Name: uq_pending_recruiter_inv; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_pending_recruiter_inv ON public.recruiter_invitations USING btree (startup_id, user_id) WHERE (status = 'pending'::text);


--
-- Name: uq_vacancy_application; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_vacancy_application ON public.applications USING btree (vacancy_id, applicant_id) WHERE (vacancy_id IS NOT NULL);


--
-- Name: applications tg_application_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_application_immutable BEFORE UPDATE OF applicant_id, startup_id, vacancy_id ON public.applications FOR EACH ROW EXECUTE FUNCTION public.reject_binding_rewrite();


--
-- Name: application_attempts tg_attempt_binding; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_attempt_binding BEFORE INSERT OR UPDATE OF application_id, vacancy_version_id ON public.application_attempts FOR EACH ROW EXECUTE FUNCTION public.ensure_attempt_binding();


--
-- Name: application_attempts tg_attempt_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_attempt_immutable BEFORE UPDATE OF application_id, vacancy_version_id ON public.application_attempts FOR EACH ROW EXECUTE FUNCTION public.reject_binding_rewrite();


--
-- Name: startup_members tg_member_binding; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_member_binding BEFORE INSERT OR UPDATE OF startup_id, user_id, joined_via_offer_id ON public.startup_members FOR EACH ROW EXECUTE FUNCTION public.ensure_member_binding();


--
-- Name: startup_members tg_member_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_member_immutable BEFORE UPDATE OF startup_id, user_id, joined_via_offer_id ON public.startup_members FOR EACH ROW EXECUTE FUNCTION public.reject_binding_rewrite();


--
-- Name: offers tg_offer_accepted; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_offer_accepted BEFORE UPDATE OF status ON public.offers FOR EACH ROW EXECUTE FUNCTION public.protect_accepted_offer();


--
-- Name: offers tg_offer_binding; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_offer_binding BEFORE INSERT OR UPDATE OF attempt_id, startup_id, candidate_id, vacancy_id, vacancy_version_id ON public.offers FOR EACH ROW EXECUTE FUNCTION public.ensure_offer_binding();


--
-- Name: offers tg_offer_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_offer_immutable BEFORE UPDATE OF attempt_id, startup_id, candidate_id, vacancy_id, vacancy_version_id ON public.offers FOR EACH ROW EXECUTE FUNCTION public.reject_binding_rewrite();


--
-- Name: recruiter_grants tg_recruiter_binding; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_recruiter_binding BEFORE INSERT OR UPDATE OF startup_id, user_id, invitation_id ON public.recruiter_grants FOR EACH ROW EXECUTE FUNCTION public.ensure_recruiter_grant_binding();


--
-- Name: recruiter_grants tg_recruiter_grant_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_recruiter_grant_immutable BEFORE UPDATE OF startup_id, user_id, invitation_id ON public.recruiter_grants FOR EACH ROW EXECUTE FUNCTION public.reject_binding_rewrite();


--
-- Name: recruiter_invitations tg_recruiter_inv_accepted; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_recruiter_inv_accepted BEFORE UPDATE OF status ON public.recruiter_invitations FOR EACH ROW EXECUTE FUNCTION public.protect_accepted_recruiter_invitation();


--
-- Name: recruiter_invitations tg_recruiter_inv_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_recruiter_inv_immutable BEFORE UPDATE OF startup_id, user_id ON public.recruiter_invitations FOR EACH ROW EXECUTE FUNCTION public.reject_binding_rewrite();


--
-- Name: test_assignment_versions tg_test_assignment_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_test_assignment_immutable BEFORE UPDATE OF vacancy_id, version, description, submission_deadline, change_type ON public.test_assignment_versions FOR EACH ROW EXECUTE FUNCTION public.reject_binding_rewrite();


--
-- Name: test_submissions tg_test_submission_binding; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_test_submission_binding BEFORE INSERT OR UPDATE OF attempt_id, test_version_id ON public.test_submissions FOR EACH ROW EXECUTE FUNCTION public.ensure_test_submission_binding();


--
-- Name: test_submissions tg_test_submission_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_test_submission_immutable BEFORE UPDATE OF attempt_id, test_version_id ON public.test_submissions FOR EACH ROW EXECUTE FUNCTION public.reject_binding_rewrite();


--
-- Name: vacancy_versions tg_vacancy_version_immutable; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER tg_vacancy_version_immutable BEFORE UPDATE OF vacancy_id, version, title, description, requirements, change_mode ON public.vacancy_versions FOR EACH ROW EXECUTE FUNCTION public.reject_binding_rewrite();


--
-- Name: application_attempts application_attempts_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_attempts
    ADD CONSTRAINT application_attempts_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id);


--
-- Name: application_attempts application_attempts_vacancy_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_attempts
    ADD CONSTRAINT application_attempts_vacancy_version_id_fkey FOREIGN KEY (vacancy_version_id) REFERENCES public.vacancy_versions(id);


--
-- Name: applications applications_applicant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_applicant_id_fkey FOREIGN KEY (applicant_id) REFERENCES public.users(id);


--
-- Name: applications applications_startup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_startup_id_fkey FOREIGN KEY (startup_id) REFERENCES public.startups(id);


--
-- Name: events events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: events events_startup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_startup_id_fkey FOREIGN KEY (startup_id) REFERENCES public.startups(id);


--
-- Name: applications fk_application_vacancy_startup; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT fk_application_vacancy_startup FOREIGN KEY (vacancy_id, startup_id) REFERENCES public.vacancies(id, startup_id);


--
-- Name: offers fk_offer_vacancy_startup; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT fk_offer_vacancy_startup FOREIGN KEY (vacancy_id, startup_id) REFERENCES public.vacancies(id, startup_id);


--
-- Name: offers fk_offer_version_vacancy; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT fk_offer_version_vacancy FOREIGN KEY (vacancy_version_id, vacancy_id) REFERENCES public.vacancy_versions(id, vacancy_id);


--
-- Name: idempotency_keys idempotency_keys_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id);


--
-- Name: notifications notifications_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.events(id);


--
-- Name: notifications notifications_recipient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id);


--
-- Name: offers offers_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.application_attempts(id);


--
-- Name: offers offers_candidate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_candidate_id_fkey FOREIGN KEY (candidate_id) REFERENCES public.users(id);


--
-- Name: offers offers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: offers offers_startup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_startup_id_fkey FOREIGN KEY (startup_id) REFERENCES public.startups(id);


--
-- Name: recruiter_grants recruiter_grants_invitation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruiter_grants
    ADD CONSTRAINT recruiter_grants_invitation_id_fkey FOREIGN KEY (invitation_id) REFERENCES public.recruiter_invitations(id);


--
-- Name: recruiter_grants recruiter_grants_startup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruiter_grants
    ADD CONSTRAINT recruiter_grants_startup_id_fkey FOREIGN KEY (startup_id) REFERENCES public.startups(id);


--
-- Name: recruiter_grants recruiter_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruiter_grants
    ADD CONSTRAINT recruiter_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: recruiter_invitations recruiter_invitations_sent_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruiter_invitations
    ADD CONSTRAINT recruiter_invitations_sent_by_fkey FOREIGN KEY (sent_by) REFERENCES public.users(id);


--
-- Name: recruiter_invitations recruiter_invitations_startup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruiter_invitations
    ADD CONSTRAINT recruiter_invitations_startup_id_fkey FOREIGN KEY (startup_id) REFERENCES public.startups(id);


--
-- Name: recruiter_invitations recruiter_invitations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.recruiter_invitations
    ADD CONSTRAINT recruiter_invitations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: startup_members startup_members_joined_via_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.startup_members
    ADD CONSTRAINT startup_members_joined_via_offer_id_fkey FOREIGN KEY (joined_via_offer_id) REFERENCES public.offers(id);


--
-- Name: startup_members startup_members_startup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.startup_members
    ADD CONSTRAINT startup_members_startup_id_fkey FOREIGN KEY (startup_id) REFERENCES public.startups(id);


--
-- Name: startup_members startup_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.startup_members
    ADD CONSTRAINT startup_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: startups startups_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.startups
    ADD CONSTRAINT startups_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id);


--
-- Name: test_assignment_versions test_assignment_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_assignment_versions
    ADD CONSTRAINT test_assignment_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: test_assignment_versions test_assignment_versions_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_assignment_versions
    ADD CONSTRAINT test_assignment_versions_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id);


--
-- Name: test_submissions test_submissions_attempt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_submissions
    ADD CONSTRAINT test_submissions_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.application_attempts(id);


--
-- Name: test_submissions test_submissions_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_submissions
    ADD CONSTRAINT test_submissions_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: test_submissions test_submissions_test_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_submissions
    ADD CONSTRAINT test_submissions_test_version_id_fkey FOREIGN KEY (test_version_id) REFERENCES public.test_assignment_versions(id);


--
-- Name: vacancies vacancies_startup_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancies
    ADD CONSTRAINT vacancies_startup_id_fkey FOREIGN KEY (startup_id) REFERENCES public.startups(id);


--
-- Name: vacancy_versions vacancy_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_versions
    ADD CONSTRAINT vacancy_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: vacancy_versions vacancy_versions_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_versions
    ADD CONSTRAINT vacancy_versions_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancies(id);


--
-- PostgreSQL database dump complete
--

\unrestrict hMNfXlrjeSRW1S7IYF5h0cnsd8CXk5O1m1MYII0qEAardUlQsqq4lyAJZ2h6RXE

