"""Fetch a recent official NBA injury report using the open-source nbainjuries package.
Do not infer return dates or weeks missed. Preserve the last good report on failure.
"""
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

DEST = Path(__file__).resolve().parents[1] / 'data' / 'injuries.json'


def clean_name(name):
    name = str(name or '').strip()
    if ',' in name:
        surname, given = name.split(',', 1)
        return f'{given.strip()} {surname.strip()}'
    return name


def main():
    from nbainjuries import injury
    now = datetime.now(ZoneInfo('America/New_York'))
    # NBA publishes periodic snapshots. Try recent quarter-hour slots, then earlier slots.
    minute = (now.minute // 15) * 15
    candidate = now.replace(minute=minute, second=0, microsecond=0)
    failures = []
    for step in range(0, 16):
        dt = candidate - timedelta(minutes=15 * step)
        try:
            rows = injury.get_reportdata(dt.replace(tzinfo=None))
            if hasattr(rows, 'to_dict'):
                rows = rows.to_dict('records')
            if isinstance(rows, str):
                rows = json.loads(rows)
            if not isinstance(rows, list) or not rows:
                raise ValueError('No report rows')
            by_player = {}
            for row in rows:
                if not isinstance(row, dict):
                    continue
                name = clean_name(row.get('Player Name'))
                if not name:
                    continue
                key = name.casefold()
                by_player[key] = {
                    'name': name,
                    'status': str(row.get('Current Status') or 'Unknown'),
                    'reason': str(row.get('Reason') or ''),
                    'team': str(row.get('Team') or ''),
                    'game_date': str(row.get('Game Date') or ''),
                }
            if not by_player:
                raise ValueError('No player records')
            payload = {
                'updated_at': now.isoformat(timespec='minutes'),
                'report_snapshot_et': dt.isoformat(timespec='minutes'),
                'source': 'Official NBA injury reports via nbainjuries',
                'coverage_note': 'Only players included in the retrieved report. Missing players are not necessarily healthy.',
                'players': list(by_player.values()),
            }
            DEST.parent.mkdir(parents=True, exist_ok=True)
            DEST.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
            print(f'Updated {DEST} with {len(by_player)} report entries from {dt}')
            return
        except Exception as exc:
            failures.append(f'{dt.isoformat()}: {type(exc).__name__}: {exc}')
    print('No usable recent injury snapshot; retaining last good file.', file=sys.stderr)
    print('\n'.join(failures[-3:]), file=sys.stderr)
    if not DEST.exists():
        raise SystemExit(1)


if __name__ == '__main__':
    main()
