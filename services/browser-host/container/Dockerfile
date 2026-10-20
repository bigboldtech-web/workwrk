# The browser image (docs/plans/browser-host.md 5.2, Decision 12): Google
# Chrome stable from Google's signed apt repository, on Debian trixie slim.
#
# Built on the server by the launcher's `build` operation as
# workwrk-chrome:candidate, with CACHE_DAY set to the day so apt runs again
# each day, and promoted to workwrk-chrome:<yyyymmdd-hhmm> and :current only
# after its self-test passes.
#
# The setuid chrome-sandbox is removed: under no-new-privileges it could never
# work, and Chrome uses its namespace sandbox instead. Chrome runs as uid
# 10001, which no user or file on the server owns (8.2 step 6).
#
# Each session's command is ["<timeout + 60>", "/usr/local/bin/wkb-start",
# <the flags of 5.3>, "about:blank"]: tini reaps every child as PID 1, and
# `timeout -s KILL` ends the container on its own if the host is gone.
#
# perl-base and util-linux (both Essential in Debian, so in the slim image)
# carry the self-test's probes; nothing is added for them.
#
# GOOGLE'S KEY is trusted by its fingerprint alone: the downloaded file is
# imported into a keyring of its own, and only the key with that fingerprint
# is exported into the keyring apt uses, so a file holding Google's key and
# another one beside it gives apt Google's alone (step 3 review, M2).
# verify: the fingerprint, against Google's published Linux signing key, at
# build time.
#
# THE START (wkb-start): Chrome's DevTools listens on 127.0.0.1:9223 and
# socat relays the container's port 9222 to it, so the host reaches DevTools
# the same way whichever address this Chrome binds under headless.
FROM debian:trixie-slim
ARG CACHE_DAY
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg tini socat \
      fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
 && export GNUPGHOME="$(mktemp -d)" \
 && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub -o "$GNUPGHOME/google.asc" \
 && gpg --batch --quiet --import "$GNUPGHOME/google.asc" \
 && gpg --batch --export EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796 > /usr/share/keyrings/google-linux.gpg \
 && test -s /usr/share/keyrings/google-linux.gpg \
 && test "$(gpg --show-keys --with-colons /usr/share/keyrings/google-linux.gpg | grep -c '^pub:')" = 1 \
 && gpg --show-keys --with-colons /usr/share/keyrings/google-linux.gpg | grep -qx "fpr:::::::::EB4C1BFD4F042F6DDDCCEC917721F63BD38B4796:" \
 && rm -rf "$GNUPGHOME" && unset GNUPGHOME \
 && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] https://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
 && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
 && rm -f /opt/google/chrome/chrome-sandbox \
 && apt-get purge -y curl gnupg && apt-get autoremove -y && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 chrome && useradd -u 10001 -g 10001 -d /home/chrome -s /usr/sbin/nologin -M chrome
COPY wkb-start /usr/local/bin/wkb-start
USER 10001:10001
ENV HOME=/home/chrome TZ=UTC LANG=C.UTF-8
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/bin/timeout", "-s", "KILL"]
