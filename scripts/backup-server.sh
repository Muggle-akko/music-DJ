#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
backup_file="backups/awudio-$(date +%Y%m%d-%H%M%S).tar.gz"
# Stop the writer for a consistent snapshot; a temporary read-only container reads the volume.
sh scripts/server.sh stop app
trap 'sh scripts/server.sh start app' EXIT
sh scripts/server.sh run --rm --no-deps --entrypoint tar app czf - -C /app/data . > "$backup_file"
printf '备份已保存：%s（包含私有凭证，请勿公开）\n' "$backup_file"
