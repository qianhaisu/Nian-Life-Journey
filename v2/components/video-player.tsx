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
export function VideoPlayer({ mediaId, alt, durationSeconds }: { mediaId: string; alt: string; durationSeconds?: number | null }) {
  return (
    <video
      className="video-player"
      controls
      preload="metadata"
      playsInline
      poster={mediaDeliveryUrl(mediaId, "poster")}
      aria-label={alt}
      data-duration={durationSeconds ?? undefined}
    >
      <source src={mediaDeliveryUrl(mediaId, "preview")} type="video/mp4" />
    </video>
  );
}
