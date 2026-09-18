"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { mediaDeliveryUrl } from "@/lib/media/paths";

// The first player this archive has had. Until 2026-09-10 a video could only ever have been a
// still: lib/media/deliverability.ts said so in as many words ("a video is only ever shown through
// its poster — there is no inline player on a family page"), and nothing had produced a poster
// either, so all 121 videos 404'd at every variant. A poster alone would have been the wrong fix —
// a picture of a video is not a video — so this arrives together with the derivatives that make it
// playable.
//
// Deliberately plain. Native controls, because the browser's own are the ones a phone already knows
// how to use, and because a custom bar is a lot of surface to maintain for a page with three
// readers. `preload="metadata"` so a month full of days costs a few hundred bytes per video rather
// than the file; the poster is what fills the frame until someone presses play. No autoplay: a
// video that starts talking on its own is exactly the behaviour a quiet archive should not have.
//
// No <track>: this archive has no captions for these clips and inventing them would be inventing
// speech. When real ones exist they belong here as a track element with the source that produced
// them, not before.
//
// Two things the native bar alone could not do, added 2026-09-12 after the clip in /memory/2025/11
// was read at both sizes:
//
//  - At 117 CSS px wide — a day's photo grid on a 391px phone — Chrome drops the play button and
//    leaves a bare scrubber and an overflow dot. A reader sees a still photograph with a slider
//    under it, in the same grid where every neighbouring tile opens a full-screen viewer instead.
//    Nothing said this one was a clip. The button below is ours, so it does not depend on any
//    browser's idea of which controls fit; the native bar keeps the scrubber, the volume and the
//    overflow menu, and this sits clear of it.
//  - When the source could not be fetched, the frame said nothing at all: the poster stayed, the
//    scrubber went empty, `video.error` was null, and tapping did nothing for as long as anyone
//    cared to tap. A clip that cannot be played has to say so.

// Whether the element has actually given up on its sources, as opposed to still working. Buffering
// mid-play and a slow first fetch both leave networkState at NETWORK_LOADING and must never be
// reported as failure — the reader is told a video is broken only when it is.
const NETWORK_NO_SOURCE = 3;
export function hasGivenUp(video: { error: unknown; networkState: number }): boolean {
  return Boolean(video.error) || video.networkState === NETWORK_NO_SOURCE;
}

type FullscreenCapableElement = {
  requestFullscreen?: () => Promise<void> | void;
  webkitRequestFullscreen?: () => Promise<void> | void;
  webkitEnterFullscreen?: () => Promise<void> | void;
};

/**
 * Ask for fullscreen, using whichever interface this browser actually has.
 *
 * Three of them are in play and they are not interchangeable. Desktop and Android use the standard
 * Element.requestFullscreen on the frame. iOS Safari refuses that on a div and exposes
 * webkitEnterFullscreen on the <video> element itself, which is why the video is tried as well as
 * its container. Older WebKit desktop keeps the webkit-prefixed name.
 *
 * Returns whether any of them was accepted, so a refusal can be shown rather than swallowed. It is
 * deliberately NOT awaited before play(): the permission to go fullscreen and the permission to
 * play both come from the same user gesture, and awaiting one spends the gesture before the other
 * is asked for.
 */
export async function requestFullscreen(frame: unknown, video: unknown): Promise<boolean> {
  const candidates: Array<() => Promise<void> | void> = [];
  const frameEl = frame as FullscreenCapableElement | null;
  const videoEl = video as FullscreenCapableElement | null;
  if (frameEl?.requestFullscreen) candidates.push(() => frameEl.requestFullscreen!());
  if (frameEl?.webkitRequestFullscreen) candidates.push(() => frameEl.webkitRequestFullscreen!());
  if (videoEl?.webkitEnterFullscreen) candidates.push(() => videoEl.webkitEnterFullscreen!());
  for (const ask of candidates) {
    try {
      await ask();
      return true;
    } catch {
      // Refused (no user gesture, a policy, or an element this browser will not accept) — try the
      // next interface before concluding anything.
    }
  }
  return false;
}

// Keyed on the clip's id, so a frame that is handed a different clip gets a different element
// rather than a reused one. The alternative — keeping the element and calling load() — leaves the
// old resource's in-flight callbacks alive to land on the new clip, and 「这段视频暂时打不开」 from
// a clip that is no longer on screen would be a lie about the one that is. Remounting throws both
// the element and the state away together, which is the version with nothing left to get wrong.
export function VideoPlayer(props: { mediaId: string; alt: string; durationSeconds?: number | null }) {
  return <PlayableClip key={props.mediaId} {...props} />;
}

