import type { Page } from "@playwright/test";
import type { MusicAlbum, MusicArtist, MusicHome, MusicPlayerRequest, MusicPlayerStatus, MusicPlaylist, MusicPlaylistTrack, MusicTrack, NasPlaybackStatus } from "../../packages/shared/src/index.js";
import { fixtures, stamp } from "./fixtures.js";

export const musicTracks: MusicTrack[] = Array.from({ length: 14 }, (_, index) => ({
  id: `song-${index}`, sourceId: "music-source", storagePoolId: "pool-1", relativePath: `Music/song-${index}.flac`,
  title: index === 0 ? "夜航 / Night Flight" : `远方的声音 ${index} / A very long song title ${index}`,
  albumId: `album-${Math.floor(index / 2)}`, album: `城市回声 ${Math.floor(index / 2)} / City Echoes`,
  artists: ["CyberOS Ensemble"], albumArtists: ["CyberOS Ensemble"], genres: ["Electronic"], year: 2026,
  trackNumber: index + 1, discNumber: index > 6 ? 2 : 1, durationSeconds: 245, bitrate: 900000,
  sampleRate: 48000, bitDepth: 24, musicbrainzRecordingId: null, musicbrainzReleaseId: null,
  coverKey: index === 5 ? "broken" : `cover-${Math.floor(index / 2)}`, missing: index === 1,
  favorite: index % 2 === 0, playCount: 14 - index, lastPlayedAt: stamp, addedAt: stamp, updatedAt: stamp,
}));
export const musicAlbums: MusicAlbum[] = Array.from({ length: 12 }, (_, index) => ({
  id: `album-${index}`, title: `城市回声 ${index} / City Echoes`, artists: ["CyberOS Ensemble"], genres: ["Electronic"],
  year: 2026, coverKey: index === 5 ? null : `cover-${index}`, trackCount: 2, durationSeconds: 490, favorite: false, addedAt: stamp,
}));
export const musicArtists: MusicArtist[] = [{ id: "artist-1", name: "CyberOS Ensemble / 来自远方的声音", albumCount: 12, trackCount: 14, coverKey: "cover-1", favorite: false }];
export const musicPlaylists: MusicPlaylist[] = Array.from({ length: 7 }, (_, index) => ({
  id: `playlist-${index}`, name: index === 0 ? "夜间漫游 / After Hours" : `我的歌单 ${index} / A long playlist name`,
  trackCount: 3, durationSeconds: 735, createdAt: stamp, updatedAt: stamp,
}));

