"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/i18n/client";
import { formatDuration } from "@/lib/mediaRights";
import { DownloadIcon, ForwardIcon, PauseIcon, PlayIcon, RewindIcon } from "@/components/icons";

/**
 * A proper player for the audio in a story.
 *
 * The article body is sanitised HTML, so its <audio> elements are plain
 * DOM rather than React. This component finds each one after the page
 * has hydrated, hides the browser's own controls and renders a player of
 * ours beside it — play/pause, skip 15 seconds, a seek bar, elapsed and
 * total time, playback speed, and a download link where the licence
 * allows one. Without JavaScript the native controls stay, so nothing is
 * lost; with it, the player looks and works the same in every browser.
 */
export interface AudioPlayerItem {
  id: string;
  title: string | null;
  downloadUrl: string | null;
  durationSecs: number | null;
}

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

// The element is a DOM handle the component drives, not data it owns.
// Kept outside the component so the hooks lint does not read a
// property assignment on it as a prop mutation.
function seekElement(el: HTMLMediaElement, seconds: number): number {
  el.currentTime = seconds;
  return el.currentTime;
}
function setRate(el: HTMLMediaElement, rate: number): void {
  el.playbackRate = rate;
}

interface Mounted {
  item: AudioPlayerItem;
  audio: HTMLAudioElement;
  host: HTMLDivElement;
}

export function AudioPlayers({ items, scope }: { items: AudioPlayerItem[]; scope: string }) {
  const [mounted, setMounted] = useState<Mounted[]>([]);

  useEffect(() => {
    const root = document.querySelector(scope);
    if (!root) return;
    const found: Mounted[] = [];
    for (const item of items) {
      const figure = root.querySelector<HTMLElement>(`figure[data-media-id="${CSS.escape(item.id)}"]`);
      const audio = figure?.querySelector("audio");
      if (!figure || !audio) continue;
      const host = document.createElement("div");
      host.className = "audio-player";
      audio.insertAdjacentElement("afterend", host);
      audio.controls = false;
      audio.classList.add("sr-only");
      found.push({ item, audio, host });
    }
    // Set from an effect on purpose: the elements only exist once the
    // sanitised body is in the DOM.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(found);
    return () => {
      for (const { audio, host } of found) {
        host.remove();
        audio.controls = true;
        audio.classList.remove("sr-only");
      }
      setMounted([]);
    };
  }, [items, scope]);

  return (
    <>
      {mounted.map(({ item, audio, host }) => createPortal(<Player key={item.id} item={item} audio={audio} />, host))}
    </>
  );
}

function Player({ item, audio }: { item: AudioPlayerItem; audio: HTMLAudioElement }) {
  const { t } = useI18n();
  const [playing, setPlaying] = useState(!audio.paused);
  const [time, setTime] = useState(audio.currentTime);
  const [duration, setDuration] = useState(Number.isFinite(audio.duration) ? audio.duration : (item.durationSecs ?? 0));
  const [speedIndex, setSpeedIndex] = useState(0);
  const seeking = useRef(false);

  useEffect(() => {
    const onTime = () => {
      if (!seeking.current) setTime(audio.currentTime);
    };
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
    };
  }, [audio]);

  function toggle() {
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  }
  function seekTo(seconds: number) {
    setTime(seekElement(audio, seconds));
  }
  function skip(delta: number) {
    seekTo(Math.min(Math.max(0, audio.currentTime + delta), duration || audio.currentTime + delta));
  }
  function cycleSpeed() {
    const next = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(next);
    setRate(audio, SPEEDS[next]!);
  }

  const speed = SPEEDS[speedIndex]!;

  return (
    <div className="flex flex-col gap-2" data-audio-player={item.id} data-state={playing ? "playing" : "paused"}>
      {item.title && <p className="text-sm font-medium text-ink">{item.title}</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => skip(-15)} className="btn btn-ghost btn-icon h-8 w-8" aria-label={t("player.back")} title={t("player.back")}>
          <RewindIcon size={16} />
        </button>
        <button
          type="button"
          onClick={toggle}
          className="btn btn-primary btn-icon h-10 w-10"
          aria-label={playing ? t("player.pause") : t("player.play")}
          aria-pressed={playing}
          title={playing ? t("player.pause") : t("player.play")}
        >
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <button type="button" onClick={() => skip(15)} className="btn btn-ghost btn-icon h-8 w-8" aria-label={t("player.forward")} title={t("player.forward")}>
          <ForwardIcon size={16} />
        </button>
        <span className="ml-1 w-12 text-right text-xs text-ink-2 tabular-nums">{formatDuration(time)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(duration))}
          step={1}
          value={Math.min(Math.floor(time), Math.max(1, Math.floor(duration)))}
          aria-label={t("player.seek")}
          aria-valuetext={`${formatDuration(time)} / ${formatDuration(duration)}`}
          onPointerDown={() => {
            seeking.current = true;
          }}
          onChange={(e) => setTime(Number(e.target.value))}
          onPointerUp={(e) => {
            seeking.current = false;
            seekTo(Number((e.target as HTMLInputElement).value));
          }}
          onKeyUp={(e) => {
            seekTo(Number((e.target as HTMLInputElement).value));
          }}
          className="min-w-0 flex-1 accent-[var(--accent)]"
        />
        <span className="w-12 text-xs text-ink-3 tabular-nums">{formatDuration(duration)}</span>
        <button type="button" onClick={cycleSpeed} className="btn btn-ghost btn-sm h-8 px-2 tabular-nums" aria-label={`${t("player.speed")}: ${speed}×`} title={t("player.speed")}>
          {speed}×
        </button>
        {item.downloadUrl && (
          <a href={item.downloadUrl} download className="btn btn-ghost btn-icon h-8 w-8" aria-label={t("article.download")} title={t("article.download")}>
            <DownloadIcon size={16} />
          </a>
        )}
      </div>
    </div>
  );
}
