# Netease Playback Incident: Overseas IP Copyright Restriction

## Date

2026-04-26

## Symptom

Netease search worked, but many tracks returned `url: null` from `/song/url/v1` and the player showed:

```text
blockReason: 暂无版权或账号无播放权限
```

The account was VIP, so the first assumption was that cookie or VIP authorization was not being applied.

## Root Cause

The Netease login/session had been created while using an overseas IP. That put the account/API session into a copyright-restricted region context, so playable URLs were blocked for tracks that were otherwise available.

## Resolution

Log in again from the correct region/network, refresh `NCM_COOKIE`, restart both services, then retry playback.

## Notes For Open Source Users

This project can only play tracks when the upstream Netease-compatible API returns a valid audio URL. A successful search result does not guarantee playback rights. If playback fails:

- Verify the Netease API service is reachable.
- Verify the cookie is valid and belongs to the user.
- Verify login was performed from the intended region.
- Check `/song/url/v1?id=<songId>&level=standard`.
- Check `/check/music?id=<songId>`.

Do not implement copyright or region bypass logic.
