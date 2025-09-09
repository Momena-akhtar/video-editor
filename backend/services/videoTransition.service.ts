import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { TransitionService } from "./transition.service";

export interface VideoTransitionOptions {
  transitionTime: number;     // Time in seconds where transition should be applied
  duration?: number;          // Duration of the transition effect (default: 1 second)
  preset?: "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow" | "slower" | "veryslow";
  crf?: number;              // Video quality (default: 18)
}

export class VideoTransitionService {
  constructor(private ffmpegPath = "ffmpeg", private ffprobePath = "ffprobe") {}

  /**
   * Add a transition effect to a video at a specific time
   * @param inputVideoPath Path to the input video file
   * @param outputVideoPath Path for the output video file
   * @param transitionId ID of the transition effect
   * @param options Transition options
   */
  async addTransition(
    inputVideoPath: string,
    outputVideoPath: string,
    transitionId: string,
    options: VideoTransitionOptions
  ): Promise<void> {
    // Get transition file
    const transition = TransitionService.getTransitionById(transitionId);
    if (!transition) {
      throw new Error(`Transition '${transitionId}' not found`);
    }

    const transitionPath = TransitionService.getTransitionPath(transition.filename);
    if (!fs.existsSync(transitionPath)) {
      throw new Error(`Transition file '${transition.filename}' not found`);
    }

    // Get video info
    const videoInfo = await this.probeVideo(inputVideoPath);
    
    // Set default options
    const opts = {
      duration: 1.0,
      preset: "veryfast" as const,
      crf: 18,
      ...options
    };

    // Validate transition time
    if (opts.transitionTime < 0) {
      throw new Error("Transition time must be positive");
    }
    if (opts.transitionTime >= videoInfo.durationSec) {
      throw new Error("Transition time must be less than video duration");
    }

    // Build FFmpeg command
    const args = await this.buildFFmpegArgs(
      inputVideoPath,
      transitionPath,
      outputVideoPath,
      opts,
      videoInfo
    );

    try {
      await this.execFFmpeg(args);
      console.log(`Transition '${transition.name}' applied successfully at ${opts.transitionTime}s`);
    } catch (error) {
      console.error("Failed to apply transition:", error);
      throw error;
    }
  }

  /**
   * Build FFmpeg arguments for video cutting and transition insertion
   */
  private async buildFFmpegArgs(
    inputVideoPath: string,
    transitionPath: string,
    outputVideoPath: string,
    options: Required<VideoTransitionOptions> & { transitionTime: number },
    videoInfo: { durationSec: number; width: number; height: number }
  ): Promise<string[]> {
    const args = [
      "-hide_banner", "-loglevel", "info",
      "-y", // Overwrite output file
      "-i", inputVideoPath,
      "-i", transitionPath
    ];

    // Calculate timing
    const transitionStart = options.transitionTime;
    const transitionDuration = options.duration;
    const videoEnd = videoInfo.durationSec;

    // Get transition video info to handle aspect ratios properly
    const transitionInfo = await this.probeVideo(transitionPath);
    
    // Determine target dimensions - use the larger video's dimensions as base
    const targetWidth = Math.max(videoInfo.width, transitionInfo.width);
    const targetHeight = Math.max(videoInfo.height, transitionInfo.height);
    
    // Check if transition has audio
    const transitionHasAudio = await this.hasAudioStream(transitionPath);
    
    // Build filter complex for proper video cutting and concatenation
    const filterComplex = [
      // Split input video into two parts: before and after transition point
      `[0:v]split=2[before][after]`,
      `[0:a]asplit=2[before_audio][after_audio]`,
      
      // Trim the "before" part (from start to transition point)
      `[before]trim=duration=${transitionStart},setpts=PTS-STARTPTS[before_trimmed]`,
      `[before_audio]atrim=duration=${transitionStart},asetpts=PTS-STARTPTS[before_audio_trimmed]`,
      
      // Trim the "after" part (from transition point to end)
      `[after]trim=start=${transitionStart},setpts=PTS-STARTPTS[after_trimmed]`,
      `[after_audio]atrim=start=${transitionStart},asetpts=PTS-STARTPTS[after_audio_trimmed]`,
      
      // Scale and format transition video to match target dimensions
      `[1:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1:1[transition_scaled]`,
      
      // Scale and format the video parts to match target dimensions
      `[before_trimmed]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1:1[before_final]`,
      `[after_trimmed]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1:1[after_final]`,
      
      // Concatenate: before + transition + after
      transitionHasAudio 
        ? `[before_final][before_audio_trimmed][transition_scaled][1:a][after_final][after_audio_trimmed]concat=n=3:v=1:a=1[video_out][audio_out]`
        : `[before_final][before_audio_trimmed][transition_scaled][after_final][after_audio_trimmed]concat=n=3:v=1:a=1[video_out][audio_out]`
    ].join(";");

    args.push(
      "-filter_complex", filterComplex,
      "-map", "[video_out]",
      "-map", "[audio_out]",
      "-c:v", "libx264",
      "-preset", options.preset,
      "-crf", String(options.crf),
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-avoid_negative_ts", "make_zero",
      outputVideoPath
    );

    return args;
  }

  /**
   * Probe video file to get information
   */
  private async probeVideo(inputPath: string): Promise<{ durationSec: number; width: number; height: number }> {
    const args = [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "json",
      inputPath
    ];

    try {
      const json = await this.execFFprobe(args);
      const parsed = JSON.parse(json);
      const stream = parsed?.streams?.[0] ?? {};
      const format = parsed?.format ?? {};

      const durationSec = Number(format.duration) || 0;
      const width = Number(stream.width) || 1920;
      const height = Number(stream.height) || 1080;

      return { durationSec, width, height };
    } catch (error) {
      console.warn("Video probe failed, using defaults:", error);
      return { durationSec: 10, width: 1920, height: 1080 };
    }
  }

  /**
   * Check if a video file has an audio stream
   */
  private async hasAudioStream(inputPath: string): Promise<boolean> {
    const args = [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=codec_type",
      "-of", "json",
      inputPath
    ];

    try {
      const json = await this.execFFprobe(args);
      const parsed = JSON.parse(json);
      return parsed?.streams && parsed.streams.length > 0;
    } catch (error) {
      console.warn("Audio stream check failed, assuming no audio:", error);
      return false;
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
