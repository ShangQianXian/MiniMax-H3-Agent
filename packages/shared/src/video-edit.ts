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

/** Selected zero-based frames, exported in source order at source average FPS without audio. */
export interface VideoFrameExportRequest {
  frames: number[];
}

/** Every thumbnail represents one decoded frame; sheets only batch transport. */
export const FRAME_SHEET_COLUMNS = 10;
export const FRAME_SHEET_SIZE = 100;
