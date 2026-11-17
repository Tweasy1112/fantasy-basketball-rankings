"""Update NBA injury snapshots and retain first-seen timestamps per injury episode.
First-seen is observation time, NOT verified injury onset. A report is game-specific.
"""
import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

DEST = Path(__file__).resolve().parents[1] / 'data' / 'injuries.json'


def clean_name(value):
    name = str(value or '').strip()
    if ',' in name:
        last, first = name.split(',', 1)
        return f'{first.strip()} {last.strip()}'
    return name


def norm(value):
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', str(value or '').lower())).strip()


def injury_key(reason):
    """Keep episode stable through status changes and minor formatting changes."""
    return norm(reason)


def fetch_recent():
    from nbainjuries import injury
    now = datetime.now(ZoneInfo('America/New_York'))
    candidate = now.replace(minute=(now.minute // 15) * 15, second=0, microsecond=0)
    errors = []
    for step in range(16):
        dt = candidate - timedelta(minutes=15 * step)
        try:
            rows = injury.get_reportdata(dt.replace(tzinfo=None))
            if hasattr(rows, 'to_dict'):
                rows = rows.to_dict('records')
            if isinstance(rows, str):
                rows = json.loads(rows)
            if not isinstance(rows, list) or not rows:
                raise ValueError('No report rows')
            return now, dt, rows
        except Exception as exc:
            errors.append(f'{dt}: {type(exc).__name__}: {exc}')
    raise RuntimeError('No usable report; preserving prior data. ' + '; '.join(errors[-3:]))


def update(previous, now, snapshot, rows):
    prior = {norm(p.get('name')): p for p in previous.get('players', []) if p.get('name')}
    current = {}
    covered = set()
    game_dates = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        team = str(row.get('Team') or '').strip()
        date = str(row.get('Game Date') or '').strip()
        if team:
            covered.add(team)
            if date:
                game_dates.setdefault(team, set()).add(date)
        name = clean_name(row.get('Player Name'))
        if not name:
            continue
        key = norm(name)
        reason = str(row.get('Reason') or '')
        old = prior.get(key)
        same = bool(old and old.get('active', True) and injury_key(old.get('reason')) == injury_key(reason))
        current[key] = {
            'name': name, 'status': str(row.get('Current Status') or 'Unknown'),
            'reason': reason, 'team': team, 'game_date': date,
            'active': True,
            'first_reported_at': old.get('first_reported_at') if same and old.get('first_reported_at') else snapshot.isoformat(timespec='minutes'),
            'first_seen_source': old.get('first_seen_source', 'tracked_snapshot') if same else 'tracked_snapshot',
            'last_reported_at': snapshot.isoformat(timespec='minutes'),
        }
    if not current:
        raise ValueError('No player records in report; refusing to overwrite last good data')
    # Missing from a report does not prove healthy. Retain when team coverage is
    # missing. For a covered team with a NEW game date, mark old episode inactive.
    # This is a heuristic, not a confirmed medical clearance.
    for key, old in prior.items():
        if key in current:
            continue
        old = dict(old)
        team = old.get('team')
        old_game = old.get('game_date')
        newer_game = team in game_dates and any(g != old_game for g in game_dates[team])
        if newer_game and old.get('active', True):
            old['active'] = False
            old['cleared_from_feed_at'] = snapshot.isoformat(timespec='minutes')
            old['clearance_note'] = 'Absent from a later game-specific report covering this team; not medical clearance.'
        current[key] = old
    return {
        'updated_at': now.isoformat(timespec='minutes'),
        'report_snapshot_et': snapshot.isoformat(timespec='minutes'),
        'source': 'Official NBA injury reports via nbainjuries',
        'coverage_note': 'Game-specific reports. First-seen is first observed by this updater, not injury onset. Missing players are not necessarily healthy.',
        'players': list(current.values()),
    }


def main():
    previous = {}
    if DEST.exists():
        previous = json.loads(DEST.read_text(encoding='utf-8'))
    try:
        now, snapshot, rows = fetch_recent()
        payload = update(previous, now, snapshot, rows)
    except Exception as exc:
        print(f'Injury refresh failed, preserving existing file: {exc}', file=sys.stderr)
        raise SystemExit(1)
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Updated {DEST}: {sum(p.get("active", True) for p in payload["players"])} active of {len(payload["players"])} tracked players')


if __name__ == '__main__':
    main()
