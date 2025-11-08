SHELL := /bin/bash

all: showhn enrich

showhn:
	@echo "Fetching Show HN posts..."
	@curl -s "https://hn.algolia.com/api/v1/search_by_date?tags=story&query=Show%20HN" \
	| jq -r '.hits[] | select((now - (.created_at_i|tonumber)) < 30*24*3600) | .url // empty' \
	| grep -E '^https?://' | sort -u > showhn_urls.txt
	@echo "✓ Fetched Show HN URLs"

producthunt:
	@echo "⚠️  Product Hunt blocks automated scraping"
	@echo "📋 To add Product Hunt URLs:"
	@echo "   1. Visit https://www.producthunt.com/"
	@echo "   2. Copy product website URLs"
	@echo "   3. Paste into producthunt_urls.txt (one per line)"
	@test -f producthunt_urls.txt || touch producthunt_urls.txt

# X/Twitter scraping is disabled - snscrape is broken with Python 3.14 and X requires auth
# If you have X API access, manually add URLs to x_startup_urls.txt
x:
	@echo "X/Twitter scraping is currently disabled (snscrape incompatible with Python 3.14)"
	@echo "If you have URLs to add, put them in x_startup_urls.txt manually"
	@touch x_startup_urls.txt

enrich:
	@test -f showhn_urls.txt || touch showhn_urls.txt
	@test -f producthunt_urls.txt || touch producthunt_urls.txt
	@test -f x_startup_urls.txt || touch x_startup_urls.txt
	@echo "Enriching leads..."
	@cat showhn_urls.txt producthunt_urls.txt x_startup_urls.txt | sort -u > urls_all.txt
	@bun run enrich_urls.mjs showhn_urls.txt producthunt_urls.txt x_startup_urls.txt > leads.csv.tmp 2>&1
	@mv leads.csv.tmp leads.csv
	@echo ""

certstream:
	bun run harvest_certstream.mjs > certstream_hits.csv

clean:
	@echo "Cleaning cache and temporary files..."
	@rm -rf .cache
	@rm -f urls_all.txt
	@rm -f *.tmp
	@echo "✓ Cleaned"

.PHONY: all showhn producthunt x enrich certstream clean
