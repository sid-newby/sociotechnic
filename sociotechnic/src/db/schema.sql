create table if not exists jobs (
  id          text primary key,
  project     text not null,
  repo        text not null,
  feature     text not null,
  status      text not null,
  round       int  not null default 0,
  tier        text,
  branch      text not null,
  base_commit text not null,
  created_at  timestamptz not null,
  updated_at  timestamptz not null,
  synced_at   timestamptz not null default now(),
  job         jsonb not null
);
create index if not exists jobs_project_idx on jobs (project);
create index if not exists jobs_status_idx  on jobs (status);

alter table jobs add column if not exists revision bigint not null default 1;
alter table jobs add column if not exists driver jsonb;

create table if not exists records (
  job_id text not null references jobs(id) on delete cascade,
  path text not null,
  bytes int not null,
  mtime timestamptz not null,
  content bytea not null,
  digest text not null,
  revision bigint not null default 1,
  synced_at timestamptz not null default now(),
  primary key(job_id,path)
);
alter table records add column if not exists content bytea;
alter table records add column if not exists digest text;
alter table records add column if not exists revision bigint not null default 1;
do $$ begin
  if exists(select 1 from information_schema.columns where table_name='records' and column_name='text' and table_schema=current_schema()) then
    execute 'update records set content=convert_to(text,''UTF8'') where content is null';
    alter table records drop column text;
  end if;
end $$;
update records set digest=encode(sha256(content),'hex') where digest is null;
alter table records alter column content set not null;
alter table records alter column digest set not null;

create table if not exists state_migrations (
  name text primary key,
  manifest jsonb not null,
  applied_at timestamptz not null default now()
);

create table if not exists events (
  id     bigserial primary key,
  job_id text not null references jobs (id) on delete cascade,
  at     timestamptz not null,
  kind   text not null,
  data   jsonb not null default '{}'
);
create index if not exists events_job_idx on events (job_id, at);

-- Immutable catalog authority; the local release directory is only a cache.
create table if not exists agent_versions (
  agent text not null,
  version text not null check (version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
  content_digest text not null check (content_digest ~ '^[a-f0-9]{64}$'),
  release jsonb not null,
  primary key (agent, version),
  check (release->>'version' = version),
  check (release->'role'->>'name' = agent)
);
create or replace function protect_agent_version() returns trigger language plpgsql as $$
begin
  raise exception 'agent releases are immutable' using errcode = '23514';
end;
$$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'agent_versions_immutable' and tgrelid = 'agent_versions'::regclass) then
    create trigger agent_versions_immutable before update or delete on agent_versions
      for each row execute function protect_agent_version();
  end if;
end $$;
create table if not exists job_agent_versions (
  job_id text not null references jobs (id) on delete cascade,
  slot text not null,
  agent text not null,
  version text not null,
  primary key (job_id, slot),
  foreign key (agent, version) references agent_versions (agent, version)
);

-- Old file-mirror binaries cannot update canonical state after cutover.
create or replace function enforce_job_writer() returns trigger language plpgsql as $$
begin
  if exists(select 1 from state_migrations where name='job-authority-v1')
     and current_setting('sociotechnic.writer',true) is distinct from 'jobs-v1' then
    raise exception 'This writer predates database job authority; upgrade Sociotechnic' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists jobs_writer_epoch on jobs;
create trigger jobs_writer_epoch before insert or update or delete on jobs for each row execute function enforce_job_writer();
drop trigger if exists records_writer_epoch on records;
create trigger records_writer_epoch before insert or update or delete on records for each row execute function enforce_job_writer();
