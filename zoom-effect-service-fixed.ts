import { spawn } from "child_process";

type Easing = "linear" | "ease-in" | "ease-out" | "ease-in-out";

export interface ZoomOptions {
  durationSec?: number;
  startZoom?: number;
  endZoom?: number;
  fps?: number;
  easing?: Easing;
  crf?: number;
  preset?: "ultrafast"|"superfast"|"veryfast"|"faster"|"fast"|"medium"|"slow"|"slower"|"veryslow";
}

interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
}

export class ZoomEffectService {
  constructor(private ffmpegPath = "ffmpeg", private ffprobePath = "ffprobe") {}

  async applyZoomEffect(inputPath: string, outputPath: string, opts: ZoomOptions = {}): Promise<void> {
    console.log("Applying zoom effect to:", inputPath);
    const probe = await this.probe(inputPath);
    console.log("Probe result:", probe);

    const fps = Math.max(1, Math.round(opts.fps ?? probe.fps));
    const startZoom = opts.startZoom ?? 1.0;
    const endZoom = opts.endZoom ?? 1.15;
    const easing = opts.easing ?? "ease-in-out";
    const crf = opts.crf ?? 18;
    const preset = opts.preset ?? "veryfast";

    // Use specified duration (for start-only zoom effect)
    const clipDur = Math.max(0.01, probe.durationSec || 0.01);
    const durationSec = Math.min(opts.durationSec ?? clipDur, clipDur);
    const totalFrames = Math.max(1, Math.round(durationSec * fps));

    console.log(`Zoom config: ${startZoom} -> ${endZoom} over ${durationSec}s (${totalFrames} frames)`);

    // Calculate the duration parameter for zoompan
    // We want the zoom effect to happen over the specified duration
    const zoomDurationFrames = Math.round(durationSec * fps);
    
    // Use time-based progress instead of frame-based for more accurate timing
    // 't' represents the current time in seconds
    const timeProgress = `(t/${durationSec})`;
    const clampedProgress = `min(${timeProgress},1)`;
    
    const easingExpr = this.easingTime(clampedProgress, easing);
    const zoomExpr = `${startZoom}+(${endZoom}-${startZoom})*${easingExpr}`;

    // Center the zoom properly  
    const xExpr = `(iw-iw/zoom)/2`;
    const yExpr = `(ih-ih/zoom)/2`;

    // Create a more comprehensive filter chain
    const filterComplex = [
      `[0:v]zoompan=`,
      `z='${zoomExpr}':`,
      `x='${xExpr}':`,
      `y='${yExpr}':`,
      `d=${zoomDurationFrames}:`,
      `s=${probe.width}x${probe.height}:`,
      `fps=${fps}[zoomed]`
    ].join('');

    const args = [
      "-hide_banner", "-loglevel", "info",
      "-y", "-i", inputPath,
      "-filter_complex", filterComplex,
      "-map", "[zoomed]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf),
      "-pix_fmt", "yuv420p",
      "-c:a", "copy",
      "-avoid_negative_ts", "make_zero",
      "-t", String(durationSec), // Limit output duration
      outputPath
    ];

    console.log("FFmpeg zoom command:", args.join(' '));
    await this.execFFmpeg(args);
    console.log("Zoom effect applied successfully");
  }

  private easingTime(p: string, easing: Easing): string {
    switch (easing) {
      case "linear": return p;
      case "ease-in": return `pow(${p},2)`;
      case "ease-out": return `1-pow(1-${p},2)`;
      case "ease-in-out":
      default: return `${p}*${p}*(3-2*${p})`;
    }
  }

  private async probe(inputPath: string): Promise<ProbeResult> {
    const args = [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,r_frame_rate:format=duration",
      "-of", "json",
      inputPath
    ];

    try {
      const json = await this.execFFprobe(args);
      const parsed = JSON.parse(json);
      const stream = parsed?.streams?.[0] ?? {};
      const format = parsed?.format ?? {};

      const width = Number(stream.width) || 1920;
      const height = Number(stream.height) || 1080;
      const durationSec = Number(format.duration) || 0;

      // Use r_frame_rate instead of avg_frame_rate for more accuracy
      const frameRate = stream.r_frame_rate || stream.avg_frame_rate || "30/1";
      const fps = this.parseFps(frameRate);

      return { width, height, fps, durationSec };
    } catch (error) {
      console.warn("Probe failed, using defaults:", error);
      return { width: 1920, height: 1080, fps: 30, durationSec: 10 };
    }
  }

  private parseFps(fr: string): number {
    const [n, d = "1"] = fr.split("/");
    const num = Number(n) || 30;
    const den = Number(d) || 1;
    return den > 0 ? Math.round(num / den) : 30;
  }

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
          console.log("FFmpeg completed successfully");
          resolve();
        } else {
          console.error("FFmpeg stderr:", stderr);
          reject(new Error(`FFmpeg failed (code ${code}): ${stderr}`));
        }
      });

      process.on("error", (error) => {
        reject(new Error(`FFmpeg spawn error: ${error.message}`));
      });
    });
  }

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