-- Call Coach, phone uploads: a VA with no signal at her desk calls from her
-- phone and uploads the recordings. Each upload is one call_coach_segments
-- row like a PC-mic minute, so the same transcription, review and digest
-- run over it; `source` tells the two apart.
--
-- Run with:  npm run db:run -- supabase/call-coach-phone-upload-migration.sql

alter table call_coach_segments add column if not exists source text not null default 'pc_mic';
alter table call_coach_segments drop constraint if exists call_coach_segments_source_check;
alter table call_coach_segments add constraint call_coach_segments_source_check
  check (source in ('pc_mic', 'phone_upload'));

-- The order number or customer phone the VA typed for an upload. The PC
-- recorder has no such reference, so it stays null there.
alter table call_coach_segments add column if not exists reference text;
-- The phone's own file name, so a failed upload can be matched to the file.
alter table call_coach_segments add column if not exists original_name text;

create index if not exists call_coach_segments_source_idx
  on call_coach_segments (employee_id, date, source);

-- Each call the review finds inherits the source of the recording it sits in,
-- so My Calls and the digest can show a phone indicator.
alter table call_coach_calls add column if not exists source text not null default 'pc_mic';
alter table call_coach_calls drop constraint if exists call_coach_calls_source_check;
alter table call_coach_calls add constraint call_coach_calls_source_check
  check (source in ('pc_mic', 'phone_upload'));

-- Phone recorders write m4a, mp3, aac, amr, ogg and wav. One call is a few
-- MB; a long one at a high bitrate can reach tens of MB, so the cap is 100 MB.
update storage.buckets
set file_size_limit = 104857600,
    allowed_mime_types = array[
      'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/mp3',
      'audio/aac', 'audio/x-aac', 'audio/aacp', 'audio/x-m4a', 'audio/m4a',
      'audio/amr', 'audio/amr-wb', 'audio/3gpp', 'audio/3gpp2',
      'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave',
      'audio/flac', 'audio/x-flac', 'video/3gpp', 'video/mp4'
    ]
where id = 'call-coach';

notify pgrst, 'reload schema';
