import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { BackgroundAudioService } from "./backgroundAudio.service";

export interface AudioOverlayOptions {
  startTime?: number;        // Start time in seconds (default: 0)
  endTime?: number;          // End time in seconds (default: video duration)
  volume?: number;           // Background audio volume (0.0 - 1.0, default: 0.3)
  fadeIn?: number;           // Fade in duration in seconds (default: 0)
  fadeOut?: number;          // Fade out duration in seconds (default: 0)
  loop?: boolean;            // Loop background audio if shorter than video (default: true)
  preset?: "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow";
  crf?: number;              // Video quality (default: 18)
}

export class AudioOverlayService {
  constructor(private ffmpegPath = "ffmpeg", private ffprobePath = "ffprobe") {}

  /**
   * Add background audio to a video
   * @param inputVideoPath Path to the input video file
   * @param outputVideoPath Path for the output video file
   * @param backgroundAudioId ID of the background audio track
   * @param options Overlay options
   */
  async addBackgroundAudio(
    inputVideoPath: string,
    outputVideoPath: string,
    backgroundAudioId: string,
    options: AudioOverlayOptions = {}
  ): Promise<void> {
    // Get background audio track
    const track = BackgroundAudioService.getTrackById(backgroundAudioId);
    if (!track) {
      throw new Error(`Background audio track '${backgroundAudioId}' not found`);
    }

    const backgroundAudioPath = BackgroundAudioService.getTrackPath(track.filename);
    if (!fs.existsSync(backgroundAudioPath)) {
      throw new Error(`Background audio file '${track.filename}' not found`);
    }

    // Get video info
    const videoInfo = await this.probeVideo(inputVideoPath);
    
    // Set default options
    const opts = {
      startTime: 0,
      endTime: videoInfo.durationSec,
      volume: 0.3,
      fadeIn: 0,
      fadeOut: 0,
      loop: true,
      preset: "veryfast" as const,
      crf: 18,
      ...options
    };

    // Validate time range
    if (opts.startTime < 0) opts.startTime = 0;
    if (opts.endTime > videoInfo.durationSec) opts.endTime = videoInfo.durationSec;
    if (opts.startTime >= opts.endTime) {
      throw new Error("Start time must be less than end time");
    }

    const overlayDuration = opts.endTime - opts.startTime;

    // Build FFmpeg command
    const args = await this.buildFFmpegArgs(
      inputVideoPath,
      backgroundAudioPath,
      outputVideoPath,
      opts,
      overlayDuration
    );

    try {
      await this.execFFmpeg(args);
      console.log(`Background audio '${track.name}' added successfully`);
    } catch (error) {
      console.error("Failed to add background audio:", error);
      throw error;
    }
  }

