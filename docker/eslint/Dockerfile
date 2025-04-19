FROM node:alpine
RUN mkdir /app
WORKDIR /app

RUN npm install -g eslint eslint-config-standard eslint-plugin-import eslint-plugin-n eslint-plugin-promise eslint-formatter-unix --save-dev
#globals @eslint/migrate-config
#RUN npm install -g @eslint/eslintrc --save-dev
RUN npm install -g @eslint/js --save-dev
RUN npm install -g eslint-formatter-unix --save-dev

#RUN yes | npm init @eslint/config@latest -- --config eslint-config-standard
#RUN npm install -g @eslint/migrate-config
#RUN cp $(find / -name .eslintrc.json) .
#RUN npx @eslint/migrate-config .eslintrc.json

#RUN npx @eslint/migrate-config node_modules/eslint-config-standard/.eslintrc.json
#RUN npm install globals

COPY --chmod=0755 entrypoint /usr/bin/entrypoint

COPY eslint.config.js /eslint.config.js

#RUN \
#  SRC=$(find / -type f -name unix.js | xargs -n 1 dirname) && \
#  DST=$(find / -type d -name formatters | grep -v standard) && \
#  echo cp $SRC/* $DST

RUN apk add python3
COPY --chmod=0755 fix-eslint /usr/local/bin/fix-eslint
RUN fix-eslint

ENTRYPOINT ["/usr/bin/entrypoint"]
