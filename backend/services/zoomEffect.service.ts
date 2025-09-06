import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

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

export interface MultiZoomOptions extends ZoomOptions {
  sentencesPerZoom?: number;
  bufferSec?: number;
}

interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  hasVideo: boolean;
}

export class ZoomEffectService {
  constructor(private ffmpegPath = "ffmpeg", private ffprobePath = "ffprobe") {}

  async applyZoomEffect(inputPath: string, outputPath: string, opts: ZoomOptions = {}): Promise<void> {
    const probe = await this.probe(inputPath);

    if (!probe.hasVideo) {
      console.warn("No video stream detected. Skipping zoom and copying streams.");
      const copyArgs = [
        "-hide_banner", "-loglevel", "info",
        "-y", "-i", inputPath,
        "-c", "copy",
        outputPath
      ];
      await this.execFFmpeg(copyArgs);
      return;
    }

    const fps = Math.max(1, Math.round(opts.fps ?? probe.fps));
    const startZoom = opts.startZoom ?? 1.0;
    const endZoom = opts.endZoom ?? 1.15;
    const easing = opts.easing ?? "ease-in-out";
    const crf = opts.crf ?? 18;
    const preset = opts.preset ?? "veryfast";

    const clipDur = Math.max(0.01, probe.durationSec || 0.01);
    const durationSec = Math.min(opts.durationSec ?? clipDur, clipDur);


    // Time-based easing
    const timeProgress = `min(max(t/${durationSec},0),1)`;
    const easingExpr = this.easingOn(timeProgress, easing);
    const zExpr = `${startZoom}+(${endZoom}-${startZoom})*${easingExpr}`;

    // Center-crop with dynamic zoom
    const cropW = `floor((iw/${zExpr})/2)*2`;
    const cropH = `floor((ih/${zExpr})/2)*2`;
    const cropX = `floor((iw-${cropW})/2)`;
    const cropY = `floor((ih-${cropH})/2)`;

    let filterComplex: string;

    if (durationSec >= clipDur) {
      // Zoom entire video
      filterComplex = `[0:v]crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',scale=${probe.width}:${probe.height},setsar=1:1[zoomed]`;
    } else {
      // Zoom first part, then concatenate remainder
      // KEY FIX: Add setsar=1:1 to both segments before concat
      filterComplex = [
        `[0:v]split[vpre][vpost];`,
        `[vpre]trim=start=0:end=${durationSec},setpts=PTS-STARTPTS,` +
        `crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}',` +
        `scale=${probe.width}:${probe.height},setsar=1:1[va];`,
        `[vpost]trim=start=${durationSec},setpts=PTS-STARTPTS,setsar=1:1[vb];`,
        `[va][vb]concat=n=2:v=1:a=0[zoomed]`
      ].join("");
    }

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
      outputPath
    ];
    
