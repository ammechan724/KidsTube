# KidsTube maintenance Makefile
# Self-contained fallback so anyone with the repo can refresh videos without
# relying on the scheduled cron.

.PHONY: help scrape refresh serve

help:
	@echo "KidsTube maintenance"
	@echo ""
	@echo "Targets:"
	@echo "  make scrape    — Run scraper, write to data/videos.json (no git push)"
	@echo "  make refresh   — Scrape + commit + push (needs git remote + auth)"
	@echo "  make serve     — Serve public/ on http://localhost:8000"
	@echo ""
	@echo "GitHub Actions cron also runs this on schedule (see .github/workflows/scrape.yml)."
	@echo "Manual trigger: https://github.com/ammechan724/KidsTube/actions/workflows/scrape.yml"

scrape:
	node scraper/scrape.mjs --max=100

refresh: scrape
	git add public/data/videos.json data/videos.json
	@if git diff --cached --quiet; then \
		echo "No changes to commit."; \
	else \
		git commit -m "chore: refresh video cache ($$(date -u +%FT%TZ))"; \
		git push; \
		echo "✓ Pushed."; \
	fi

serve:
	python3 -m http.server -d public 8000