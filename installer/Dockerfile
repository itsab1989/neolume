# Optional helper ("Helfer") for a NAS (Synology, QNAP, Unraid, Raspberry Pi, ...).
# Runs ONLY the helper (watchlist + Discover rows for the TV) from a helper.json that the setup program created on a
# computer ("Set up the helper" + "Remember access"). The setup web UI itself is not available in the container.
#
#   Image:   ghcr.io/itsab1989/<APP_SLUG>-setup:<version>|latest   (linux/amd64, linux/arm64, linux/arm/v7)
#   Port:    32499/tcp (helper; plain HTTP, home network only - never forward it in your router)
#   Volume:  /data  -> folder that contains helper.json (mount read-only)
#   Network: host networking is REQUIRED (the helper must see the TV's real address for its LAN/TV checks)
#
#   docker run -d --name neolume-helper --restart=unless-stopped --net=host \
#     --user "$(id -u):$(id -g)" -v /volume1/docker/neolume:/data:ro ghcr.io/itsab1989/neolume-setup:latest
#
# Build locally: docker build -t neolume-setup installer/      (see installer/BUILD.md, docker-compose.yml)
FROM python:3.12-alpine

ARG VERSION=dev
# from the brand profile (CI: installer/build.py brand); defaults = public brand
ARG APP_NAME=Neolume
ARG APP_REPO=itsab1989/neolume
LABEL org.opencontainers.image.title="${APP_NAME} helper" \
      org.opencontainers.image.description="Optional helper for the ${APP_NAME} TV app (watchlist and Discover rows from plex.tv for 2014 Samsung TVs)" \
      org.opencontainers.image.source="https://github.com/${APP_REPO}" \
      org.opencontainers.image.version="${VERSION}"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PLEXNEO_SETUP_DIR=/data

WORKDIR /app
COPY plexneo_setup.py /app/plexneo_setup.py
COPY neosetup /app/neosetup

# nobody:nogroup; on a NAS pass your own user with --user so the container can read helper.json (0600)
USER 65534:65534
EXPOSE 32499/tcp
VOLUME ["/data"]

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python3", "-I", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:32499/neo-helper', timeout=4)"]

# --wait: without helper.json the container waits (and logs once) instead of restarting in a loop
ENTRYPOINT ["python3", "-I", "/app/plexneo_setup.py"]
CMD ["--helper", "--wait", "--helper-file", "/data/helper.json"]