    try {
      await this.execFFmpeg(args);
      console.log("Zoom effect applied successfully");
    } catch (error) {
      console.error("Zoom effect failed, continuing without zoom:", error);
      // Fallback: simple copy if zoom fails
      const fallbackArgs = [
        "-hide_banner", "-loglevel", "info",
        "-y", "-i", inputPath,
        "-c", "copy",
        outputPath
      ];
      await this.execFFmpeg(fallbackArgs);
    }
  }

  async applyMultiZoomEffect(inputPath: string, outputPath: string, segments: any[], opts: MultiZoomOptions = {}): Promise<void> {
    const sentencesPerZoom = opts.sentencesPerZoom ?? 2;
    const bufferSec = opts.bufferSec ?? 0.2;
    
    // Group sentences into zoom points
    const zoomPoints = this.groupSentencesForZoom(segments, sentencesPerZoom, bufferSec);
    
    // Split video into segments
    const videoSegments = await this.splitVideoAtPoints(inputPath, zoomPoints);
    
    // Process each segment
    const processedSegments = await this.processSegments(videoSegments, zoomPoints, opts);
    
    // Concatenate results
    await this.concatenateSegments(processedSegments, outputPath);
    
    // Cleanup
    await this.cleanupTempFiles([...videoSegments, ...processedSegments]);
  }

  private groupSentencesForZoom(segments: any[], sentencesPerZoom: number, bufferSec: number) {
    const zoomPoints = [];
    let sentenceCount = 0;
    let currentGroup = { start: 0, end: 0, shouldZoom: false };
    
    for (const segment of segments) {
      const hasSentenceEnd = /[.!?]$/.test(segment.text.trim());
      
      if (sentenceCount === 0) {
        currentGroup.start = segment.start;
      }
      currentGroup.end = segment.end;
      
      if (hasSentenceEnd) {
        sentenceCount++;
        if (sentenceCount >= sentencesPerZoom) {
          currentGroup.shouldZoom = true;
          currentGroup.start = Math.max(0, currentGroup.start - bufferSec);
          zoomPoints.push({ ...currentGroup });
          sentenceCount = 0;
          currentGroup = { start: segment.end, end: segment.end, shouldZoom: false };
        }
      }
    }
    
    if (currentGroup.end > currentGroup.start) {
      zoomPoints.push({ ...currentGroup, shouldZoom: false });
    }
    
    return zoomPoints;
  }

  private async splitVideoAtPoints(inputPath: string, zoomPoints: any[]): Promise<string[]> {
    const segments = [];
    const tempDir = path.dirname(inputPath);
    
    for (let i = 0; i < zoomPoints.length; i++) {
      const point = zoomPoints[i];
      const nextPoint = zoomPoints[i + 1];
      const segmentPath = path.join(tempDir, `segment_${i}.mp4`);
      
      const args = [
        "-i", inputPath,
        "-ss", String(point.start),
        "-to", String(nextPoint ? nextPoint.start : point.end),
        "-c", "copy",
        segmentPath
      ];
      
      await this.execFFmpeg(args);
      segments.push(segmentPath);
    }
    
    return segments;
  }

  private async processSegments(segments: string[], zoomPoints: any[], opts: MultiZoomOptions): Promise<string[]> {
    const processed = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segmentPath = segments[i];
      const zoomPoint = zoomPoints[i];
      const processedPath = segmentPath.replace('.mp4', '_processed.mp4');
      
      if (zoomPoint.shouldZoom) {
        await this.applyZoomEffect(segmentPath, processedPath, opts);
      } else {
        // Copy as-is
        const args = ["-i", segmentPath, "-c", "copy", processedPath];
        await this.execFFmpeg(args);
      }
      
      processed.push(processedPath);
    }
    
    return processed;
  }

  private async concatenateSegments(segments: string[], outputPath: string): Promise<void> {
    const concatFile = path.join(path.dirname(outputPath), `concat_${Date.now()}.txt`);
    const concatContent = segments.map(seg => `file '${seg}'`).join('\n');
    fs.writeFileSync(concatFile, concatContent);
    
    const args = ["-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", outputPath];
    await this.execFFmpeg(args);
    
    fs.unlinkSync(concatFile);
  }

  private async cleanupTempFiles(files: string[]): Promise<void> {
    for (const file of files) {
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
        }
      } catch (error) {
        console.warn(`Failed to delete temp file ${file}:`, error);
      }
    }
  }

  private easingOn(p: string, easing: Easing): string {
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

      const hasVideo = Boolean(parsed?.streams && parsed.streams.length > 0);
      const width = hasVideo ? (Number(stream.width) || 1920) : 0;
      const height = hasVideo ? (Number(stream.height) || 1080) : 0;
      const durationSec = Number(format.duration) || 0;

      const frameRate = stream.r_frame_rate || stream.avg_frame_rate || "30/1";
      const fps = hasVideo ? this.parseFps(frameRate) : 30;

      return { width, height, fps, durationSec, hasVideo };
    } catch (error) {
      console.warn("Probe failed, using defaults:", error);
      return { width: 1920, height: 1080, fps: 30, durationSec: 10, hasVideo: true };
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