function PlayableClip({ mediaId, alt, durationSeconds }: { mediaId: string; alt: string; durationSeconds?: number | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // Set only when a fullscreen request was refused, so the reader is offered the button again
  // instead of being left wondering why nothing filled the screen. Playback is never blocked on it.
  const [fullscreenRefused, setFullscreenRefused] = useState(false);
  // Playback state is read back from the element's own events, never assumed from the click: a
  // play() that the browser refuses must not leave a button claiming the clip is running.
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  const askTheElement = useCallback(() => {
    const video = ref.current;
    if (video) setFailed(hasGivenUp(video));
  }, []);

  useEffect(() => {
    setFailed(false);
    setPlaying(false);
    const video = ref.current;
    if (!video) return;
    // The element is server-rendered and starts fetching before React hydrates, so a failure can
    // have come and gone before any handler below existed. Ask the element what happened rather
    // than waiting for an event that has already fired.
    if (hasGivenUp(video)) setFailed(true);
    else if (!video.paused) setPlaying(true);
  }, [mediaId]);

  // A candidate source failing is not yet the element giving up — there could be another one — so
  // the verdict is taken once resource selection has settled rather than on the spot.
  const handleSourceError = useCallback(() => {
    askTheElement();
    setTimeout(askTheElement, 0);
  }, [askTheElement]);

  const startPlaying = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    // The button sits over the picture. Chrome also plays and pauses on a click on the video
    // itself, so without this a click could start the clip and stop it again in the same gesture.
    event.stopPropagation();
    const video = ref.current;
    if (!video) return;
    // Both requests are made inside this handler, while the user's gesture is still live. Play is
    // started first and not awaited: fullscreen is the nicety, playing is the thing they asked for,
    // and a browser that refuses fullscreen must still play the clip.
    const started = video.play() as Promise<void> | undefined;
    started?.catch(() => {
      // A refused play() is not proof the file is broken — it is often only a policy saying no.
      // The button goes back to offering play, and only the element's own verdict can raise the
      // failure message.
      setPlaying(false);
      askTheElement();
    });
    void requestFullscreen(frameRef.current, video).then((accepted) => setFullscreenRefused(!accepted));
  }, [askTheElement]);

  // Offered after a refusal, and after the reader leaves fullscreen and wants it back. Same two
  // interfaces, same rule: a refusal is reported, never swallowed.
  const goFullscreen = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const accepted = await requestFullscreen(frameRef.current, ref.current);
    setFullscreenRefused(!accepted);
  }, []);

  return (
    <div className="video-frame" ref={frameRef}>
      <video
        ref={ref}
        className="video-player"
        controls
        preload="metadata"
        playsInline
        poster={mediaDeliveryUrl(mediaId, "poster")}
        aria-label={alt}
        data-duration={durationSeconds ?? undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={askTheElement}
        // Anything arriving is proof the clip is not broken, including after a stall.
        onLoadedData={() => setFailed(false)}
        onCanPlay={() => setFailed(false)}
      >
        <source src={mediaDeliveryUrl(mediaId, "preview")} type="video/mp4" onError={handleSourceError} />
      </video>
      {/* Playing, but the browser would not go fullscreen: the reader keeps an explicit way to ask
          again rather than a clip that quietly stayed in its tile. */}
      {playing && fullscreenRefused ? (
        <button type="button" className="video-fullscreen" onClick={goFullscreen} aria-label={`全屏播放 ${alt}`}>
          全屏
        </button>
      ) : null}
      {failed ? (
        <p className="video-unavailable">这段视频暂时打不开</p>
      ) : playing ? null : (
        // The layer reserves the strip along the bottom for the browser's own bar and centres the
        // button in what is left, so the hit area can be a comfortable size without ever landing on
        // the scrubber. It passes the pointer through everywhere except the button itself, which
        // leaves Chrome's own click-on-the-picture behaviour intact.
        <span className="video-play-layer">
          <button type="button" className="video-play" onClick={startPlaying} aria-label={`播放 ${alt}`}>
            {/* The disc is the mark; the button around it is the target, and is the larger of the
                two. On a tile in a six-up grid that comes out 32px against 44px: the first is the
                right size to sit on a photograph, the second is the right size to ask a thumb for. */}
            <span className="video-play-mark">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5.5v13l11-6.5z" /></svg>
            </span>
          </button>
        </span>
      )}
    </div>
  );
}