  /**
   * Build FFmpeg arguments for audio overlay
   */
  private async buildFFmpegArgs(
    inputVideoPath: string,
    backgroundAudioPath: string,
    outputVideoPath: string,
    options: Required<AudioOverlayOptions>,
    overlayDuration: number
  ): Promise<string[]> {
    const args = [
      "-hide_banner", "-loglevel", "info",
      "-y", // Overwrite output file
      "-i", inputVideoPath,
      "-i", backgroundAudioPath
    ];

    // Build audio filter
    const audioFilters = [];

    // Handle looping if needed
    if (options.loop) {
      // Get background audio duration
      const bgAudioInfo = await this.probeAudio(backgroundAudioPath);
      if (bgAudioInfo.durationSec < overlayDuration) {
        // Calculate how many times to loop
        const loopCount = Math.ceil(overlayDuration / bgAudioInfo.durationSec);
        audioFilters.push(`[1:a]aloop=loop=${loopCount}:size=2e+09[bg_looped]`);
      } else {
        audioFilters.push(`[1:a]atrim=duration=${overlayDuration}[bg_trimmed]`);
      }
    } else {
      audioFilters.push(`[1:a]atrim=duration=${overlayDuration}[bg_trimmed]`);
    }

    // Apply volume and fade effects
    const bgAudioLabel = options.loop ? "bg_looped" : "bg_trimmed";
    let volumeFilter = `volume=${options.volume}`;
    
    if (options.fadeIn > 0 || options.fadeOut > 0) {
      const fadeIn = options.fadeIn > 0 ? `afade=t=in:st=0:d=${options.fadeIn}` : '';
      const fadeOut = options.fadeOut > 0 ? `afade=t=out:st=${overlayDuration - options.fadeOut}:d=${options.fadeOut}` : '';
      
      if (fadeIn && fadeOut) {
        volumeFilter += `,${fadeIn},${fadeOut}`;
      } else if (fadeIn) {
        volumeFilter += `,${fadeIn}`;
      } else if (fadeOut) {
        volumeFilter += `,${fadeOut}`;
      }
    }

    audioFilters.push(`[${bgAudioLabel}]${volumeFilter}[bg_processed]`);

    // Mix with original audio
    audioFilters.push(`[0:a][bg_processed]amix=inputs=2:duration=first:dropout_transition=2[audio_out]`);

    // Add filter complex
    args.push("-filter_complex", audioFilters.join(";"));

    // Map outputs
    args.push(
      "-map", "0:v",           // Video from first input
      "-map", "[audio_out]",   // Mixed audio
      "-c:v", "libx264",       // Video codec
      "-preset", options.preset,
      "-crf", String(options.crf),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",           // Audio codec
      "-b:a", "128k",          // Audio bitrate
      "-avoid_negative_ts", "make_zero",
      outputVideoPath
    );

    return args;
  }

  /**
   * Probe video file to get information
   */
  private async probeVideo(inputPath: string): Promise<{ durationSec: number; hasAudio: boolean }> {
    const args = [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "format=duration:stream=codec_type",
      "-of", "json",
      inputPath
    ];

    try {
      const json = await this.execFFprobe(args);
      const parsed = JSON.parse(json);
      const format = parsed?.format ?? {};
      const streams = parsed?.streams ?? [];

      const durationSec = Number(format.duration) || 0;
      const hasAudio = streams.some((stream: any) => stream.codec_type === "audio");

      return { durationSec, hasAudio };
    } catch (error) {
      console.warn("Video probe failed, using defaults:", error);
      return { durationSec: 10, hasAudio: true };
    }
  }

  /**
   * Probe audio file to get information
   */
  private async probeAudio(inputPath: string): Promise<{ durationSec: number }> {
    const args = [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "json",
      inputPath
    ];

    try {
      const json = await this.execFFprobe(args);
      const parsed = JSON.parse(json);
      const format = parsed?.format ?? {};
      const durationSec = Number(format.duration) || 0;

      return { durationSec };
    } catch (error) {
      console.warn("Audio probe failed, using defaults:", error);
      return { durationSec: 30 };
    }
  }

  /**
   * Execute FFmpeg command
   */
  private execFFmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.ffmpegPath, args, { 
        stdio: ["ignore", "pipe", "pipe"] 
      });
      
      let stderr = "";
      let stdout = "";
      
      process.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      
      process.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      
      process.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg failed (code ${code}): ${stderr}`));
        }
      });

      process.on("error", (error) => {
        reject(new Error(`FFmpeg spawn error: ${error.message}`));
      });
    });
  }

  /**
   * Execute FFprobe command
   */
  private execFFprobe(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(this.ffprobePath, args, { 
        stdio: ["ignore", "pipe", "pipe"] 
      });
      
      let stdout = "";
      let stderr = "";
      
      process.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      
      process.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      
      process.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`FFprobe failed (code ${code}): ${stderr}`));
        }
      });

      process.on("error", (error) => {
        reject(new Error(`FFprobe spawn error: ${error.message}`));
      });
    });
  }
}
