/** Frame indices are zero-based; endFrame is exclusive. Times are seconds from video start. */
export interface VideoMetadata {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  durationSec: number;
  frameTimes: number[];
  hasAudio: boolean;
}

export interface VideoTrimRequest {
  startFrame: number;
  endFrame: number;
}
