-- ============================================================
-- supabase_setup.sql
-- Run this in Supabase → SQL Editor → New query → Run
-- ============================================================

-- Themes table (persists across server restarts)
create table if not exists themes (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text not null default 'general',
  words          text[] not null default '{}',
  imposters      text[] not null default '{}',
  word_count     int  not null default 0,
  imposter_count int  not null default 0,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- AI generation cache (avoid re-generating the same theme)
create table if not exists ai_cache (
  cache_key  text primary key,
  result     jsonb not null,
  created_at timestamptz default now()
);

-- Row Level Security: allow public reads on themes
alter table themes enable row level security;
create policy "Public read themes"  on themes for select using (true);
create policy "No client writes"    on themes for insert using (false);
create policy "No client updates"   on themes for update using (false);
create policy "No client deletes"   on themes for delete using (false);

-- ai_cache: server-only (service key bypasses RLS)
alter table ai_cache enable row level security;
-- No public policies — only server-side service key can access

-- Seed some example themes to get started
insert into themes (name, category, words, imposters, word_count, imposter_count)
values
(
  'Jujutsu Kaisen',
  'anime',
  array['gojo','sukuna','yuji','nobara','nanami','megumi','shoko','inumaki','panda','maki','hakari','yuta','choso','mahito','jogo','hanami','dagon','cursed-energy','black-flash','hollow-purple','cleave','dismantle','idle-transfiguration','tokyo-jujutsu-high','culling-game','prison-realm'],
  array['toji','riko','haibara','geto','mei-mei','noritoshi','naoya','higuruma','kusakabe','angel','hana','takaba','kashimo'],
  26,
  13
),
(
  'Pokemon',
  'game',
  array['pikachu','charizard','mewtwo','eevee','snorlax','gengar','dragonite','lapras','gyarados','alakazam','haunter','raichu','blastoise','venusaur','mew','articuno','zapdos','moltres','jolteon','vaporeon','flareon','pokedex','pokeball','master-ball','elite-four','pallet-town','viridian-city'],
  array['togepi','marill','slugma','shuckle','pineco','dunsparce','stantler','smeargle','delibird','mantine','skarmory','hoppip','sunkern'],
  27,
  13
);
