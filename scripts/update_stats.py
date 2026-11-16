"""Generate public NBA game logs for the rankings site. Requires duckdb and network.

Uses https://github.com/llimllib/nba_data (unaffiliated community dataset).
"""
import csv
import datetime as dt
import json
import os
from pathlib import Path
import duckdb

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data'
OUT.mkdir(exist_ok=True)
SEASON = int(os.getenv('NBA_SEASON', '2027'))
DB = 'https://basketball-data.billmill.org/nba/nba.duckdb'

con = duckdb.connect()
con.execute(f"ATTACH '{DB}' AS nba (READ_ONLY)")
# Inspect available columns so upstream changes fail with an actionable error.
required = {'player_id', 'game_id', 'pts', 'reb', 'ast', 'stl', 'blk', 'tov'}
columns = {r[1] for r in con.execute('PRAGMA table_info(\'nba.player_game_logs\')').fetchall()}
missing = required - columns
if missing:
    raise RuntimeError(f'NBA player_game_logs missing expected columns: {sorted(missing)}')

# Only played regular-season NBA games; game_date is the NBA's US Eastern date.
query = '''
SELECT CAST(g.game_date AS VARCHAR) AS date, l.player_id,
       COALESCE(ps.name, p.name) AS player,
       COALESCE(t.nba_abbrev, '') AS team,
       l.pts, l.reb, l.ast, l.stl, l.blk, l.tov
FROM nba.player_game_logs l
JOIN nba.games g ON g.season=l.season AND g.game_id=l.game_id
JOIN nba.players p ON p.player_id=l.player_id
LEFT JOIN nba.player_seasons ps ON ps.season=l.season AND ps.player_id=l.player_id
LEFT JOIN nba.team_seasons t ON t.season=l.season AND t.team_id=l.team_id
WHERE l.season=? AND g.game_type='regular_season'
ORDER BY g.game_date, l.player_id
'''
result = con.execute(query, [SEASON])
records = [dict(zip([c[0] for c in result.description], row)) for row in result.fetchall()]
if len(records) < 100:
    raise RuntimeError(f'Only {len(records)} rows returned; refusing to replace published data')

# Match Yahoo player names to NBA game-log names.
import unicodedata

def clean_name(name):
    name = unicodedata.normalize("NFKD", str(name or ""))
    name = "".join(
        c for c in name if not unicodedata.combining(c)
    )
    return "".join(c for c in name.lower() if c.isalnum())

positions = {}
pos_file = ROOT / 'yahoo-positions.csv'

if not pos_file.exists():
    raise FileNotFoundError(f'Missing Yahoo positions file: {pos_file}')

with pos_file.open(newline='', encoding='utf-8-sig') as f:
    for entry in csv.DictReader(f):
        name = clean_name(entry.get('player', ''))
        if name:
            positions[name] = entry.get('positions', '')

print(f'Loaded Yahoo positions for {len(positions)} players')

for row in records:
    row['positions'] = positions.get(clean_name(row['player']), '')
    # ISO Monday-Sunday is PROVISIONAL until league-specific week boundaries are supplied.
    row['week'] = dt.date.fromisoformat(row['date']).strftime('%G-W%V')
    row['dd'] = int(sum(float(row[k] or 0) >= 10 for k in ('pts','reb','ast','stl','blk')) >= 2)
    for k in ('pts','reb','ast','stl','blk','tov'):
        row[k] = float(row[k] or 0)

fields = ['date','player_id','player','team','positions','pts','reb','ast','stl','blk','tov','week','dd']
with (OUT/'game_logs.csv').open('w',newline='',encoding='utf-8') as f:
    writer=csv.DictWriter(f,fieldnames=fields)
    writer.writeheader()
    writer.writerows(records)
(OUT/'status.json').write_text(json.dumps({
    'season':f'{SEASON-1}–{str(SEASON)[-2:]}',
    'updated_utc':dt.datetime.now(dt.timezone.utc).isoformat(),
    'games_logged':len(records),
    'latest_game_date':max(r['date'] for r in records),
    'positions_source':'manual overrides only',
    'week_source':'ISO Monday–Sunday (provisional)',
},indent=2)+'\n')
print(f'Exported {len(records)} game logs through {max(r["date"] for r in records)}')
