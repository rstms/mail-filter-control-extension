
# thunderbird extension makefile

project != basename $$(pwd)
gitclean = if git status --porcelain | grep '^.*$$'; then echo git status is dirty; false; else echo git status is clean; true; fi

src = $(wildcard src/*.js) $(wildcard ./experiments/*/*.js)
schema = $(wildcard ./experiments/*/*.json)
json != find -type f -name \*.json
json_fmt = $(foreach foo,$(json),$(dir $(foo)).$(notdir $(basename $(foo))))

html = options.html editor.html rescan.html

package_files = manifest.json VERSION LICENSE README.md $(schema) $(src) $(html) assets funnel.svg
version != cat VERSION

all: $(html) $(src) $(json_fmt) fix .fmt lint assets
	touch manifest.json

.manifest: manifest.json
	jq . <$< >$<.parsed && mv $<.parsed $<
	touch $@

.updates: updates.json
	jq . <$< >$<.parsed && mv $<.parsed $<
	touch $@

experiments/carddav/.schema: experiments/carddav/schema.json
	jq . <$< >$<.parsed && mv $<.parsed $<
	touch $@

experiments/activity_manager/.schema: experiments/activity_manager/schema.json
	jq . <$< >$<.parsed && mv $<.parsed $<
	touch $@

experiments/background_send/.schema: experiments/background_send/schema.json
	jq . <$< >$<.parsed && mv $<.parsed $<
	touch $@

assets: exported/assets
	rm -rf assets
	mkdir assets
	mv exported/assets/* assets

%.html: exported/%.html
	sed '/<script>/,/<\/script>/d' $< >$@

fix: .fix

.fix: $(src)
	fix eslint fix src/*.js experiments/*/*.js

lint: eslint.config.js
	eslint src/*.js experiments/*/*.js

eslint.config.js:
	eslint config >$@

fmt:	.fmt

.fmt: fix $(html)
	prettier --tab-width 4 --print-width 135 --write "src/*.js" "*.html" "experiments/*/*.js"
	touch $@

release_file = $(project)-$(version).xpi

release: all
	@$(gitclean) || { [ -n "$(dirty)" ] && echo "allowing dirty release"; }
	rm -f release.zip
	zip release.zip -r $(package_files)
	mv release.zip dist/$(release_file)
	@$(if $(update),gh release delete -y v$(version),)
	gh release create v$(version) --notes "v$(version)"
	gh release upload v$(version) updates.json
	( cd dist && gh release upload v$(version) $(release_file) )

clean:
	rm -f .eslint
	docker rmi eslint || true
	rm -f .prettier
	docker rmi prettier || true
	rm -rf src/node_modules
	rm -f release.zip

distclean: clean
	rm -f dist/*.xpi

