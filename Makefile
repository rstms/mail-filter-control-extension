
# thunderbird extension makefile

project != basename $$(pwd)
docker = env DOCKER_BUILD_OUTPUT=plain BUILDKIT_PROGRESS=plain docker
gitclean = if git status --porcelain | grep '^.*$$'; then echo git status is dirty; false; else echo git status is clean; true; fi

src = $(wildcard src/*.js)
html = $(wildcard html/*.html)
schema = $(wildcard *schema.json)

#html = options.html editor.html popup.hml

package_files = manifest.json VERSION LICENSE README.md $(schema) $(src) $(html) assets
version != cat VERSION

all: $(html) $(src) fix .fmt lint .manifest .carddav .activity_manager .background_send assets
	touch manifest.json

.manifest: manifest.json
	jq . <$< >$<.parsed && mv $<.parsed $<
	touch $@

.carddav: carddav_schema.json
	jq . <$< >$<.parsed && mv $<.parsed $<
	touch $@

.activity_manager: activity_manager_schema.json
	jq . <$< >$<.parsed && mv $<.parsed $<
	touch $@

.background_send: background_send_schema.json
	jq . <$< >$<.parsed && mv $<.parsed $<
	touch $@

assets: exported/assets
	rm -rf assets
	mkdir assets
	mv exported/assets/* assets

%.html: exported/%.html
	sed '/<script>/,/<\/script>/d' $< >$@

fix: .eslint
	fix -- docker run --rm -v "$$(pwd):/app" eslint fix src/*.js

lint-shell: .eslint 
	docker run -it --rm -v "$$(pwd)/src:/app" eslint shell

lint: .eslint 
	docker run --rm -v "$$(pwd)/src:/app" eslint *.js

eslint.config.js: .eslint
	docker run -it --rm -v "$$(pwd)/src:/app" eslint config >$@

shell:
	docker run -it --rm -v "$$(pwd)/src:/app" eslint shell

closure: .closure
	docker run -it --rm -v "$$(pwd)/src:/app" closure shell

fmt:	.fmt

.fmt: .prettier $(src) $(html)
	docker run --rm -v "$$(pwd):/app" prettier --tab-width 4 --print-width 135 --write "src/*.js" "*.html"
	touch $@

.prettier: docker/prettier/Dockerfile
	cd docker/prettier && $(docker) build . -t prettier
	touch $@

.eslint: docker/eslint/Dockerfile docker/eslint/entrypoint docker/eslint/eslint.config.js
	cd docker/eslint && $(docker) build . -t eslint
	touch $@

.closure: docker/closure/Dockerfile  docker/closure/entrypoint
	cd docker/closure && $(docker) build -t closure --build-arg USER=$(USER) --build-arg UID=$(shell id -u) --build-arg GID=$(shell id -g) .
	touch $@

release_file = $(project)-$(version).xpi

release: all
	@$(gitclean) || { [ -n "$(dirty)" ] && echo "allowing dirty release"; }
	rm -f release.zip
	zip release.zip -r $(package_files)
	mv release.zip dist/$(release_file)
	@$(if $(update),gh release delete -y v$(version),)
	gh release create v$(version) --notes "v$(version)"
	( cd dist && gh release upload v$(version) $(release_file) )

clean:
	rm -f .eslint
	docker rmi eslint || true
	rm -f .prettier
	docker rmi prettier || true
	rm -rf src/node_modules
	rm -f release.zip
