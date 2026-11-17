# Basketball League HQ — NBA player rankings v2

Static site for Yahoo fantasy basketball league 83287. The **Standard** and **High Score** calculation engine runs entirely in the browser. No Yahoo API required.

## Important: live data integration is prepared, not yet verified

The `scripts/update_stats.py` script pulls the 2026–27 regular-season NBA player game logs from the independent [llimllib/nba_data](https://github.com/llimllib/nba_data) DuckDB catalog and writes `data/game_logs.csv`. The GitHub Actions workflow runs it daily and commits the resulting file. The website automatically loads this file on startup. The source publishes updates approximately every four hours, but we have **not run the remote query successfully in this environment**, which has no outbound DNS access. Run the workflow and verify its result before treating the displayed data as current. No NBA player data is fabricated or bundled.

## How to publish with auto-updates

1. Create a new GitHub repository and upload **all files, including `.github/workflows/update-stats.yml`**.
2. In GitHub, go to **Actions → Update NBA game logs → Run workflow**.
3. Check the workflow log. If it succeeds, `data/game_logs.csv` and `data/status.json` appear in your repository. If it fails, inspect the error and fix the upstream query/schema; do not assume data was loaded.
4. Connect the repository to Netlify. Build command: **none**; publish directory: **project root**. Enable automatic deploys on commits.
5. GitHub Actions will attempt daily refreshes at 12:25 UTC. The data is only as current as the last successful refresh.

## Scoring and ranking

- Fantasy score = PTS + REB + 2×AST + 3×STL + 3×BLK − TOV + 2×DD (double-double: 10+ in at least two of PTS, REB, AST, STL, BLK).
- Standard total: sum of fantasy points in all played games; average = total / played games.
- High Score total: sum of each player's best game in each fantasy week; average = total / weeks with games.
- No DNPs or missed weeks in denominators. All players count regardless of fantasy lineup status.

## Accuracy limitations requiring follow-up

**Positions:** Independent NBA logs do not include Yahoo's exact PG/SG/SF/PF/C eligibility. `positions.csv` can be populated with Yahoo player IDs (the NBA source's `player_id` column) and position strings such as `PG/SG`. Until populated, **Overall** works, but position tabs may be empty. Do not treat generic NBA G/F labels as equivalent to Yahoo eligibility.

**Fantasy weeks:** The pipeline uses ISO Monday–Sunday week boundaries. Yahoo may combine weeks or use special boundaries. High Score totals are provisional until exact Yahoo weekly date ranges are mapped. This is a known discrepancy, not a verified match to Yahoo.

**Data source:** The independent data provider may change its schema, rate-limit access, or stop updating. The workflow fails rather than publishing an empty dataset. GitHub Actions and Netlify are external services with their own availability and usage limits.

**Game selection:** Regular-season NBA games only. Verify whether your fantasy league treats NBA Cup final games or other special games differently.

## Manual import fallback

Use **Import game logs CSV**. Columns: `date,player_id,player,team,positions,pts,reb,ast,stl,blk,tov,week,dd`. The `week`, `positions`, and `dd` fields are optional; imported data is not saved across page refreshes.


## Trade Calculator, Lineup Comparison and My Teams (new)

The website now includes three optional tools powered by the same published `data/game_logs.csv` file:

- **Trade Calculator:** Choose incoming/outgoing players and compare an experimental valuation. For uneven trades, see the combined replacement-player value needed to break even. The model uses historical weekly high scores shrunk toward game averages when samples are small, plus an approximate position-specific replacement baseline. It is a prototype valuation, not a validated projection.
- **Lineup Comparison:** Build two 13-slot starting lineups (PG, SG, G×3, SF, PF, C, FC×2, Util×3), filter players by Yahoo eligibility, auto-optimize selected players across eligible slots, and compare projected weekly totals with strengths and drawbacks. G allows PG/SG; FC allows SF/PF/C; Util allows any. Only players with mapped Yahoo positions are selectable.
- **My Teams:** Save/edit/rename/delete rosters in browser local storage. Import a saved team into a lineup, or start from scratch. Export/import JSON backups for moving between devices. No account, server, or automatic Yahoo roster syncing.

**Important limitations:** This initial release does **not** integrate a verified injury feed, starting-lineup feed, minutes projections, or Yahoo transaction sync. Weekly high-score projections are heuristic and do not model exact future game schedules, lineup locks, or injury absences. The Yahoo position mapping is partial. The trade valuation and lineup comparison are experimental, and their numerical values should not be treated as guaranteed future performance. The existing rankings, daily stats workflow, and CSV schema are unchanged.
