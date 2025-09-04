import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// Simple filler words to detect
const DEFAULT_FILLER_PATTERNS = ['uh', 'um', 'like', 'you know', 'basically', 'actually', 'literally'];

interface FillerWordOptions {
  sensitivity?: number; // sensitivity for filler detection, higher value = more sensitive
  minFillerDuration?: number; // Minimum duration of filler word to detect
  maxFillerDuration?: number; // Maximum duration of filler word to detect
  paddingBefore?: number; // Padding before detected filler word
  paddingAfter?: number; // Padding after detected filler word
}

interface FillerSegment {
  start: number;
  end: number;
  type: 'filler';
}

// Simplified filler trimming function
export const fillerWordTrim = async (
  videoPath: string,
  options: FillerWordOptions = {}
): Promise<{ success: boolean, outputPath?: string, error?: string }> => {
  const {
    sensitivity = 0.7,
    minFillerDuration = 0.1,
    maxFillerDuration = 2.0,
    paddingBefore = 0.05,
    paddingAfter = 0.05
  } = options;

  try {
    // Validate input file exists
    if (!fs.existsSync(videoPath)) {
      return { success: false, error: `Video file not found: ${videoPath}` };
    }

    // Create output directory if it doesn't exist
    const outputDir = path.join(process.cwd(), 'outputs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate output filename
    const videoName = path.basename(videoPath, path.extname(videoPath));
    const timestamp = Date.now();
    const outputFilename = `${videoName}-filler-trimmed-${timestamp}.mp4`;
    const outputPath = path.join(outputDir, outputFilename);

    // Step 1: Extract audio for analysis
    const audioPath = await extractAudioForAnalysis(videoPath);
    
    // Step 2: Detect filler word segments based on simple RMS levels
    const fillerSegments = await detectFillerWords(audioPath, sensitivity, minFillerDuration, maxFillerDuration);

    // Clean up temporary audio file
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    if (fillerSegments.length === 0) {
      return { success: true, outputPath: videoPath };
    }

    // Step 3: Process segments and remove filler words
    const keepSegments = buildKeepSegments(fillerSegments, await getVideoDuration(videoPath));

    if (keepSegments.length === 0) {
      return { success: false, error: 'No speech segments found after filler word detection' };
    }

    // Step 4: Trim video using the keep segments
    const trimResult = await trimAndConcatVideo(videoPath, outputPath, keepSegments);

    return trimResult.success ? { success: true, outputPath } : trimResult;

  } catch (error) {
    return { success: false, error: `Error during filler word trim: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
};

// Extract audio for analysis
async function extractAudioForAnalysis(videoPath: string): Promise<string> {
  const tempDir = path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const audioPath = path.join(tempDir, `temp-audio-${Date.now()}.wav`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', videoPath,
      '-vn', // No video
      '-acodec', 'pcm_s16le',
      '-ar', '16000', // 16kHz sample rate for analysis
      '-ac', '1', // Mono
      '-y', audioPath
    ]);

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(audioPath);
      } else {
        reject(new Error(`Audio extraction failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (error) => {
      reject(error);
    });
  });
}

// Simple filler word detection based on RMS level
async function detectFillerWords(audioPath: string, sensitivity: number, minDuration: number, maxDuration: number): Promise<FillerSegment[]> {
  const segments: FillerSegment[] = [];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', audioPath,
      '-af', `astats=metadata=1:reset=0.1:length=0.1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
      '-f', 'null', // Don't output the audio
      '-'
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && stderr.length > 0) {
        const rmsMatches = stderr.match(/lavfi\.astats\.Overall\.RMS_level=(-?\d+\.?\d*)/g);

        if (rmsMatches && rmsMatches.length > 0) {
          let currentSegmentStart: number | null = null;
          const threshold = -30 - (sensitivity * 5); // Adjustable threshold

          rmsMatches.forEach((match, index) => {
            const rmsValue = parseFloat(match.split('=')[1]);
            const timeStamp = index * 0.1;

            const isFillerCandidate = rmsValue > threshold && rmsValue < -10;

            if (isFillerCandidate) {
              if (currentSegmentStart === null) {
                currentSegmentStart = timeStamp;
              }
            } else {
              if (currentSegmentStart !== null) {
                const duration = timeStamp - currentSegmentStart;
                if (duration >= minDuration && duration <= maxDuration) {
                  segments.push({
                    start: currentSegmentStart,
                    end: timeStamp,
                    type: 'filler'
                  });
                }
                currentSegmentStart = null;
              }
            }
          });

          if (currentSegmentStart !== null && rmsMatches.length > 0) {
            const endTime = (rmsMatches.length - 1) * 0.1;
            const duration = endTime - currentSegmentStart;
            if (duration >= minDuration && duration <= maxDuration) {
              segments.push({
                start: currentSegmentStart,
                end: endTime,
                type: 'filler'
              });
            }
          }
        }
      }
      resolve(segments);
    });

    ffmpeg.on('error', (error) => {
      reject(error);
    });
  });
}

// Build keep segments by removing filler word segments
function buildKeepSegments(fillerSegments: FillerSegment[], totalDuration: number): Array<{ start: number, end: number }> {
  const keepSegments: Array<{ start: number, end: number }> = [];
  let currentStart = 0;

  for (const filler of fillerSegments) {
    if (filler.start > currentStart) {
      keepSegments.push({
        start: currentStart,
        end: filler.start
      });
    }
    currentStart = filler.end;
  }

  if (currentStart < totalDuration) {
    keepSegments.push({
      start: currentStart,
      end: totalDuration
    });
  }

  return keepSegments;
}

// Trim and concatenate video based on keep segments
async function trimAndConcatVideo(inputPath: string, outputPath: string, keepSegments: Array<{ start: number, end: number }>): Promise<{ success: boolean, error?: string }> {
  const filterParts: string[] = [];

  keepSegments.forEach((segment, index) => {
    filterParts.push(`[0:v]trim=start=${segment.start}:end=${segment.end},setpts=PTS-STARTPTS[v${index}];[0:a]atrim=start=${segment.start}:end=${segment.end},asetpts=PTS-STARTPTS[a${index}]`);
  });

  const vInputs = keepSegments.map((_, i) => `[v${i}]`).join('');
  const aInputs = keepSegments.map((_, i) => `[a${i}]`).join('');
  const concatFilter = `${vInputs}concat=n=${keepSegments.length}:v=1:a=0[outv];${aInputs}concat=n=${keepSegments.length}:v=0:a=1[outa]`;

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-filter_complex', `${filterParts.join(';')};${concatFilter}`,
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
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: stderr });
      }
    });

    ffmpeg.on('error', (error) => {
      reject(error);
    });
  });
}

// Get video duration using ffprobe
async function getVideoDuration(videoPath: string): Promise<number> {
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
}