export async function musicFixtures(page: Page, options: { locale?: string; queue?: boolean; history?: boolean; empty?: boolean; owner?: "music" | "video"; unavailable?: boolean } = {}) {
  await fixtures(page, options.locale ?? "en");
  const tracks = options.empty ? [] : musicTracks.map(track => ({ ...track }));
  const albums = options.empty ? [] : musicAlbums.map(album => ({ ...album }));
  const playlists = options.empty ? [] : musicPlaylists.map(playlist => ({ ...playlist }));
  let playlistRevision = 0;
  let playlistTracks: MusicPlaylistTrack[] = [tracks[0], tracks[2], tracks[0]].filter((track): track is MusicTrack => Boolean(track)).map((track, index) => ({ ...track, playlistItemId: `item-${index}` }));
  const home: MusicHome = {
    recentlyAdded: albums,
    recentlyPlayed: options.history === false ? [] : tracks,
    mostPlayed: [...tracks].reverse(),
    favorites: tracks.filter(track => track.favorite),
  };
  let music: MusicPlayerStatus = {
    owner: options.owner ?? "music", state: "playing", sessionId: "music-session", serviceInstanceId: "music-instance", revision: 9, queueVersion: 7,
    queue: options.queue === false || options.empty ? [] : [{ id: "queue-current", trackId: "song-0", storagePoolId: "pool-1", relativePath: "Music/song-0.flac", title: "夜航 / Night Flight", artist: "CyberOS Ensemble", album: "城市回声 0 / City Echoes", durationSeconds: 245, coverKey: "cover-0" }],
    currentItemId: options.queue === false || options.empty ? null : "queue-current", repeat: "off", shuffle: false,
    positionSeconds: 72, durationSeconds: 245, volume: 60, audioDeviceId: null, effectiveAudioDeviceId: "auto", error: null, errorCode: null, updatedAt: stamp,
  };
  if (!music.queue.length) music = { ...music, state: "idle", positionSeconds: 0, durationSeconds: null };
  if (options.owner === "video") music = { ...music, state: "paused" };
  const preferences = { videoVolume: 80, videoMuted: false, musicMuted: false, videoAudioDeviceId: null, audioDelays: {} };
  const nas = (): NasPlaybackStatus => ({
    target: "nas", owner: music.owner, sessionId: music.sessionId, serviceInstanceId: music.serviceInstanceId, revision: music.revision, music,
    preferences, audioDelayKey: "default", output: { requested: { kind: "default", deviceId: null }, effective: { kind: "default", deviceId: "auto" } },
    video: {
      state: music.owner === "video" ? "playing" : "idle", sessionId: music.sessionId, serviceInstanceId: music.serviceInstanceId, revision: music.revision,
      storagePoolId: null, relativePath: null, fileName: null, mediaFileId: null, videoOutput: "drm", positionSeconds: 0,
      durationSeconds: null, volume: 80, retryCount: 0, nextRetryAt: null, audioDeviceId: null, effectiveAudioDeviceId: "auto", audioFallbackReason: null,
      audioTracks: [], subtitleTracks: [], selectedAudioTrackId: null, selectedSubtitleTrackId: null,
      capabilities: { mpvAvailable: true, drmAvailable: true, audioAvailable: true, hardwareDecode: "enabled", error: null }, error: null, errorCode: null, updatedAt: stamp,
    },
  });
  const commands: MusicPlayerRequest[] = [];
  const requests: string[] = [];
  const mutations: { path: string; method: string; body: unknown }[] = [];
  await page.route("**/api/playback/status", route => options.unavailable
    ? route.fulfill({ status: 503, json: { error: "Player unavailable" } })
    : route.fulfill({ json: { status: nas() } }));
  await page.route("**/api/music/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/music", "");
    requests.push(`${request.method()} ${path}${url.search}`);
    if (request.method() !== "GET") mutations.push({ path, method: request.method(), body: request.postDataJSON() });
    if (path.startsWith("/artwork/")) {
      if (path.endsWith("/broken")) return route.fulfill({ status: 404 });
      const index = Number(path.match(/\d+/)?.[0] ?? 0);
      const colors = ["#b16449", "#405c76", "#7b774c", "#7b5a78", "#4e7e72", "#b88b52"];
      return route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><rect width="300" height="300" fill="${colors[index % colors.length]}"/><circle cx="150" cy="150" r="100" fill="none" stroke="#ded8c5" stroke-width="2"/><path d="M0 220L300 80M0 240L300 100M0 260L300 120" stroke="#ded8c5" stroke-width="24" opacity=".35"/><text x="25" y="45" fill="#eee9da" font-family="monospace" font-size="15">CYBEROS / ${String(index).padStart(2, "0")}</text><text x="25" y="278" fill="#eee9da" font-family="monospace" font-size="23">CITY ECHOES</text></svg>` });
    }
    if (path === "/player/command") {
      const command = request.postDataJSON() as MusicPlayerRequest;
      commands.push(command);
      if (music.owner === "video" && ["resume", "replace"].includes(command.type) && !("expectedSessionId" in command)) {
        return route.fulfill({ status: 409, json: { error: "Video owns playback", code: "SESSION_CONFLICT" } });
      }
      if (command.type === "replace") {
        const queue = command.trackIds.flatMap((id, index) => {
          const track = tracks.find(item => item.id === id);
          return track ? [{ id: `queue-${index}-${music.queueVersion + 1}`, trackId: track.id, storagePoolId: track.storagePoolId, relativePath: track.relativePath, title: track.title, artist: track.artists.join(" · "), album: track.album, durationSeconds: track.durationSeconds, coverKey: track.coverKey }] : [];
        });
        music = { ...music, queue, currentItemId: queue[0]?.id ?? null, positionSeconds: 0, durationSeconds: queue[0]?.durationSeconds ?? null, queueVersion: music.queueVersion + 1 };
      }
      music = { ...music, owner: "music", state: command.type === "pause" ? "paused" : "playing", revision: music.revision + 1, updatedAt: new Date().toISOString() };
      return route.fulfill({ json: { status: music } });
    }
    if (path === "/player") return options.unavailable ? route.fulfill({ status: 503, json: { error: "Player unavailable" } }) : route.fulfill({ json: { status: music } });
    if (path === "/home") return route.fulfill({ json: home });
    if (path === "/sources") return route.fulfill({ json: { sources: options.empty ? [] : [{ id: "music-source", name: "Music", storagePoolId: "pool-1", path: "Music", enabled: true, createdAt: stamp, updatedAt: stamp }] } });
    if (path === "/status") return route.fulfill({ json: { status: { sourceCount: options.empty ? 0 : 1, trackCount: options.empty ? 0 : 14, albumCount: options.empty ? 0 : 12, artistCount: options.empty ? 0 : 1, missingCount: options.empty ? 0 : 1, scans: [], revision: "fixture" } } });
    if (path === "/filter-options") return route.fulfill({ json: { years: [2026], genres: ["Electronic"] } });
    if (path === "/albums") return route.fulfill({ json: { items: albums, nextCursor: null } });
    if (path === "/artists") return route.fulfill({ json: { items: options.empty ? [] : musicArtists, nextCursor: null } });
    if (path === "/tracks") return route.fulfill({ json: { items: url.searchParams.get("favorite") === "true" ? tracks.filter(track => track.favorite) : tracks, nextCursor: null } });
    if (path === "/playlists") {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as { name: string };
        const playlist = { id: "created-playlist", name: body.name, trackCount: 0, durationSeconds: 0, createdAt: stamp, updatedAt: stamp };
        playlists.push(playlist);
        return route.fulfill({ json: { playlist } });
      }
      return route.fulfill({ json: { items: playlists.slice(0, Number(url.searchParams.get("limit") ?? 50)), nextCursor: null } });
    }
    if (path.startsWith("/albums/")) return route.fulfill({ json: { album: albums.find(album => path.endsWith(album.id)) ?? albums[0], tracks: tracks.slice(0, 3) } });
    if (path.startsWith("/artists/")) return route.fulfill({ json: { artist: musicArtists[0], albums, tracks, albumsNextCursor: null, tracksNextCursor: null } });
    if (path.startsWith("/playlists/")) {
      const playlist = playlists.find(item => path.endsWith(item.id)) ?? playlists[0];
      if (request.method() === "PATCH") {
        const body = request.postDataJSON() as { name?: string; trackIds?: string[] };
        if (playlist && body.name) playlist.name = body.name;
        if (body.trackIds) {
          playlistRevision += 1;
          playlistTracks = body.trackIds.flatMap((id, index) => {
            const track = tracks.find(item => item.id === id);
            return track ? [{ ...track, playlistItemId: `replaced-${playlistRevision}-${index}` }] : [];
          });
        }
      }
      return route.fulfill({ json: { playlist, tracks: playlistTracks } });
    }
    if (/^\/tracks\/[^/]+$/.test(path)) return route.fulfill({ json: { track: tracks.find(track => path.endsWith(track.id)) ?? tracks[0] } });
    if (path === "/favorites") {
      const body = request.postDataJSON() as { id: string; kind: string; favorite: boolean };
      const item = (body.kind === "track" ? tracks : albums).find(item => item.id === body.id);
      if (item) item.favorite = body.favorite;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 503, json: { error: "Music fixture unavailable" } });
  });
  return { commands, requests, mutations, home };
}
