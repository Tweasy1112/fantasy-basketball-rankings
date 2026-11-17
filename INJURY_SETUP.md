# NBA injury feed integration

The website now displays injury status and injury reason from `data/injuries.json` in the Trade Calculator. The report is sourced from official NBA injury PDFs using `nbainjuries`. It does **not** supply return dates or estimated weeks out; users still set those assumptions themselves.

## First run
1. Upload the project files to your GitHub repository.
2. Go to Actions > Update NBA Injuries > Run workflow.
3. Check that `data/injuries.json` contains a timestamp and player records. If not, review the workflow logs.
4. Refresh the website after Netlify deploys the commit.

The workflow is scheduled three times a day (UTC). GitHub Actions schedules are best-effort. If a fetch fails, the script preserves the last good snapshot rather than inventing statuses. The frontend displays the snapshot timestamp. An absent player does not mean healthy. Source PDFs may omit players or have temporary gaps. The scraper may need maintenance if the NBA changes its report layout.

## Hashtag Basketball historical data
Historical recovery estimates are **not** copied, scraped, or embedded here. Permission for automated reuse and access to the underlying case-level data have not been established. This update is Phase 1: verified reported status + manual missed-weeks scenarios. Future phases can add a properly licensed historical recovery dataset, conditional time-to-return model, schedule-based missed-games probabilities, and backtesting.
