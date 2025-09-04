import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

interface SilenceTrimOptions {
  silenceThreshold?: number; // dB (default: -35)
  minSilenceLength?: number; // seconds (default: 0.25)
  paddingAroundSpeech?: number; // seconds (default: 0.12)
}

interface SilenceSegment {
  start: number;
  end: number;
}

interface SilenceTrimResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  originalDuration?: number;
  trimmedDuration?: number;
  silenceSegments?: SilenceSegment[];
}

export const silenceTrim = async (
  videoPath: string,
  options: SilenceTrimOptions = {}
): Promise<SilenceTrimResult> => {
  const {
    silenceThreshold = -35,
    minSilenceLength = 0.25,
    paddingAroundSpeech = 0.12
  } = options;

  try {
    // Validate input file exists
    if (!fs.existsSync(videoPath)) {
      return {
        success: false,
        error: `Video file not found: ${videoPath}`
      };
    }

    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate output filename
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const timestamp = Date.now();
    const outputFilename = `${videoName}-trimmed-${timestamp}.mp4`;
    const outputPath = path.join(outputDir, outputFilename);

    // Step 1: Detect silence segments
    const silenceSegments = await detectSilence(videoPath, silenceThreshold, minSilenceLength);
    
    if (!silenceSegments || silenceSegments.length === 0) {
      // No silence detected, return original file
      return {
        success: true,
        outputPath: videoPath,
        originalDuration: 0,
        trimmedDuration: 0,
        silenceSegments: []
      };
    }

    // Step 2: Build keep segments (inverse of silence segments with padding)
    const keepSegments = buildKeepSegments(silenceSegments, paddingAroundSpeech);
    
    if (keepSegments.length === 0) {
      return {
        success: false,
        error: 'No speech segments found after silence detection'
      };
    }

    // Step 3: Trim and concatenate video
    const trimResult = await trimAndConcat(videoPath, outputPath, keepSegments);
    
    if (!trimResult.success) {
      return trimResult;
    }

    return {
      success: true,
      outputPath,
      silenceSegments,
      originalDuration: trimResult.originalDuration,
      trimmedDuration: trimResult.trimmedDuration
    };

  } catch (error) {
    return {
      success: false,
      error: `Silence trim error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
};

// Detect silence segments using FFmpeg's silencedetect filter
async function detectSilence(
  videoPath: string, 
  threshold: number, 
  minLength: number
): Promise<SilenceSegment[]> {
  return new Promise((resolve) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-af', `silencedetect=noise=${threshold}dB:d=${minLength}`,
      '-f', 'null',
      '-'
    ]);

    let stderr = '';
    const silenceSegments: SilenceSegment[] = [];

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        // Parse silence detection output
        const silenceMatches = stderr.match(/silence_start: ([\d.]+)/g);
        const silenceEndMatches = stderr.match(/silence_end: ([\d.]+)/g);

        if (silenceMatches && silenceEndMatches) {
          for (let i = 0; i < silenceMatches.length; i++) {
            const startMatch = silenceMatches[i].match(/silence_start: ([\d.]+)/);
            const endMatch = silenceEndMatches[i]?.match(/silence_end: ([\d.]+)/);
            
            if (startMatch && endMatch) {
              silenceSegments.push({
                start: parseFloat(startMatch[1]),
                end: parseFloat(endMatch[1])
              });
            }
          }
        }
        resolve(silenceSegments);
      } else {
        console.error('Silence detection failed:', stderr);
        resolve([]);
      }
    });

    ffmpeg.on('error', (error) => {
      console.error('FFmpeg error:', error);
      resolve([]);
    });
  });
}

// Build keep segments (speech segments with padding)
function buildKeepSegments(
  silenceSegments: SilenceSegment[], 
  padding: number
): SilenceSegment[] {
  const keepSegments: SilenceSegment[] = [];
  let currentStart = 0;

  // Loop through each silence segment
  for (const silence of silenceSegments) {
    if (silence.start > currentStart + padding) {
      keepSegments.push({
        start: Math.max(0, currentStart),
        end: silence.start - padding    
      });
    }
    currentStart = silence.end; 
  }

  if (currentStart > 0) {
    keepSegments.push({
      start: currentStart + padding,  // Add padding after the last speech
      end: -1 // -1 means "until the end of the video"
    });
  }

  if (keepSegments.length === 0) {
    keepSegments.push({ start: 0, end: -1 });
  }

  return keepSegments;
}

// Trim and concatenate video based on keep segments
async function trimAndConcat(
  inputPath: string,
  outputPath: string,
  keepSegments: SilenceSegment[]
): Promise<{ success: boolean; error?: string; originalDuration?: number; trimmedDuration?: number }> {
  
  if (keepSegments.length === 1 && keepSegments[0].end === -1) {
    // Simple case: just trim from start
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', inputPath,
        '-ss', keepSegments[0].start.toString(),
        '-c', 'copy',
        '-y', outputPath
      ]);

      let stderr = '';
      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        resolve(code === 0 ? { success: true } : { 
          success: false, 
          error: `FFmpeg trim failed: ${stderr}` 
        });
      });

      ffmpeg.on('error', (error) => {
        resolve({ 
          success: false, 
          error: `FFmpeg execution error: ${error.message}` 
        });
      });
    });
  }

  // Complex case: multiple segments
  return new Promise((resolve) => {
    const filterParts: string[] = [];
    
    // Create filter for each segment - FIXED SYNTAX
    keepSegments.forEach((segment, index) => {
      if (segment.end === -1) {
        filterParts.push(`[0:v]trim=start=${segment.start},setpts=PTS-STARTPTS[v${index}];[0:a]atrim=start=${segment.start},asetpts=PTS-STARTPTS[a${index}]`);
      } else {
        filterParts.push(`[0:v]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS[v${index}];[0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[a${index}]`);
      }
    });

    // Build concat inputs
    const vInputs = keepSegments.map((_, i) => `[v${i}]`).join('');
    const aInputs = keepSegments.map((_, i) => `[a${i}]`).join('');
    const concatFilter = `${vInputs}concat=n=${keepSegments.length}:v=1:a=0[outv];${aInputs}concat=n=${keepSegments.length}:v=0:a=1[outa]`;
    
    const filterComplex = `${filterParts.join(';')};${concatFilter}`;

    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-map', '[outa]',
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-y', outputPath
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      resolve(code === 0 ? { success: true } : { 
        success: false, 
        error: `FFmpeg concat failed: ${stderr}` 
      });
    });

    ffmpeg.on('error', (error) => {
      resolve({ 
        success: false, 
        error: `FFmpeg execution error: ${error.message}` 
      });
    });
  });
}
// Get video duration using ffprobe
export const getVideoDuration = async (videoPath: string): Promise<number> => {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      videoPath
    ]);

    let output = '';

    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        try {
          const data = JSON.parse(output);
          const duration = parseFloat(data.format.duration);
          resolve(duration || 0);
        } catch (e) {
          resolve(0);
        }
      } else {
        resolve(0);
      }
    });

    ffprobe.on('error', () => {
      resolve(0);
    });
  });
};

