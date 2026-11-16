-- A recruiter deleting their account must not erase the candidate's interviews.
ALTER TABLE job_interviews ALTER COLUMN proposed_by DROP NOT NULL;
ALTER TABLE job_interviews DROP CONSTRAINT job_interviews_proposed_by_fkey;
ALTER TABLE job_interviews ADD CONSTRAINT job_interviews_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES users(id) ON DELETE SET NULL;
